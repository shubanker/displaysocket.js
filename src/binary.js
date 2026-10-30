/* Browser-only, versioned binary transport. Text transfers use the legacy protocol. */
var BinaryTransfer = (function () {
    'use strict';

    var HEADER_SIZE = 28;
    var MAX_PAYLOAD = 2953 - HEADER_SIZE; // Version 40, error correction L.
    var MAX_METADATA = 65536;
    var MAGIC = [68, 83, 66, 49]; // DSB1

    function isFrame(bytes) {
        return bytes && bytes.length >= 4 && MAGIC.every(function (value, i) {
            return bytes[i] === value;
        });
    }

    function crc32(first, second) {
        var crc = -1;
        [first, second || []].forEach(function (bytes) {
            for (var i = 0; i < bytes.length; i++) {
                crc ^= bytes[i];
                for (var bit = 0; bit < 8; bit++) {
                    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
                }
            }
        });
        return (crc ^ -1) >>> 0;
    }

    async function sha256(bytes) {
        if (!globalThis.crypto || !globalThis.crypto.subtle) {
            throw new Error('Binary transfers require HTTPS or localhost for SHA-256 verification.');
        }
        var digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
        return Array.from(digest, function (byte) {
            return byte.toString(16).padStart(2, '0');
        }).join('');
    }

    async function collect(stream, limit) {
        var reader = stream.getReader();
        var parts = [];
        var size = 0;
        try {
            while (true) {
                var result = await reader.read();
                if (result.done) { break; }
                size += result.value.length;
                if (size > limit) {
                    await reader.cancel();
                    throw new Error('Decoded file exceeds the allowed size.');
                }
                parts.push(result.value);
            }
        } finally {
            reader.releaseLock();
        }
        return new Uint8Array(await new Blob(parts).arrayBuffer());
    }

    function Sender(frames) {
        var queue = frames.map(function (_, i) { return i; });
        var position = -1;
        this.getSlices = function () { return frames; };
        this.getCurrentSliceIndex = function () { return queue[position]; };
        this.nextSlice = function () {
            position = (position + 1) % queue.length;
            return frames[queue[position]];
        };
        this.setQueue = function (value) {
            var selected = value ? value.split(',').map(function (index) {
                return index.trim();
            }).filter(function (index) {
                return /^\d+$/.test(index) && Number(index) < frames.length;
            }).map(Number) : [];
            queue = selected.length ? Array.from(new Set(selected)) : frames.map(function (_, i) { return i; });
            position = -1;
        };
    }

    async function prepare(file, sliceSize, options) {
        if (!(file instanceof Blob)) { throw new TypeError('sendFile expects a File or Blob.'); }
        if (!Number.isInteger(sliceSize) || sliceSize < 1 || sliceSize > MAX_PAYLOAD) {
            throw new RangeError('Binary slice size must be between 1 and ' + MAX_PAYLOAD + ' bytes.');
        }
        options = options || {};
        var original = new Uint8Array(await file.arrayBuffer());
        var hash = await sha256(original);
        var payload = original;
        var compression = 'none';
        if (options.compress && typeof CompressionStream !== 'undefined' &&
                typeof DecompressionStream !== 'undefined') {
            var compressed = new Uint8Array(await new Response(
                file.stream().pipeThrough(new CompressionStream('gzip'))
            ).arrayBuffer());
            if (compressed.length < original.length) {
                payload = compressed;
                compression = 'gzip';
            }
        }
        var metadata = new TextEncoder().encode(JSON.stringify({
            name: options.name || file.name || 'download',
            type: file.type || 'application/octet-stream',
            size: original.length,
            encodedSize: payload.length,
            compression: compression,
            sha256: hash
        }));
        if (metadata.length > MAX_METADATA) { throw new Error('File metadata is too large.'); }
        var body = new Uint8Array(4 + metadata.length + payload.length);
        new DataView(body.buffer).setUint32(0, metadata.length);
        body.set(metadata, 4);
        body.set(payload, 4 + metadata.length);
        var total = Math.ceil(body.length / sliceSize);
        if (total > 1000000) { throw new Error('Too many QR slices; increase the slice size.'); }
        var id = globalThis.crypto.getRandomValues(new Uint8Array(8));
        var frames = [];
        for (var index = 0; index < total; index++) {
            var chunk = body.subarray(index * sliceSize, (index + 1) * sliceSize);
            var frame = new Uint8Array(HEADER_SIZE + chunk.length);
            var view = new DataView(frame.buffer);
            frame.set(MAGIC);
            frame.set(id, 4);
            view.setUint32(12, index);
            view.setUint32(16, total);
            view.setUint16(20, chunk.length);
            frame.set(chunk, HEADER_SIZE);
            view.setUint32(24, crc32(frame.subarray(0, 24), chunk));
            frames.push(frame);
        }
        return {
            sender: new Sender(frames),
            info: {
                name: options.name || file.name || 'download',
                originalBytes: original.length,
                payloadBytes: payload.length,
                transmittedBytes: body.length + total * HEADER_SIZE,
                total: total,
                compression: compression
            }
        };
    }

    function Receiver(maxBytes) {
        var id = null;
        var total = 0;
        var chunks = new Map();
        var size = 0;

        this.add = function (frame) {
            if (!isFrame(frame) || frame.length < HEADER_SIZE) { return null; }
            var view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
            var index = view.getUint32(12);
            var count = view.getUint32(16);
            var length = view.getUint16(20);
            if (!count || count > 1000000 || index >= count || !length || length > MAX_PAYLOAD ||
                    frame.length !== HEADER_SIZE + length || view.getUint16(22) !== 0 ||
                    view.getUint32(24) !== crc32(frame.subarray(0, 24), frame.subarray(HEADER_SIZE))) {
                return null;
            }
            var incomingId = Array.from(frame.subarray(4, 12)).join(',');
            // Never mix transfers. A different transfer can start at its first frame.
            if (id !== null && incomingId !== id && index !== 0) { return null; }
            if (incomingId !== id) {
                id = incomingId;
                total = count;
                chunks.clear();
                size = 0;
            }
            if (count !== total) { return null; }
            if (chunks.has(index)) { return null; }
            if (size + length > maxBytes + MAX_METADATA + 4) {
                throw new Error('Incoming transfer exceeds the receive size limit.');
            }
            chunks.set(index, frame.slice(HEADER_SIZE));
            size += length;
            var progress = Array.from({ length: total }, function (_, i) { return chunks.has(i); });
            return {
                complete: chunks.size === total,
                index: index,
                progress: {
                    binary: true, total: total, found: chunks.size, current: index,
                    percent: chunks.size / total, progress: progress
                }
            };
        };

        this.finish = async function () {
            if (chunks.size !== total || !total) { throw new Error('Incomplete binary transfer.'); }
            var body = new Uint8Array(size);
            var offset = 0;
            for (var i = 0; i < total; i++) {
                body.set(chunks.get(i), offset);
                offset += chunks.get(i).length;
            }
            if (body.length < 4) { throw new Error('Invalid binary metadata.'); }
            var metadataLength = new DataView(body.buffer).getUint32(0);
            if (metadataLength > MAX_METADATA || metadataLength > body.length - 4) {
                throw new Error('Invalid binary metadata length.');
            }
            var metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
                body.subarray(4, 4 + metadataLength)
            ));
            var payload = body.subarray(4 + metadataLength);
            if (typeof metadata.name !== 'string' || typeof metadata.type !== 'string' ||
                    !Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > maxBytes ||
                    metadata.encodedSize !== payload.length || !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
                    (metadata.compression !== 'none' && metadata.compression !== 'gzip')) {
                throw new Error('Invalid binary file metadata or file size.');
            }
            if (metadata.compression === 'gzip') {
                if (typeof DecompressionStream === 'undefined') {
                    throw new Error('This browser cannot decompress gzip files. Disable compression on the sender.');
                }
                payload = await collect(new Blob([payload]).stream().pipeThrough(
                    new DecompressionStream('gzip')
                ), metadata.size);
            }
            if (payload.length !== metadata.size || await sha256(payload) !== metadata.sha256) {
                throw new Error('File integrity verification failed.');
            }
            chunks.clear();
            return { data: new Blob([payload], { type: metadata.type }), name: metadata.name,
                binary: true, size: metadata.size, compression: metadata.compression };
        };
    }

    return { isFrame: isFrame, prepare: prepare, Receiver: Receiver };
})();
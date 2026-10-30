/* Browser-native tests for protocol, QR byte mode, and the public API. */
(async function () {
    'use strict';
    var lines = [];
    var failures = 0;
    var tests = 0;
    var fixtures = document.getElementById('fixtures');

    function assert(condition, message) {
        if (!condition) { throw new Error(message || 'Assertion failed'); }
    }
    function equalBytes(actual, expected) {
        assert(actual.length === expected.length, 'Byte lengths differ');
        assert(actual.every(function (value, i) { return value === expected[i]; }), 'Bytes differ');
    }
    async function rejects(action, pattern) {
        try { await action(); } catch (error) {
            assert(pattern.test(error.message), 'Unexpected error: ' + error.message);
            return;
        }
        throw new Error('Expected rejection');
    }
    async function test(name, action) {
        tests++;
        try {
            await action();
            lines.push('PASS ' + name);
        } catch (error) {
            failures++;
            lines.push('FAIL ' + name + ': ' + error.message);
            console.error(name, error);
        }
        document.getElementById('results').textContent = lines.join('\n');
    }
    function load(file) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = '../' + file;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    function output() {
        var element = document.createElement('div');
        element.style.width = '640px';
        element.style.height = '640px';
        fixtures.appendChild(element);
        return element;
    }
    function updateFrameChecksum(frame) {
        var crc = -1;
        for (var i = 0; i < frame.length; i++) {
            if (i >= 24 && i < 28) { continue; }
            crc ^= frame[i];
            for (var bit = 0; bit < 8; bit++) {
                crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
            }
        }
        new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(24, (crc ^ -1) >>> 0);
    }
    function qrBytes(bytes) {
        var element = output();
        var qr = new QRCode(element, { width: 640, height: 640, correctLevel: QRCode.CorrectLevel.L });
        qr.makeCode(bytes);
        // Decode the actual QR matrix: exercises mode, length, Reed-Solomon, and byte parsing.
        var model = qr._oQRCode;
        var matrix = new BitMatrix(model.getModuleCount());
        for (var y = 0; y < model.getModuleCount(); y++) {
            for (var x = 0; x < model.getModuleCount(); x++) {
                if (model.isDark(y, x)) { matrix.set_Renamed(x, y); }
            }
        }
        var decoded = Decoder.decode(matrix).DataByte;
        var result = new Uint8Array(decoded.reduce(function (a, part) { return a.concat(part); }, []));
        element.remove();
        return result;
    }
    async function roundTrip(file, options, size) {
        var prepared = await BinaryTransfer.prepare(file, size || 250, options);
        var receiver = new BinaryTransfer.Receiver(1024 * 1024);
        var frames = prepared.sender.getSlices();
        // Out of order, with duplicate frames, and with a missing frame supplied last.
        for (var i = frames.length - 1; i >= 0; i--) {
            var frame = qrBytes(frames[i]);
            receiver.add(frame);
            assert(receiver.add(frame) === null, 'Duplicate should not change progress');
        }
        var received = await receiver.finish();
        equalBytes(new Uint8Array(await received.data.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
        assert(received.name === file.name, 'Filename changed');
        assert(received.data.type === file.type, 'MIME type changed');
        return prepared.info;
    }

    try {
        // Load source helpers separately for focused protocol tests. The public API above
        // still uses the self-contained distribution bundle, not these globals.
        window.ds = { sliceSize: 250, method: 'qrcode' };
        window.utils = { hashCode: function (text) {
            return Array.from(text).reduce(function (sum, character) { return sum + character.charCodeAt(0) % 123; }, 0);
        } };
        var sources = await (await fetch('../scripts/sources.json')).json();
        for (var source of sources) {
            if (!/^src\/(intro|defaults|main|outro)\.js$/.test(source)) { await load(source); }
        }
        var allBytes = Uint8Array.from({ length: 2048 }, function (_, i) { return i % 256; });
        var file = new File([allBytes], '零/$😀.bin', { type: 'application/octet-stream' });

        await test('Raw binary, every byte 0–255, Unicode filename, reordered and duplicate QR frames', async function () {
            var info = await roundTrip(file, { compress: false });
            assert(info.payloadBytes === allBytes.length && info.compression === 'none');
            assert(info.transmittedBytes < Math.ceil(allBytes.length / 3) * 4, 'Expected savings versus Base64');
        });
        await test('Empty file', async function () {
            await roundTrip(new File([], 'empty.bin', { type: 'application/octet-stream' }), { compress: true });
        });
        await test('Compression when supported, otherwise raw fallback', async function () {
            var info = await roundTrip(new File(['hello world\n'.repeat(1000)], 'text.txt', { type: 'text/plain' }), { compress: true });
            if (typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined') {
                assert(info.compression === 'gzip' && info.payloadBytes < info.originalBytes);
            } else { assert(info.compression === 'none'); }
        });
        await test('Incompressible data stays raw', async function () {
            var random = crypto.getRandomValues(new Uint8Array(1024));
            var prepared = await BinaryTransfer.prepare(new File([random], 'random.bin'), 250, { compress: true });
            assert(prepared.info.compression === 'none');
        });
        await test('Corrupt frames rejected; missing frames do not complete', async function () {
            var prepared = await BinaryTransfer.prepare(file, 250);
            var frames = prepared.sender.getSlices();
            var receiver = new BinaryTransfer.Receiver(1024 * 1024);
            var corrupt = frames[0].slice();
            corrupt[corrupt.length - 1] ^= 1;
            assert(receiver.add(corrupt) === null);
            receiver.add(frames[0]);
            await rejects(function () { return receiver.finish(); }, /Incomplete/);
        });
        await test('Transfer identifiers prevent mixing files', async function () {
            var first = await BinaryTransfer.prepare(file, 250);
            var second = await BinaryTransfer.prepare(file, 250);
            var receiver = new BinaryTransfer.Receiver(1024 * 1024);
            receiver.add(first.sender.getSlices()[0]);
            assert(receiver.add(second.sender.getSlices()[1]) === null);
        });
        await test('SHA-256 rejects changed content even with valid frame CRC32', async function () {
            var prepared = await BinaryTransfer.prepare(file, 250);
            var frames = prepared.sender.getSlices().map(function (frame) { return frame.slice(); });
            var last = frames[frames.length - 1];
            last[last.length - 1] ^= 1;
            updateFrameChecksum(last);
            var receiver = new BinaryTransfer.Receiver(1024 * 1024);
            frames.forEach(function (frame) { receiver.add(frame); });
            await rejects(function () { return receiver.finish(); }, /integrity/);
        });
        await test('Missing compression APIs fall back to raw bytes', async function () {
            var compression = window.CompressionStream;
            try {
                window.CompressionStream = undefined;
                var prepared = await BinaryTransfer.prepare(file, 250, { compress: true });
                assert(prepared.info.compression === 'none');
                assert(prepared.info.payloadBytes === file.size);
            } finally { window.CompressionStream = compression; }
        });
        await test('Compressed files reject unsupported receivers and oversized expansion', async function () {
            if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') { return; }
            var prepared = await BinaryTransfer.prepare(new File(['x'.repeat(10000)], 'compressed.bin'), 1000, { compress: true });
            var frames = prepared.sender.getSlices();
            var receiver = new BinaryTransfer.Receiver(1024 * 1024);
            frames.forEach(function (frame) { receiver.add(frame); });
            var decompression = window.DecompressionStream;
            try {
                window.DecompressionStream = undefined;
                await rejects(function () { return receiver.finish(); }, /cannot decompress/);
            } finally { window.DecompressionStream = decompression; }
            // Same-length JSON edit makes the declared size smaller than actual output.
            var changed = frames[0].slice();
            var metadataLength = new DataView(changed.buffer).getUint32(28);
            var text = new TextDecoder().decode(changed.subarray(32, 32 + metadataLength));
            var smaller = text.replace('"size":10000', '"size": 1000');
            assert(text !== smaller, 'Expected size metadata');
            changed.set(new TextEncoder().encode(smaller), 32);
            updateFrameChecksum(changed);
            receiver = new BinaryTransfer.Receiver(1024 * 1024);
            receiver.add(changed);
            frames.slice(1).forEach(function (frame) { receiver.add(frame); });
            await rejects(function () { return receiver.finish(); }, /allowed size/);
        });
        await test('Receive size limit enforced', async function () {
            var prepared = await BinaryTransfer.prepare(file, 250);
            var receiver = new BinaryTransfer.Receiver(1);
            prepared.sender.getSlices().forEach(function (frame) { receiver.add(frame); });
            await rejects(function () { return receiver.finish(); }, /metadata|size/);
        });
        await test('Invalid chunk sizes rejected and maximum QR byte capacity works', async function () {
            await rejects(function () { return BinaryTransfer.prepare(file, 0); }, /slice size/);
            await rejects(function () { return BinaryTransfer.prepare(file, 2926); }, /slice size/);
            var maximum = Uint8Array.from({ length: 2953 }, function (_, i) { return i % 256; });
            equalBytes(qrBytes(maximum), maximum);
        });
        await test('Binary resend queue preserves original slice index', async function () {
            var prepared = await BinaryTransfer.prepare(file, 250);
            prepared.sender.setQueue('2, 4, 2, invalid, 99999,');
            prepared.sender.nextSlice();
            assert(prepared.sender.getCurrentSliceIndex() === 2);
            prepared.sender.nextSlice();
            assert(prepared.sender.getCurrentSliceIndex() === 4);
            prepared.sender.nextSlice();
            assert(prepared.sender.getCurrentSliceIndex() === 2);
        });
        await test('Legacy text transfer and QR encoding remain compatible', async function () {
            var data = 'data:application/octet-stream;base64,AAECAwQF';
            var slicer = new Slicer();
            var merger = new Merger();
            slicer.setData(data, 'legacy.bin');
            slicer.getSlices().forEach(function (frame) {
                var decoded = qrBytes(frame);
                merger.addData(String.fromCharCode.apply(null, decoded));
            });
            assert(merger.done() === data);
        });
        await test('Public sendFile API, actual raster QR decoding, slice events, and cancellation', async function () {
            var element = output();
            var sender = new DisplaySocket({ output: element, sendingInterval: 10000 });
            var shown;
            sender.addEventListener('sliceShown', function (event) { shown = event; });
            var info = await sender.sendFile(file);
            sender.stop();
            assert(shown.current === 1 && shown.total === info.total);
            var raster = document.createElement('canvas');
            raster.width = raster.height = 720;
            var context = raster.getContext('2d');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, 720, 720);
            context.drawImage(element.querySelector('canvas'), 40, 40);
            var response;
            var reader = new Reader(function (text, bytes) { response = { data: text, rawBytes: bytes }; });
            reader.read(raster);
            assert(response && !response.error && BinaryTransfer.isFrame(response.rawBytes), 'Raster QR did not decode');
            var pending = sender.sendFile(file);
            sender.stop();
            assert(await pending === null, 'Cancelled preparation should not start sending');
            element.remove();
        });
        await test('Full receiver integration using a local canvas camera stream', async function () {
            var camera = document.createElement('canvas');
            assert(typeof camera.captureStream === 'function', 'Canvas camera simulation unavailable');
            camera.width = camera.height = 720;
            var context = camera.getContext('2d');
            var element = output();
            var sender = new DisplaySocket({ output: element, sendingInterval: 180 });
            sender.addEventListener('sliceShown', function () {
                context.fillStyle = '#fff';
                context.fillRect(0, 0, 720, 720);
                context.drawImage(element.querySelector('canvas'), 40, 40);
            });
            var video = document.createElement('video');
            video.autoplay = video.muted = video.playsInline = true;
            fixtures.appendChild(video);
            var stream = camera.captureStream(30);
            var originalGetUserMedia = navigator.getUserMedia;
            navigator.getUserMedia = function (_, success) { success(stream); };
            var timer;
            var received;
            try {
                var complete = new Promise(function (resolve, reject) {
                    timer = setTimeout(function () { reject(new Error('Receiver timed out')); }, 15000);
                    var receiver = new DisplaySocket({ video: video, scanningInterval: 35 });
                    receiver.addEventListener('message', resolve);
                    receiver.addEventListener('error', reject);
                });
                await sender.sendFile(file, { compress: false });
                received = await complete;
                assert(received.binary === true && received.data instanceof Blob);
                equalBytes(new Uint8Array(await received.data.arrayBuffer()), allBytes);
                assert(received.name === file.name && received.size === file.size);
            } finally {
                clearTimeout(timer);
                sender.stop();
                stream.getTracks().forEach(function (track) { track.stop(); });
                navigator.getUserMedia = originalGetUserMedia;
                element.remove();
                video.remove();
            }
        });
        await test('Minified bundle exposes browser file API', async function () {
            await load('dist/displaysocket.min.js');
            var element = output();
            var sender = new DisplaySocket({ output: element, sendingInterval: 10000 });
            var info = await sender.sendFile(new File([], 'empty.bin'));
            sender.stop();
            assert(info.originalBytes === 0 && info.total > 0);
            element.remove();
        });
    } catch (error) {
        failures++;
        lines.push('SETUP FAILURE: ' + error.message);
        document.getElementById('results').textContent = lines.join('\n');
        console.error(error);
    }
    fixtures.replaceChildren();
    window.testResults = { tests: tests, failures: failures, lines: lines };
    document.getElementById('status').textContent = tests + ' tests, ' + failures + ' failures';
})();
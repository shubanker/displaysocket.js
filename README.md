# DisplaySocket.js

DisplaySocket.js is a JavaScript library for sending data from one device to
another using only a display and a camera. This may be useful in situations where

* no other input/output hardware exists or is currently available
* network usage is being restricted and/or monitored
* wireless communication is desired but only visible light can be used and the only accessible hardware is a display and a camera

This library is a work in progress, and will most likely only work in modern browsers. The API is made to resemble the WebSocket API. The library still lacks several features like error handling and closing properly.

So far the highest properly recorded transmission speed of a 1 KiB file has been about 5 kbit/s with an average speed of about 2 kbit/s with an old webcam. The unofficial record is ~13.3 kbit/s one time with a modern smartphone.

## Usage
### Send files as raw binary (recommended)

File transfers run entirely in the browser. Serve the included `dist` bundles and
demos as static files over HTTPS (or localhost). No Node.js server, upload service,
or runtime package is needed. Both devices must use the updated bundle for binary
transfers; existing `send(string, name)` transfers still use the legacy protocol.

```javascript
var sender = new DisplaySocket({ output: document.getElementById('qr') });
var file = document.getElementById('file-input').files[0];
var info = await sender.sendFile(file, { compress: true });
// info: originalBytes, payloadBytes, transmittedBytes, total, compression, name
```

`sendFile(fileOrBlob, options)` returns a Promise. It reads bytes directly, without
Base64 or UTF-8 conversion of file contents. `options.name` can override the file
name. Compression is **off by default**; `{ compress: true }` uses native gzip only
when supported and when the result is smaller. Receiving compressed files requires
`DecompressionStream`; turn off compression when targeting a browser without it.

```javascript
var receiver = new DisplaySocket({ video: document.getElementById('video') });
var downloadUrl;
receiver.addEventListener('message', function (event) {
    // Binary messages contain a verified Blob. Legacy text messages remain strings.
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = event.binary ? URL.createObjectURL(event.data) : null;
    var link = document.getElementById('download');
    link.href = downloadUrl || event.data;
    link.download = event.name;
    link.hidden = false;
});
receiver.addEventListener('error', function (error) {
    console.error(error.message);
});
// Revoke downloadUrl when the download is no longer needed or on pagehide.
```

Binary messages provide `data` (Blob), `name`, `binary: true`, `size`, `compression`,
and `time` (milliseconds). A file is delivered only after size and SHA-256 checks.
CRC32 detects damaged frames; frames can arrive out of order or more than once.
These integrity checks detect corruption, **not sender authenticity or encryption**.

`sliceSize` means payload **bytes** in binary mode (default 250, range 1–2925).
Each QR also includes a 28-byte protocol header. File metadata and the SHA-256 hash
are transmitted once per complete sequence. Raw payloads avoid Base64's roughly
33% expansion, but small files may not be smaller overall due to metadata. Larger
QRs are denser and can scan less reliably; tune size and interval on real devices.

The protocol uses `DSB1` frames, a random transfer ID, zero-based frame index,
frame count, payload length, and CRC32. Its reassembled stream starts with a
big-endian 4-byte JSON metadata length, then UTF-8 metadata and raw/gzipped bytes.
Filename and MIME type are metadata, never part of a delimiter-based binary string.
The entire sequence repeats, so missing metadata or data frames can be received
on later passes. Binary frames are incompatible with old receivers.

The simplex demos also support camera-based missing-slice feedback. The receiver
shows a QR below **Missing slices**, containing at most 100 comma-separated
entries (each number or range counts as one). On the sender, select **Scan pending**, allow camera access,
and scan that QR to update the resend queue automatically. The camera stops after
a successful scan or cancellation. Consecutive indices use compact ranges, e.g.
`pending:4,6-8`; plain `pending:4,6,7,8` is accepted too. No gzip or Base64 is
needed for this short feedback message. If more than 100 entries are needed,
receive the current group, then scan the updated QR again. Make sure both devices
are working on the same file: the short feedback message does not carry a file ID.
The visible/copied list also uses ranges, and the sender accepts pasted ranges.
Ranges can bridge already-received slices when those represent at most 20% of
the range's inclusive length. For example, `1,2,3,6,7,8,10` displays as
`1-3,6-10`, not `1-10` (that would contain 30% already-received slices).
The QR's cap counts entries, not expanded indices: `1-100,200-299` is two
entries requesting 200 slices. Expansion is bounded by the selected file's total
frame count; the missing count still reports only genuinely missing slices.

Additional events:

- `sliceShown`: `{ current, total }`, a **one-based** displayed frame counter.
- `filePrepared`: the same size/compression information returned by `sendFile()`.
- `progress`: binary events include `binary: true`, exact `total`/`found`,
  `percent` in `[0, 1]`, zero-based `current`, and a boolean `progress` array.
- `error`: receive/verification errors. Preparation errors reject `sendFile()`.

`setQueue('0,2,7')` resends original **zero-based** frame indices; an empty or invalid
binary queue restores all frames. `stop()` stops playback and cancels pending file
preparation; a cancelled `sendFile()` resolves to `null` without starting playback.
This mode supports one active incoming file at a time; it does not persist chunks
across reloads. Files are buffered in memory. The default receive limit is 64 MiB;
override it with `maxReceiveBytes` in the receiver constructor when appropriate.
Decompressed size is also bounded. Use a sensible limit for the receiving device.

Binary mode requires modern browser APIs: typed arrays, Blob/File `arrayBuffer()`,
TextEncoder/TextDecoder, and Web Crypto SHA-256 (HTTPS or localhost). Compression is
optional. Camera access still follows browser permissions and secure-context rules.
The bundle embeds jsQR 1.4.0 for byte-preserving image decoding (Apache-2.0; license
included in the generated decoder and bundles). No CDN, module loader, or package
installation is needed on either device. The legacy decoder is retained in source
for compatibility/testing; camera scanning uses jsQR.

### Send data in simplex mode
```
var outputElement = document.getElementById('output'); // e.g. a div
var ds = new DisplaySocket({
    output: outputElement,
    // optionally (values are default values)
    sliceSize: 250, // Send roughly 250 characters with each slice
    baseInterval: 30 // Scanning speed. Writes 4 times slower.
});
ds.send(data);
```

### Read a simplex broadcast
```
var videoOutput = document.getElementById('video');
var ds = new DisplaySocket({videoOutput:videoOutput});

ds.onmessage = function(e) {
    console.log('received', e.message);
};

// alternatively
displaySocket.addEventListener('message', function(e) {
    console.log('received', e.message);
});
```

// TODO duplex documentation. See demos for examples.

## Methods

The only currently working method is using QR-codes. Text based and 1D barcode based methods might also work but have not been successfully implemented yet.

## Options

`video`

Video element that helps the end-user aim their camera.


`output`

Element to which the QR-code, text or other method gets written or drawn.


`sliceSize`

Sets the amount of characters to be input in the output method at one time.
Defaults to 250 characters.


`videoMirrorCanvas`

Canvas element to which the video output gets copied to every N milliseconds where N is the value specified for scanningInterval.
Defaults to creating a new hidden canvas element.


`baseInterval`

How often the video gets scanned and how often output is changed. Defaults to once every 30 milliseconds. So reading occurs at 33.33.. Hz and writing at 8.33.. Hz.


`scanningInterval`

Defaults to baseInterval. How often the video gets scanned.


`sendingInterval`

How often the output is changed to the next slice, aka writing frequency. Defaults to 4 times the base interval.

## Change video source

`ds.nextVideoSource();`

Change to next video source.

## Progress

`var progress = ds.progress();`

`progress.total` // total amount of slices, unknown until first piece is gotten

`progress.found` // total amount of slices that have been received

`progress.progress` // array of booleans where true means a part is found and false means it may be found later

`progress.percent` // if total is known this is found / total, else it is found / progress.length. That means that during simplex transmission the percentage can go down

`progress.current` // the index of the latest slice


## Development

The checked-in distribution bundles run directly in the browser. Rebuilding them
is optional and uses Node.js **only as a development tool**: install development
dependencies with `npm install`, then run `npm run build`. This builds both normal
and minified bundles without requiring certificates. The ordered source manifest
is `scripts/sources.json`.

For browser-native regression tests, serve the repository as static files over
HTTPS or localhost and open `tests/binary.html`. The page tests real QR byte-mode
round trips, all byte values, compressed/empty files, metadata, corrupt/missing/
duplicate frames, receive limits, resend queues, legacy text, raster decoding,
and both distribution bundles. It requires no Node.js test runner or camera.

Run `createCerts.sh` or create your own certificates `ds.key` and `ds.crt`.

Run `grunt serve` to start a webserver at https://localhost:9000. It will also look for changes in files specified by the watch task in `Gruntfile.js`.

Run `grunt dist` to create concatenated and minified files in `dist`.

## Acknowledgements and misc

The core functionality of this library relies on other people's work, namely jsqrcode by Lazar Laszlo and qrcodejs by Shim Sangmin.

The file qrcode.js from jsqrcode has been modified to avoid console.log() clutter.

This is part of my [bachelor's thesis](http://urn.fi/URN:NBN:fi:amk-2015060412394).


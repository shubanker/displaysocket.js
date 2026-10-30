/* Shared, browser-only feedback format. Indices remain zero-based. */
var PendingFeedback = (function () {
  "use strict";
  var LIMIT = 100;
  var CAPTURED_THRESHOLD = 0.2;

  function format(indices, limit) {
    var values = Array.from(new Set(indices)).sort(function (a, b) { return a - b; });
    var remaining = limit === undefined ? Infinity : limit;
    var parts = [];
    for (var i = 0; i < values.length && remaining > 0; i++) {
      var start = values[i];
      var end = start;
      var missing = 1;
      while (i + 1 < values.length) {
        var span = values[i + 1] - start + 1;
        var captured = span - (missing + 1);
        if (span > remaining || captured > span * CAPTURED_THRESHOLD) break;
        end = values[++i];
        missing++;
      }
      remaining -= end - start + 1;
      parts.push(end === start ? String(start) : start + "-" + end);
    }
    return parts.join(",");
  }

  function encode(indices) {
    // The limit counts expanded indices, including captured slices inside ranges.
    return "pending:" + format(indices, LIMIT);
  }

  function parse(content, total, limit) {
    if (!Number.isSafeInteger(total) || total < 1) throw new Error("Select a file before entering pending slices.");
    if (!content.trim()) return [];
    var values = [];
    content.split(",").forEach(function (part) {
      var match = /^(\d{1,10})(?:\s*-\s*(\d{1,10}))?$/.exec(part.trim());
      if (!match) throw new Error("Invalid pending list. Use numbers or ranges such as 1-4,7,10-12.");
      var start = Number(match[1]);
      var end = match[2] === undefined ? start : Number(match[2]);
      if (end < start || end >= total || end - start + 1 > limit - values.length) {
        throw new Error("Pending list has invalid indices or too many slices. Check that both devices use the same file.");
      }
      for (var i = start; i <= end; i++) values.push(i);
    });
    return Array.from(new Set(values));
  }

  function decode(text, total) {
    if (typeof text !== "string" || text.length > 1500 || !text.startsWith("pending:")) {
      throw new Error("Scan a pending-slices QR from the receiving device.");
    }
    var content = text.slice(8);
    if (!content) throw new Error("This QR contains no missing slices.");
    var values = parse(content, total, LIMIT);
    if (!values.length) throw new Error("This QR contains no missing slices.");
    return values;
  }

  function Scanner(video, onResult, onStatus) {
    var stream = null;
    var timer = null;
    var request = 0;
    var canvas = document.createElement("canvas");
    var context = canvas.getContext("2d", { willReadFrequently: true });

    this.stop = function () {
      request++;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
      video.srcObject = null;
    };

    this.start = async function () {
      this.stop();
      var current = request;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Camera scanning requires HTTPS or localhost and a supported browser.");
        }
        onStatus("Allow camera access, then scan the receiver’s pending QR.");
        var acquired = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } }, audio: false,
        });
        if (current !== request) {
          acquired.getTracks().forEach(function (track) { track.stop(); });
          return;
        }
        stream = acquired;
        video.srcObject = stream;
        await video.play();
        if (current !== request) return;
        function scan() {
          if (current !== request) return;
          try {
            if (video.readyState >= 2 && video.videoWidth) {
              var scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
              canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
              canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              var image = context.getImageData(0, 0, canvas.width, canvas.height);
              var result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
              if (result && onResult(result.data)) return;
            }
          } catch (error) { onStatus(error.message); }
          timer = setTimeout(scan, 180);
        }
        scan();
      } catch (error) {
        if (current !== request) return;
        this.stop();
        onStatus(error.message || "Could not open the camera.");
      }
    };
  }

  return { encode: encode, decode: decode, format: format,
    parse: function (text, total) { return parse(text, total, total); },
    Scanner: Scanner, limit: LIMIT };
})();
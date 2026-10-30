/* Shared, browser-only feedback format. Indices remain zero-based. */
var PendingFeedback = (function () {
  "use strict";
  var LIMIT = 100;

  function encode(indices) {
    var values = Array.from(new Set(indices)).sort(function (a, b) { return a - b; }).slice(0, LIMIT);
    var parts = [];
    for (var i = 0; i < values.length; i++) {
      var start = values[i];
      var end = start;
      while (i + 1 < values.length && values[i + 1] === end + 1) end = values[++i];
      parts.push(end - start >= 2 ? start + "-" + end :
        (end === start ? String(start) : start + "," + end));
    }
    return "pending:" + parts.join(",");
  }

  function decode(text, total) {
    if (typeof text !== "string" || text.length > 1500 || !text.startsWith("pending:")) {
      throw new Error("Scan a pending-slices QR from the receiving device.");
    }
    if (!Number.isSafeInteger(total) || total < 1) throw new Error("Select a file before scanning pending slices.");
    var content = text.slice(8);
    if (!content) throw new Error("This QR contains no missing slices.");
    var values = [];
    content.split(",").forEach(function (part) {
      var match = /^(\d{1,10})(?:-(\d{1,10}))?$/.exec(part);
      if (!match) throw new Error("Invalid pending-slices QR.");
      var start = Number(match[1]);
      var end = match[2] === undefined ? start : Number(match[2]);
      if (end < start || end >= total || end - start + 1 > LIMIT - values.length) {
        throw new Error("Pending QR has invalid indices or more than 100 slices. Check that both devices use the same file.");
      }
      for (var i = start; i <= end; i++) values.push(i);
    });
    return Array.from(new Set(values));
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

  return { encode: encode, decode: decode, Scanner: Scanner, limit: LIMIT };
})();
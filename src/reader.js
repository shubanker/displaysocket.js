/* global ds */
/* global jsQR */

function Reader(callback) { // jshint ignore:line
    'use strict';

    return {

        read: function(canvas) {
            if(ds.method === 'text') {
                console.error('Text method not implemented.');
                // if it were implemented, it might go something like this:
                //var str = ocr(canvas);
                //callback(str);
            } else {
                if (!canvas.width || !canvas.height) { return; }
                var context = canvas.getContext('2d');
                var image = context.getImageData(0, 0, canvas.width, canvas.height);
                var result = jsQR(image.data, image.width, image.height, {
                    inversionAttempts: 'dontInvert'
                });
                if (result) {
                    var bytes = new Uint8Array(result.binaryData);
                    callback(result.data, bytes);
                }
            }
        }

    };
}

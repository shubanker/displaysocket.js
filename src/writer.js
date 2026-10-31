/* global QRCode */
/* global TextWriter */

function Writer(outputElement, method) { // jshint ignore:line
    'use strict';
    var chosenWriter = {};
    var chosenWriterFunction = function() {};
    switch(method) {
        case 'text':
            var textWriter = new TextWriter(outputElement);
            chosenWriter = textWriter;
            chosenWriterFunction = textWriter.write;
            break;
        default:
            var qrcode;
            chosenWriterFunction = function(text) {
                // Sender previews may be hidden until a transfer starts.
                // Measure only when writing, after the preview is revealed.
                if (!qrcode) {
                    qrcode = new QRCode(outputElement, {
                        text: '',
                        width: outputElement.offsetWidth || 256,
                        height: outputElement.offsetHeight || 256,
                        colorDark: '#000000',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.L
                    });
                }
                qrcode.makeCode(text);
            };
            break;
    }


    return {
        write: function(text) {
            chosenWriterFunction.apply(chosenWriter, [text]);
        }
    };
}


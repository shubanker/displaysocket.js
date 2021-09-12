/* global ds */
/* global utils */

function Slicer(data) {
  // jshint ignore:line
  "use strict";
  var sliceSize = ds.sliceSize;
  var currentSlice = -1; // so when we call nextSlice we get 0
  data = data || null;

  var slices = null;
  var queuedSlices = null;
  if (data) {
    slices = slice(data);
  }

  function slice(data, name) {
    sliceSize = ds.sliceSize;
    var amount = Math.floor(data.length / sliceSize);
    var result = [];
    var wholeChecksum = utils.hashCode(data);
    for (var i = 0; i <= amount + 1; i++) {
      if (i === 0) {
        result[i] =
          i +
          "/" +
          amount +
          "/" +
          (name || "download") +
          "/" +
          wholeChecksum +
          "$";
      } else {
        var part = data.substr((i - 1) * sliceSize, sliceSize);
        result[i] = i + "/" + utils.hashCode(part) + "$";
        result[i] += part;
      }
    }
    return result;
  }

  return {
    setData: function (data, name) {
      slices = slice(data, name);
      queuedSlices = slices;
    },

    getSlices: function () {
      return slices;
    },

    nextSlice: function () {
      currentSlice = (currentSlice + 1) % queuedSlices.length;
      return queuedSlices[currentSlice];
    },
    setQueue: function (queue) {
      if (queue) {
        queuedSlices = [];
        queue.split(",").forEach(function (index) {
          index = index.trim();
          if (slices[index]) {
            queuedSlices.push(slices[index]);
          }
        });
      }
      if (!queuedSlices.length || !queue) {
        queuedSlices = slices;
      }
    },

    getCurrentSlice: function () {
      return slices[currentSlice];
    },

    getCurrentSliceIndex: function () {
      return currentSlice;
    },
  };
}

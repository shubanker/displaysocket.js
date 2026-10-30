/* Optional IndexedDB checkpoint: one active receive transfer per database name. */
function ReceiveCheckpoint(name) {
    'use strict';
    var database;
    var activeId = null;
    var queue = Promise.resolve();
    function open() {
        if (!database) {
            database = new Promise(function (resolve, reject) {
                if (!globalThis.indexedDB) { reject(new Error('IndexedDB is unavailable.')); return; }
                var request = indexedDB.open(name, 1);
                request.onupgradeneeded = function () { request.result.createObjectStore('frames'); };
                request.onsuccess = function () {
                    request.result.onversionchange = function () { request.result.close(); };
                    resolve(request.result);
                };
                request.onerror = function () { reject(request.error); };
                request.onblocked = function () { reject(new Error('Receive storage is blocked by another tab.')); };
            });
        }
        return database;
    }
    function transaction(action) {
        var result = queue.then(async function () {
            var db = await open();
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('frames', 'readwrite');
                var value;
                tx.oncomplete = function () { resolve(value); };
                tx.onabort = function () { reject(tx.error || new Error('Checkpoint transaction aborted.')); };
                tx.onerror = function () { /* onabort reports the error */ };
                action(tx.objectStore('frames'), function (data) { value = data; });
            });
        });
        queue = result.catch(function () {});
        return result;
    }
    this.load = function () {
        return transaction(function (store, result) {
            var request = store.getAll();
            request.onsuccess = function () {
                var frames = request.result;
                if (frames.length) activeId = Array.from(frames[0].subarray(4, 12)).join(',');
                result(frames);
            };
        });
    };
    this.save = function (frame) {
        var copy = frame.slice();
        return transaction(function (store) {
            var id = Array.from(copy.subarray(4, 12)).join(',');
            if (id !== activeId) { store.clear(); activeId = id; }
            var index = new DataView(copy.buffer).getUint32(12);
            store.put(copy, index);
        });
    };
    this.clear = function () {
        return transaction(function (store) { store.clear(); activeId = null; });
    };
}
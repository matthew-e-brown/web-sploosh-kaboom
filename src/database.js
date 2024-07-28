/**
 * Requests the `splooshkaboom` IndexedDB database.
 * @param {number} version The schema version to use.
 * @returns {Promise<IDBDatabase>} A promise containing the IndexedDB object.
 */
function dbOpen(version = 1) {
    return new Promise((resolve, reject) => {
        /**
         * Adds event listeners to the finally-opened database and resolves the
         * promise with it.
         * @param {IDBDatabase} db
         */
        const onOpen = (db) => {
            db.onversionchange = (ev) => {
                console.warn(
                    `Another tab/window has requested a database version change ` +
                    `from version ${ev.oldVersion} to ${ev.newVersion}.`
                );
            }

            db.onerror = (ev) => {
                window.alert(`Uncaught IndexedDB error: ${ev.target.errorCode}`);
                throw ev; // this throw occurs later, e.g. when doing transactions
            };

            db.onclose = (ev) => {
                // https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/close_event
                window.alert(`IndexedDB closed. Restart the tab to re-initialize.`);
                throw ev;
            }

            resolve(db);
        }

        const request = window.indexedDB.open('splooshkaboom', version);

        request.onerror = (event) => reject(event.target.errorCode);
        request.onblocked = () => {
            window.alert(
                "Sploosh Kaboom failed to initialize local cache: " +
                "another open tab or window has an old version of the " +
                "site still open. Please close that tab and try again."
            );

            // Rejecting with an actual error object for consistency with
            // `onerror`, which uses the request's `DOMException` object.
            reject(new Error("Database initialization blocked by another tab/window."));
        }

        request.onsuccess = () => onOpen(request.result);
        request.onupgradeneeded = (event) => dbInit(request.result, event)
            .then(() => onOpen(request.result))
            .catch(reject);
    });
}

/**
 * Initializes or upgrades the database schema.
 * @param {IDBDatabase} db The database being upgraded.
 * @param {IDBVersionChangeEvent} event The version change event.
 * @returns {Promise<void>} A promise that resolves when the `sk` object
 * store has been created.
 */
function dbInit(db, { oldVersion, newVersion }) {
    return new Promise((resolve, reject) => {
        if (oldVersion !== 0 || newVersion !== 1) {
            // TODO: Implement a database migration here if the schema ever
            // changes (i.e. if this app ever updates to us IndexedDB
            // differently).
            reject(new Error("splooshkaboom database v2 is not yet implemented."));
        }

        const store = db.createObjectStore('sk');
        store.transaction.oncomplete = (_ev) => resolve();
        store.transaction.onerror = (_ev) => reject(store.transaction.error);
    });
}


const dbSingleton = dbOpen();

/**
 * Reads a value from the IndexedDB.
 * @param {any} key
 * @returns {Promise<any>} A promise containing the data from the IndexedDB.
 */
export async function dbRead(key) {
    const db = await dbSingleton;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('sk', 'readonly');
        const store = transaction.objectStore('sk');
        const request = store.get(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            // When we get a result, tell the transaction that we're
            // finished reading (not *required*, but otherwise the commit
            // won't happen until the event loop is finished processing).
            transaction.commit();
            resolve(request.result);
        }
    });
}


/**
 * Writes a value to the IndexedDB.
 * @param {any} key The key of the entry to write.
 * @param {any} value The value to write to the IndexedDB.
 * @returns {Promise<void>} A promise which resolves when the transaction is
 * complete and committed.
 */
export async function dbWrite(key, value) {
    const db = await dbSingleton;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('sk', 'readwrite');
        const store = transaction.objectStore('sk');

        // Note: `put` does not cause a failure when writing with a
        // duplicate key.
        const request = store.put(value, key);

        // Tell the OS to actually commit the transaction, but don't resolve
        // the promise until the transaction completes.
        // https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event
        request.onsuccess = () => transaction.commit();
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve();
    });
}

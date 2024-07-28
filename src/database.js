export default class Database {
    /** @property {IDBDatabase} db The raw IDB handle. */
    db;

    /**
     * Initializes a new Promise-based wrapper class around an IndexedDB.
     * @param {IDBDatabase} db The database.
     */
    constructor(db) {
        if (!db)
            throw new Error("IndexedDB not initialized correctly.");

        this.db = db;

        // This should never really happen, unless a new version
        this.db.onversionchange = (ev) => {
            console.warn(
                `Another tab/window has requested a database version change, ` +
                `from version ${ev.oldVersion} to ${ev.newVersion}.`
            );
        }

        this.db.onerror = this.onError.bind(this);
    }


    /**
     * Reads a value from the IndexedDB.
     * @param {any} key
     * @returns {Promise<any>} A promise containing the data from the IndexedDB.
     */
    read(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction('sk', 'readonly');
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
    write(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction('sk', 'readwrite');
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


    /**
     * @param {Event} event
     */
    onError(event) {
        window.alert(`IndexedDB error: ${event.target.errorCode}`);
        throw event;
    }


    onClose(event) {
        // https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/close_event
        window.alert(`IndexedDB closed. Restart the tab to re-initialize.`);
        throw event;
    }


    /**
     * Requests the `splooshkaboom` IndexedDB database.
     * @param {number} version The version of the `splooshkaboom` database
     * schema to use.
     * @returns {Promise<Database>} A wrapper object for the raw IndexedDB
     * database.
     */
    static open(version = 1) {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open('splooshkaboom', version);

            request.onerror = () => reject(request.error);

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

            request.onupgradeneeded = (ev) => {
                Database.init(request.result, ev.oldVersion, ev.newVersion)
                    .then(() => resolve(new Database(request.result)))
                    .catch(reject);
            }

            request.onsuccess = () => resolve(new Database(request.result));
        });
    }

    /**
     * Initializes or upgrades the database schema.
     * @param {IDBDatabase} db The database being upgraded.
     * @param {number} oldVersion The old version from the
     * `IDBVersionChangeEvent`.
     * @param {number} newVersion The new, requested version.
     * @returns {Promise<void>} A promise that resolves when the `sk` object
     * store has been created.
     */
    static init(db, oldVersion, newVersion) {
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
}

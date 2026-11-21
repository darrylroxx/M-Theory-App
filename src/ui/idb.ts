// The browser's larger store, as the storage code wants it: texts by name, in the database `m-theory`, store `backup`.
// It holds the old app state as it was when it was moved over, and old ideas kept one by one. Where the browser has no
// such store (some private windows and embedded viewers) there is none: `openBlobs` gives null, and the old data stays
// where it was.
import type { Blobs } from "../timeline/store5";

const DB = "m-theory";
const STORE = "backup";

let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("the store cannot be opened"));
    req.onblocked = () => reject(new Error("the store is in use"));
  });
  // (a store that could not be opened is tried again the next time it is asked for)
  opened.catch(() => { opened = null; });
  return opened;
}

/** The real store, or null where the browser has none. */
export function openBlobs(): Blobs | null {
  if (typeof indexedDB === "undefined" || !indexedDB) return null;
  return {
    async get(k) {
      const d = await db();
      return new Promise<string | null>((resolve, reject) => {
        const req = d.transaction(STORE, "readonly").objectStore(STORE).get(k);
        req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
        req.onerror = () => reject(req.error ?? new Error("the store cannot be read"));
      });
    },
    async put(k, v) {
      const d = await db();
      return new Promise<void>((resolve, reject) => {
        const tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(v, k);
        // (done only when the browser says the whole write is)
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("the store cannot be written"));
        tx.onabort = () => reject(tx.error ?? new Error("the store cannot be written"));
      });
    },
  };
}

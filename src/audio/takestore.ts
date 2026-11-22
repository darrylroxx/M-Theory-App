/**
 * Recordings made in a browser, kept in the browser's own larger store (IndexedDB).
 *
 * The desktop app records to files on disk. A browser has no such files, so a recording made there (see webrec.ts)
 * is kept here, whole, as the samples it was taken as, under an id. A take of it names it as `idb:<id>` where a take
 * from the desktop app names a file, and the take cache (takebuffers.ts) reads it from here. It stays in the browser
 * it was recorded in: another browser, or the desktop app, opening the same idea finds the take but not its sound.
 * Nothing here is ever removed by an edit of the song, as no edit removes a file from disk.
 */

/** A recording as it is kept: its sample rate, and one list of samples for each channel (one, or left and right). */
export interface StoredSound {
  rate: number;
  channels: Float32Array[];
}

const PREFIX = "idb:";
/** What a take calls a recording kept here. */
export const storedName = (id: string): string => `${PREFIX}${id}`;
/** Is this take's file a recording kept in the browser's store? */
export const isStored = (path: string): boolean => path.startsWith(PREFIX);
const idOf = (path: string): string => path.slice(PREFIX.length);

const DB = "m-theory-takes";
const STORE = "takes";

let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !indexedDB) return reject(new Error("this browser has no store for recordings"));
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

/** the recording read last, kept: the passes of one recording are read one after another */
let last: { path: string; sound: Promise<StoredSound | null> } | null = null;

/** Keep a recording under `id`. Resolves once the browser says the whole of it is written. */
export async function putSound(id: string, sound: StoredSound): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ rate: sound.rate, channels: sound.channels }, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("the recording cannot be kept"));
    tx.onabort = () => reject(tx.error ?? new Error("the recording cannot be kept"));
  });
  last = { path: storedName(id), sound: Promise.resolve(sound) };
}

/** The recording a take names (`idb:<id>`), or null when this browser does not have it. */
export function getSound(path: string): Promise<StoredSound | null> {
  if (last?.path === path) return last.sound;
  const sound = db().then((d) => new Promise<StoredSound | null>((resolve, reject) => {
    const req = d.transaction(STORE, "readonly").objectStore(STORE).get(idOf(path));
    req.onsuccess = () => {
      const r = req.result as Partial<StoredSound> | undefined;
      resolve(r && typeof r.rate === "number" && Array.isArray(r.channels) && r.channels.length > 0 ? { rate: r.rate, channels: r.channels } : null);
    };
    req.onerror = () => reject(req.error ?? new Error("the store cannot be read"));
  }));
  last = { path, sound };
  // (one that could not be read is asked for again the next time)
  sound.catch(() => { if (last?.sound === sound) last = null; });
  return sound;
}

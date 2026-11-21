// Where the app's state is kept once a song is tracks and clips, and the one moment old data is moved over.
//
// The new state lives under a new key. The old key is never written by this build: after the old state has been
// converted in memory, its text is copied, byte for byte, into the browser's larger store, read back and compared;
// only when that copy and the new key have both been read back equal is the old key removed. Whatever goes wrong on
// the way, the old text stays where it is. Everything here works on two small interfaces, so it can be run with
// pretend stores.
import type { App5State } from "../ui/app5";
import { DEFAULT_STATE, loadV4, type AppStateV4 } from "../ui/state";
import { BLOB, BLOB_LATE, convertAll, newSession } from "./convert";
import { reviveIdea5, reviveSong5, type SavedIdea } from "./library5";
import type { Clipboard5, Region, Session, Take5, Track, WinState } from "./model";

/** Local storage: `set` throws when there is no room. */
export interface KV { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }
/** The browser's larger store (IndexedDB database `m-theory`, store `backup`). */
export interface Blobs { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> }

export const KEY_V1 = "m-theory-state-v1", KEY_V2 = "m-theory-state-v2";

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A short mark of a text, to tell later whether a copy is still the same text. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── loading ─────────────────────────────────────────────────

function reviveSession(raw: unknown): Session {
  const base = newSession();
  if (!isObj(raw)) return { ...base, pxPerBeat: 0 };
  const regions: Region[] = [];
  const loop = isObj(raw.loop) ? raw.loop : null;
  for (const r of loop && Array.isArray(loop.regions) ? loop.regions : []) if (isObj(r) && num(r.from) && num(r.to) && r.from >= 0 && r.to > r.from) regions.push({ from: r.from, to: r.to });
  const sel = isObj(raw.sel) ? raw.sel : {};
  const windows: WinState[] = [];
  for (const w of Array.isArray(raw.windows) ? raw.windows : []) {
    if (!isObj(w) || typeof w.id !== "string" || typeof w.track !== "string" || (w.kind !== "compose" && w.kind !== "sound") || ![w.x, w.y, w.w, w.h].every(num) || windows.some((x) => x.id === w.id)) continue;
    windows.push({ id: w.id, kind: w.kind, track: w.track, ...(typeof w.clip === "string" ? { clip: w.clip } : {}), x: w.x as number, y: w.y as number, w: w.w as number, h: w.h as number, open: w.open === true });
  }
  return {
    cursor: num(raw.cursor) && raw.cursor >= 0 ? raw.cursor : 0,
    loop: regions.length ? { regions, on: loop?.on === true } : null,
    sel: { clips: Array.isArray(sel.clips) ? sel.clips.filter((x): x is string => typeof x === "string") : [], track: typeof sel.track === "string" ? sel.track : null },
    pxPerBeat: num(raw.pxPerBeat) && raw.pxPerBeat > 0 ? raw.pxPerBeat : 0,
    scroll: num(raw.scroll) && raw.scroll > 0 ? raw.scroll : 0,
    // (never stored: nothing records until a track is armed again)
    armed: null,
    windows,
  };
}

/** What was last copied, made safe: its clips and tracks are read as a song's are (a clip its track cannot hold is dropped). */
function reviveClipboard(raw: unknown): Clipboard5 | undefined {
  if (!isObj(raw) || !isObj(raw.key) || typeof raw.key.tonic !== "string" || typeof raw.key.scaleId !== "string" || !Array.isArray(raw.clips) || !Array.isArray(raw.tracks)) return undefined;
  const takes = Array.isArray(raw.takes) ? raw.takes : [];
  // (the takes travel beside the tracks: each track is given them for the reading, so its audio clips find theirs)
  const song = reviveSong5({ bpm: 120, tracks: raw.tracks.map((t) => (isObj(t) && (t.kind === "vocals" || t.kind === "audio") ? { ...t, takes } : t)), clips: raw.clips });
  if (!song.clips.length) return undefined;
  const kept: Take5[] = [];
  const tracks = song.tracks.map((t): Track => {
    if (t.kind !== "vocals" && t.kind !== "audio") return t;
    for (const k of t.takes) if (!kept.some((x) => x.id === k.id) && song.clips.some((c) => c.kind === "audio" && c.take === k.id)) kept.push(k);
    return { ...t, takes: [] };
  });
  return { key: { tonic: raw.key.tonic, scaleId: raw.key.scaleId }, clips: song.clips, tracks, takes: kept };
}

/** A stored version 5 state made whole. null: the text is not a state at all. */
export function reviveState5(text: string): App5State | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || !isObj(raw.song)) return null;
  // what the old state and the new one share is made safe by the old loader (settings, the canvas, the studio, the view)
  const shared = loadV4(JSON.stringify({ ...raw, progression: undefined, saved: [], clip: undefined, song: undefined, session: undefined }));
  const key = isObj(raw.key) && typeof raw.key.tonic === "string" && typeof raw.key.scaleId === "string" ? { tonic: raw.key.tonic, scaleId: raw.key.scaleId } : DEFAULT_STATE.key;
  const saved: SavedIdea[] = [];
  for (const i of Array.isArray(raw.saved) ? raw.saved : []) {
    const idea = reviveIdea5(i);
    if (idea && !saved.some((x) => x.id === idea.id)) saved.push(idea);
  }
  const tombs: Record<string, number> = {};
  if (isObj(raw.tombs)) for (const [id, at] of Object.entries(raw.tombs)) if (num(at)) tombs[id] = at;
  const conv = isObj(raw.converted) ? raw.converted : null;
  const blob = conv && isObj(conv.blob) && num(conv.blob.len) && typeof conv.blob.hash === "string" && (conv.blob.where === "idb" || conv.blob.where === "local") ? { len: conv.blob.len, hash: conv.blob.hash, where: conv.blob.where as "idb" | "local" } : undefined;
  const times: Record<string, number> = {};
  if (conv && isObj(conv.ideas)) for (const [id, at] of Object.entries(conv.ideas)) if (num(at)) times[id] = at;
  const clip = reviveClipboard(raw.clip);
  const inputs = isObj(raw.studio) && num(raw.studio.inputs) && raw.studio.inputs > 0 ? Math.round(raw.studio.inputs) : undefined;
  const studio = shared.studio ? { ...shared.studio, ...(inputs ? { inputs } : {}) } : undefined;
  return {
    key, settings: shared.settings,
    song: reviveSong5(raw.song), saved, session: reviveSession(raw.session),
    shapes: shared.shapes, myBeats: shared.myBeats, myKits: shared.myKits, mySounds: shared.mySounds,
    ...(shared.canvas ? { canvas: shared.canvas } : {}),
    ideaId: typeof raw.ideaId === "string" && saved.some((i) => i.id === raw.ideaId && !i.backup) ? raw.ideaId : null,
    ...(typeof raw.draft === "string" ? { draft: raw.draft } : {}),
    tombs,
    ...(clip ? { clip } : {}), ...(studio ? { studio } : {}), ...(shared.view ? { view: shared.view } : {}),
    ...(conv ? { converted: { at: num(conv.at) ? conv.at : 0, ...(blob ? { blob } : {}), ideas: times, ...(num(conv.size) ? { size: conv.size } : {}) } } : {}),
  };
}

/** The state a new app starts with: nothing saved, and an empty idea with the three tracks every idea starts with. */
export function freshState(draft?: string): App5State {
  const { converted: _c, ...s } = convertAll(DEFAULT_STATE, 0);
  return { ...s, session: { ...newSession(), pxPerBeat: 0 }, ideaId: null, ...(draft ? { draft } : {}), tombs: {} };
}

/**
 * What `load5` found.
 *  - `v1`: the old state's text, converted in memory just now (it still has to be settled: see `settleConversion`).
 *  - `fresh`: nothing was stored at all.
 *  - `stuck`: what is stored could not be read ("v2": the new state; "v1": the old one; "storage": the store itself).
 *    It is left exactly as it is, and nothing may be written until it has been looked at: the app runs in memory.
 */
export interface Loaded { state: App5State; v1?: string; fresh?: true; stuck?: "v1" | "v2" | "storage" }

/**
 * The stored version 5 state, or the version 4 one converted in memory. Conversion never runs over a new key that
 * exists, readable or not. Nothing is written here.
 */
export function load5(kv: KV, draft?: string): Loaded {
  let v2: string | null;
  let v1: string | null;
  try {
    v2 = kv.get(KEY_V2);
    v1 = v2 === null ? kv.get(KEY_V1) : null;
  } catch {
    return { state: freshState(draft), stuck: "storage" };
  }
  if (v2 !== null) {
    const state = reviveState5(v2);
    return state ? { state } : { state: freshState(draft), stuck: "v2" };
  }
  if (v1 === null || v1 === "") return { state: freshState(draft), fresh: true };
  // the old loader gives its own starting state for a text it cannot read: that must never be taken for the user's ideas
  let old: AppStateV4;
  try {
    old = isObj(JSON.parse(v1)) ? loadV4(v1) : DEFAULT_STATE;
  } catch {
    old = DEFAULT_STATE;
  }
  if (old === DEFAULT_STATE) return { state: freshState(draft), stuck: "v1" };
  try {
    const state = convertAll(old);
    return { state: { ...state, session: { ...state.session, pxPerBeat: 0 }, ...(state.draft || !draft ? {} : { draft }) }, v1 };
  } catch {
    return { state: freshState(draft), stuck: "v1" };
  }
}

// ── writing ─────────────────────────────────────────────────

/** The state as it is written: without what is never stored (the failed-write mark, the armed track). */
export function storedText(state: App5State): string {
  const { unsaved: _u, ...rest } = state;
  return JSON.stringify({ ...rest, session: { ...state.session, armed: null } });
}

/** Every later write (the caller waits a moment between them): true when it worked. */
export function save5(kv: KV, state: App5State): boolean {
  try {
    kv.set(KEY_V2, storedText(state));
    return true;
  } catch {
    return false;
  }
}

const withMark = (s: App5State, ok: boolean): App5State => {
  if (ok) {
    if (!s.unsaved) return s;
    const { unsaved: _u, ...rest } = s;
    return rest;
  }
  return s.unsaved ? s : { ...s, unsaved: true };
};

/**
 * The first start of the new build, once the converted state is on screen. `v1` is the old text `load5` converted.
 *
 *  3. the old text is copied into the larger store, read back and compared;
 *  4. the new key is written, read back and compared; if there is no room and step 3 worked, the old key is removed
 *     (its copy is safe) and the write tried once more;
 *  5. when both worked the old key is removed, and the state notes where the old text is now ("idb"). Where the larger
 *     store cannot be used the old key stays as it is and is the backup store ("local");
 *  6. if the new key still cannot be written the state says `unsaved`; the old text is put back under its key when it
 *     had been removed to make room, so the next start finds it;
 *  7. the old and the new size are noted, and printed once.
 */
export async function settleConversion(kv: KV, blobs: Blobs | null, state: App5State, v1: string): Promise<App5State> {
  // 3.
  let copied = false;
  if (blobs) {
    try {
      await blobs.put(BLOB, v1);
      copied = (await blobs.get(BLOB)) === v1;
    } catch {
      copied = false;
    }
  }
  const mark = (where: "idb" | "local", size: number): App5State => ({ ...state, converted: { at: state.converted?.at ?? Date.now(), ideas: state.converted?.ideas ?? {}, blob: { len: v1.length, hash: hashText(v1), where }, size } });
  const write = (s: App5State): boolean => {
    try {
      const text = storedText(s);
      kv.set(KEY_V2, text);
      return kv.get(KEY_V2) === text;
    } catch {
      return false;
    }
  };
  const size = storedText(state).length;
  let out = mark(copied ? "idb" : "local", size);
  // 4.
  let ok = write(out);
  let removed = false;
  if (!ok && copied) {
    try {
      kv.remove(KEY_V1);
      removed = true;
    } catch {
      /* (it stays: the write is tried again all the same) */
    }
    ok = write(out);
  }
  if (ok) {
    // 5.
    if (copied && !removed) {
      try {
        kv.remove(KEY_V1);
      } catch {
        // the old key could not be taken away: it stays the backup store
        out = mark("local", size);
        write(out);
      }
    }
    // 7.
    if (typeof console !== "undefined") console.info(`Ideas moved to the track view: the old data was ${v1.length} characters, the new is ${size}.`);
    return withMark(out, true);
  }
  // 6. (a new key half written is taken away again, so the next start converts afresh from the old text)
  try {
    kv.remove(KEY_V2);
  } catch {
    /* nothing to do */
  }
  if (removed) {
    try {
      kv.set(KEY_V1, v1);
      if (kv.get(KEY_V1) === v1) out = mark("local", size);
    } catch {
      /* the old text is in the larger store: `recover5` finds it at the next start */
    }
  }
  return withMark(out, false);
}

/**
 * A start that found nothing stored: was a conversion made before whose result could never be written? Then the old
 * text is still in the larger store, and is converted again from there (the same text gives the same ideas).
 */
export async function recover5(blobs: Blobs | null): Promise<{ state: App5State; v1: string } | null> {
  if (!blobs) return null;
  try {
    const v1 = await blobs.get(BLOB);
    if (!v1) return null;
    const old = isObj(JSON.parse(v1)) ? loadV4(v1) : DEFAULT_STATE;
    if (old === DEFAULT_STATE) return null;
    const state = convertAll(old);
    return { state: { ...state, session: { ...state.session, pxPerBeat: 0 } }, v1 };
  } catch {
    return null;
  }
}

// ── an old tab writes the old key again ─────────────────────

/**
 * The old key is there again after it was moved (an old tab that was open during the update wrote it): its text is
 * kept as the late copy, and the key is removed once that copy has been read back equal. Only where the old text was
 * moved to the larger store; otherwise the old key is the backup store and stays. Returns the text, to take its ideas in.
 */
export async function takeLate(kv: KV, blobs: Blobs | null, state: App5State): Promise<string | null> {
  let text: string | null;
  try {
    text = kv.get(KEY_V1);
  } catch {
    return null;
  }
  if (!text) return null;
  if (state.converted?.blob?.where !== "idb" || !blobs) return text;
  try {
    await blobs.put(BLOB_LATE, text);
    if ((await blobs.get(BLOB_LATE)) === text && kv.get(KEY_V1) === text) kv.remove(KEY_V1);
  } catch {
    /* it stays where it is */
  }
  return text;
}

/**
 * Recorded takes, read from disk and decoded once, ready to play with the song. (A take recorded in a browser is
 * read from the browser's own store instead: see `readStored`.) A take is as its file is: one channel for a voice as
 * it was sung, two for its version through the vocal sound and for both files of a pair of inputs.
 *
 * Only the take itself is read: its part of the recording comes over from the engine as a
 * small file of its own, so a pass from an hour-long session costs no more memory than any
 * other. Each buffer starts at the take's first frame. The takes the song plays are kept; of
 * the rest (takes heard alone), only the few heard last.
 */
import { audioContext } from "./context";
import { isDesktop, readTakeRange } from "../desktop";
import { getSound, isStored } from "./takestore";

/** A take as this cache knows it: which file, and which part of it (frames). */
export interface TakeRef {
  wet: string;
  start: number;
  frames: number;
}
export const takeKey = (t: TakeRef): string => `${t.wet}#${t.start}+${t.frames}`;

/** decoded takes, the one used last at the end */
const ready = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
/** the takes the song plays: never let go */
let wanted = new Set<string>();
/** how many other takes are kept, besides */
const SPARE = 8;

export function takeBuffer(t: TakeRef): AudioBuffer | undefined {
  const k = takeKey(t);
  const b = ready.get(k);
  if (b) {
    ready.delete(k);
    ready.set(k, b);
  }
  return b;
}

export function loadTake(t: TakeRef): Promise<AudioBuffer | null> {
  const have = takeBuffer(t);
  if (have) return Promise.resolve(have);
  const k = takeKey(t);
  let p = loading.get(k);
  if (!p) {
    p = (isStored(t.wet) ? readStored(t) : readTakeRange(t.wet, t.start, t.frames).then((bytes) => audioContext().decodeAudioData(bytes)))
      .then((buf) => {
        if (!buf) return null;
        ready.set(k, buf);
        trim();
        return buf;
      })
      .catch(() => null)
      .finally(() => loading.delete(k));
    loading.set(k, p);
  }
  return p;
}

/**
 * Can a take's sound be read here at all? A file on disk only in the desktop app, where the recordings are; a
 * recording made in a browser only from that browser's store (wherever it is asked for, it is looked for there).
 */
export const canLoad = (t: Pick<TakeRef, "wet">): boolean => isStored(t.wet) || isDesktop();

/**
 * A take of a recording made in a browser (its file is `idb:<id>`: see takestore.ts): its part of the recording, as
 * a buffer with the recording's own channels (one, or left and right) at the rate it was recorded at. A part before
 * the recording's first frame, or past its last, is silence, as it is for a file. Null when this browser does not
 * have the recording.
 */
async function readStored(t: TakeRef): Promise<AudioBuffer | null> {
  const sound = await getSound(t.wet);
  if (!sound) return null;
  const start = Math.round(t.start);
  const frames = Math.max(1, Math.round(t.frames));
  const buf = audioContext().createBuffer(sound.channels.length, frames, sound.rate);
  sound.channels.forEach((data, ch) => {
    const from = Math.max(0, start);
    const to = Math.min(data.length, start + frames);
    if (to > from) buf.getChannelData(ch).set(data.subarray(from, to), from - start);
  });
  return buf;
}

/** The takes the song plays now: these stay; others are let go once more than a few are held. */
export function keepTakes(takes: TakeRef[]): void {
  wanted = new Set(takes.map(takeKey));
  trim();
}

function trim() {
  let spare = 0;
  for (const k of [...ready.keys()].reverse()) {
    if (wanted.has(k)) continue;
    if (++spare > SPARE) ready.delete(k);
  }
}

/** How many decoded takes are held (for the tests). */
export const heldTakes = (): number => ready.size;

/**
 * Recorded takes, read from disk and decoded once, ready to play with the song.
 *
 * Only the take itself is read: its part of the recording comes over from the engine as a
 * small file of its own, so a pass from an hour-long session costs no more memory than any
 * other. Each buffer starts at the take's first frame. The takes the song plays are kept; of
 * the rest (takes heard alone), only the few heard last.
 */
import { audioContext } from "./context";
import { readTakeRange } from "../desktop";

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
    p = readTakeRange(t.wet, t.start, t.frames)
      .then((bytes) => audioContext().decodeAudioData(bytes))
      .then((buf) => {
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

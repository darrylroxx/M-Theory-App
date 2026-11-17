/**
 * Everything that sounds, as it is scheduled: each chord note, each melody note and each drum
 * hit, with the moment it will be heard. The canvas paints from these.
 *
 * Nothing is kept unless someone is listening.
 */
import type { DrumId } from "./drums";

export type Pulse =
  /** a plucked string: `length` is how long the hand stays on it, in seconds */
  | { kind: "chord"; time: number; midi: number; velocity: number; length: number }
  | { kind: "melody"; time: number; midi: number; velocity: number; length: number }
  | { kind: "drum"; time: number; drum: DrumId; velocity: number };

let listeners = 0;
let queue: Pulse[] = [];

/** Start collecting. Call what it returns to stop. */
export function listen(): () => void {
  listeners++;
  let on = true;
  return () => {
    if (!on) return;
    on = false;
    listeners = Math.max(0, listeners - 1);
    if (!listeners) queue = [];
  };
}

/** Something has been scheduled to sound. */
export function pulse(p: Pulse) {
  if (!listeners) return;
  queue.push(p);
  // nobody collected for a long while: let the oldest go
  if (queue.length > 6000) queue.splice(0, 2000);
}

/** Everything whose moment has come (audio clock, in seconds), oldest first. Each is handed out once. */
export function due(now: number): Pulse[] {
  if (!queue.length) return [];
  const out: Pulse[] = [];
  const keep: Pulse[] = [];
  for (const p of queue) (p.time <= now ? out : keep).push(p);
  queue = keep;
  return out.sort((a, b) => a.time - b.time);
}

/** Forget what has not sounded yet (playing was stopped). */
export function dropPulses() {
  queue = [];
}

/** How many are waiting (for tests). */
export const waiting = () => queue.length;

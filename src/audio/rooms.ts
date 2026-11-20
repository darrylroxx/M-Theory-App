/**
 * Reverb rooms shared by the chords and melody tracks.
 *
 * A room (a convolution with a long stereo impulse) is the costliest thing a track has, and all
 * of it is worked out on the one audio thread. Every track with the same kind of room at the same
 * size would build exactly the same impulse, and everything a track did after its room (its level,
 * the Pump dip, its fade at ■, its fader) is a plain gain. So the tracks share one room per kind
 * and size, and each sends into it through those same gains, in front of the room instead of
 * after it:
 *
 *   track ─ send (trem + echo, and the shimmer) ─ level ─ fade ─ fader ─┐
 *   track ─ …                                                           ├─ gap ─ low cut ─ room ─ Pump dip ─ fade at ■ ─ master
 *   track ─ …                                                           ┘
 *
 * A track moving to another room (the Size or kind of room turned) crosses its send over to the
 * new one at that moment; the old room rings out what it was sent, so nothing is cut short. A
 * room no track sends to any more is let go once its echo has died away (live only: a render
 * keeps everything it made until it ends).
 *
 * The drum desks keep rooms of their own: theirs run into the desk's compressor, which does not
 * act the same on a sum as on each part.
 */
import type { VerbId } from "./beats";
import { renderSpace, drumRng } from "./drums";
import { master } from "./mix";

/** The reverb's gap before it starts (seconds). */
export const VERB_PRE = 0.018;

export interface Room {
  /** its kind and size */
  readonly key: string;
  /** what the tracks send in (each through its own level, fade and fader) */
  readonly input: GainNode;
  /** dips under each kick when the drums' Pump is up, as the tracks' own sound does */
  readonly duck: GainNode;
  /** ■ fades it out with the tracks; the next note brings it back */
  readonly hush: GainNode;
  /** how long it rings (its impulse, seconds) */
  readonly seconds: number;
}

interface Hall extends Room {
  sends: number;
  drop?: ReturnType<typeof setTimeout>;
  nodes: AudioNode[];
}

const halls = new WeakMap<BaseAudioContext, Map<string, Hall>>();
const isLive = (c: BaseAudioContext) => !("startRendering" in c);
export const roomKey = (verb: VerbId, size: number) => `${verb}|${size}`;

/** The impulse of a track's room: the same for every track, every time (its randomness is seeded). */
export function roomImpulse(c: BaseAudioContext, verb: VerbId, size: number): AudioBuffer {
  const sides = renderSpace(c.sampleRate, size, drumRng(11), verb);
  const buf = c.createBuffer(2, sides[0].length, c.sampleRate);
  sides.forEach((d, ch) => buf.getChannelData(ch).set(d));
  return buf;
}

/**
 * The room of this kind and size on a context (the one already there, or a new one), counted as
 * sent to until `leaveRoom`.
 */
export function enterRoom(c: BaseAudioContext, verb: VerbId, size: number): Room {
  let set = halls.get(c);
  if (!set) halls.set(c, (set = new Map()));
  const key = roomKey(verb, size);
  let r = set.get(key);
  if (!r) {
    const input = c.createGain();
    const pre = c.createDelay(0.2);
    pre.delayTime.value = VERB_PRE;
    // its lows cut, so it never booms
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 120;
    hp.Q.value = 0.707;
    const conv = c.createConvolver();
    conv.normalize = false; // the room is already scaled to return exactly the energy it is sent
    const buf = roomImpulse(c, verb, size);
    conv.buffer = buf;
    const duck = c.createGain();
    const hush = c.createGain();
    input.connect(pre).connect(hp).connect(conv).connect(duck).connect(hush).connect(master(c));
    r = { key, input, duck, hush, seconds: buf.duration, sends: 0, nodes: [input, pre, hp, conv, duck, hush] };
    set.set(key, r);
  }
  clearTimeout(r.drop);
  r.drop = undefined;
  r.sends++;
  return r;
}

/** A track stops sending to a room: once none does, it is let go after it has rung out (live only). */
export function leaveRoom(c: BaseAudioContext, room: Room) {
  const r = room as Hall;
  r.sends = Math.max(0, r.sends - 1);
  if (r.sends > 0 || !isLive(c)) return;
  clearTimeout(r.drop);
  r.drop = setTimeout(() => {
    if (r.sends > 0) return;
    const set = halls.get(c);
    if (set?.get(r.key) === r) set.delete(r.key);
    for (const n of r.nodes) n.disconnect();
  }, (r.seconds + 1) * 1000);
}

/** Every room on a context (the Pump dips them all, ■ fades them). */
export const roomsOf = (c: BaseAudioContext): Room[] => [...(halls.get(c)?.values() ?? [])];

/**
 * The mixer: one fader per track for the whole song: the first chords, melody and drums tracks
 * (ids "chords", "melody", "drums") and every track added on the Track page (by its id).
 * Each fader sits between its instrument and the speakers, so a track's volume, mute and solo
 * apply in every section at once.
 */
import { canRunSafety, createSafety, loadSafety, safetyReady } from "./safety";

export type TrackId = string;
export const TRACK_IDS: TrackId[] = ["chords", "melody", "drums"];

export interface TrackMix {
  /** volume, in dB (0 = as the instrument is set; −60 or less = silent) */
  db?: number;
  mute?: boolean;
  /** muted because a harmony track plays instead of it: heard again when that goes (one muted by hand is not) */
  instead?: boolean;
  solo?: boolean;
}
export type Mix = Record<TrackId, TrackMix | undefined>;

export const MIN_DB = -60;
export const MAX_DB = 6;

/** Is a track heard? Muted tracks are not; when any track is soloed, only soloed tracks are. */
export function audible(mix: Mix | undefined, id: TrackId): boolean {
  const t = mix?.[id];
  if (t?.mute) return false;
  const solo = !!mix && Object.values(mix).some((x) => x?.solo);
  return !solo || !!t?.solo;
}

/** The gain a track's fader is set to (a plain multiplier). */
export function gainOf(mix: Mix | undefined, id: TrackId): number {
  if (!audible(mix, id)) return 0;
  const db = Math.max(MIN_DB, Math.min(MAX_DB, mix?.[id]?.db ?? 0));
  return db <= MIN_DB ? 0 : Math.pow(10, db / 20);
}

/** A mix loaded from storage, made safe. */
export function reviveMix(raw: unknown): Mix | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, Partial<TrackMix> | undefined>;
  const out: Mix = {};
  for (const id of Object.keys(r).slice(0, 64)) {
    const t = r[id];
    if (!t || typeof t !== "object") continue;
    const db = typeof t.db === "number" && Number.isFinite(t.db) ? Math.max(MIN_DB, Math.min(MAX_DB, Math.round(t.db * 10) / 10)) : undefined;
    // (an explicit "not muted" is kept: it marks chords unmuted by hand, which a harmony written again leaves heard)
    const mute = t.mute ? { mute: true, ...(t.instead ? { instead: true } : {}) } : t.mute === false ? { mute: false } : {};
    const m: TrackMix = { ...(db !== undefined && db !== 0 ? { db } : {}), ...mute, ...(t.solo ? { solo: true } : {}) };
    if (Object.keys(m).length) out[id] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── the faders themselves (made when the first sound needs them; one set per audio context) ──
let current: Mix | undefined;
const desks = new WeakMap<BaseAudioContext, Record<TrackId, GainNode>>();
let liveFaders: Record<TrackId, GainNode> = {};

/**
 * The point every sound of the song passes on its way to the speakers (one per audio context).
 * Anything that wants to hear the whole mix as it is (the canvas does) listens here.
 *
 * From here the sum goes through the safety limiter (safety.ts) to the speakers: on a context
 * where it is already loaded (an offline render loads it before anything is made) straight
 * away; on the live context, which loads it as it opens, the master goes straight out until it
 * is ready and then crosses over to it in 20 ms. The two ways out are the same sample for
 * sample until something goes over, and neither delays anything, so the swap is never heard.
 */
const masters = new WeakMap<BaseAudioContext, GainNode>();
export function master(c: BaseAudioContext): GainNode {
  let m = masters.get(c);
  if (!m) {
    m = c.createGain();
    masters.set(c, m);
    if (safetyReady(c)) m.connect(createSafety(c)).connect(c.destination);
    // (a context that cannot run it: straight out, as before)
    else if (!canRunSafety(c)) m.connect(c.destination);
    else {
      const direct = c.createGain();
      m.connect(direct).connect(c.destination);
      const out = m;
      void loadSafety(c).then((ok) => {
        if (ok) crossToSafety(c, out, direct);
      });
    }
  }
  return m;
}

/** The master's way out goes over from straight to the speakers to through the limiter, without a sound. */
function crossToSafety(c: BaseAudioContext, m: GainNode, direct: GainNode) {
  const safety = createSafety(c);
  const wet = c.createGain();
  wet.gain.value = 0;
  m.connect(safety).connect(wet).connect(c.destination);
  const t = c.currentTime + 0.05;
  direct.gain.setValueAtTime(1, t);
  direct.gain.linearRampToValueAtTime(0, t + 0.02);
  wet.gain.setValueAtTime(0, t);
  wet.gain.linearRampToValueAtTime(1, t + 0.02);
  // (live only: an offline render's master is made after its limiter is loaded)
  setTimeout(() => {
    m.disconnect(direct);
    direct.disconnect();
  }, 200);
}

/** The fader for a track: its instrument connects into it, and it goes on to the speakers. */
export function fader(id: TrackId, c: BaseAudioContext): GainNode {
  let set = desks.get(c);
  if (!set) {
    set = {};
    desks.set(c, set);
    if (typeof AudioContext !== "undefined" && c instanceof AudioContext) liveFaders = set;
  }
  const f = set[id];
  if (f) return f;
  const g = c.createGain();
  g.gain.value = gainOf(current, id);
  g.connect(master(c));
  set[id] = g;
  return g;
}

/**
 * A track's fader as its reverb hears it: the tracks share their rooms (rooms.ts), so what a track
 * sends to one goes through a copy of its fader on the way in (its level, mute and solo), where its
 * own sound goes through the fader itself. Not connected to anything: the track's sends are.
 */
const sendDesks = new WeakMap<BaseAudioContext, Record<TrackId, GainNode>>();
let liveSends: Record<TrackId, GainNode> = {};
export function sendFader(id: TrackId, c: BaseAudioContext): GainNode {
  let set = sendDesks.get(c);
  if (!set) {
    set = {};
    sendDesks.set(c, set);
    if (typeof AudioContext !== "undefined" && c instanceof AudioContext) liveSends = set;
  }
  const f = set[id];
  if (f) return f;
  const g = c.createGain();
  g.gain.value = gainOf(current, id);
  set[id] = g;
  return g;
}

/** Set the faders (they glide over a few milliseconds, so nothing clicks). */
export function setMix(mix: Mix | undefined) {
  current = mix;
  for (const set of [liveFaders, liveSends]) for (const [id, g] of Object.entries(set)) g.gain.setTargetAtTime(gainOf(mix, id), g.context.currentTime, 0.015);
}

/** A track's fader setting right now (for sounds that do not pass through a fader of their own). */
export const levelOf = (id: TrackId) => gainOf(current, id);

/** Is a track heard right now? (The canvas paints only what is heard.) */
export const heard = (id: TrackId) => audible(current, id);

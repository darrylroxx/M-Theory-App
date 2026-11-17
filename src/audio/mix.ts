/**
 * The mixer: one fader per track for the whole song: the first chords, melody and drums tracks
 * (ids "chords", "melody", "drums") and every track added on the Track page (by its id).
 * Each fader sits between its instrument and the speakers, so a track's volume, mute and solo
 * apply in every section at once.
 */
export type TrackId = string;
export const TRACK_IDS: TrackId[] = ["chords", "melody", "drums"];

export interface TrackMix {
  /** volume, in dB (0 = as the instrument is set; −60 or less = silent) */
  db?: number;
  mute?: boolean;
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
    const m: TrackMix = { ...(db !== undefined && db !== 0 ? { db } : {}), ...(t.mute ? { mute: true } : {}), ...(t.solo ? { solo: true } : {}) };
    if (Object.keys(m).length) out[id] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── the faders themselves (made when the first sound needs them) ──
let current: Mix | undefined;
const faders: Record<TrackId, GainNode | undefined> = {};

/** The fader for a track: its instrument connects into it, and it goes on to the speakers. */
export function fader(id: TrackId, c: BaseAudioContext): GainNode {
  const f = faders[id];
  if (f && f.context === c) return f;
  const g = c.createGain();
  g.gain.value = gainOf(current, id);
  g.connect(c.destination);
  faders[id] = g;
  return g;
}

/** Set the faders (they glide over a few milliseconds, so nothing clicks). */
export function setMix(mix: Mix | undefined) {
  current = mix;
  for (const id of Object.keys(faders)) {
    const g = faders[id];
    if (g) g.gain.setTargetAtTime(gainOf(mix, id), g.context.currentTime, 0.015);
  }
}

/** A track's fader setting right now (for sounds that do not pass through a fader of their own). */
export const levelOf = (id: TrackId) => gainOf(current, id);

/** Is a track heard right now? (The canvas paints only what is heard.) */
export const heard = (id: TrackId) => audible(current, id);

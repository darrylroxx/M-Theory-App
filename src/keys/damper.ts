/**
 * When a piano note stops: the damper, the sustain pedal and running out of voices.
 *
 * Notes are booked ahead of time (the player looks a quarter of a second ahead, an offline render
 * books the whole song at once), so none of this can wait for "now": it works on the audio clock,
 * from a list of pedal changes that can arrive in any order.
 */

/** The sustain pedal over time: a sorted list of changes. */
export class PedalLine {
  private changes: { t: number; down: boolean }[] = [];

  /** Press (`down`) or lift the pedal at `t`. A later change at the same time replaces an earlier one. */
  set(down: boolean, t: number) {
    const c = this.changes;
    let i = c.length;
    while (i > 0 && c[i - 1].t > t) i--;
    if (i > 0 && c[i - 1].t === t) c[i - 1].down = down;
    else c.splice(i, 0, { t, down });
  }

  /** Is the pedal down at `t`? */
  isDown(t: number): boolean {
    let down = false;
    for (const c of this.changes) {
      if (c.t > t) break;
      down = c.down;
    }
    return down;
  }

  /** The first time at or after `t` that the pedal is up (Infinity if it is down and no lift is booked yet). */
  upFrom(t: number): number {
    if (!this.isDown(t)) return t;
    for (const c of this.changes) if (c.t > t && !c.down) return c.t;
    return Infinity;
  }

  /** Forget every change from `t` on and lift the pedal there (stop). */
  liftFrom(t: number) {
    this.changes = this.changes.filter((c) => c.t < t);
    this.set(false, t);
  }

  /** Drop changes that no longer matter (all but the last one before `t`). */
  prune(t: number) {
    let keep = 0;
    for (let i = 0; i < this.changes.length; i++) if (this.changes[i].t <= t) keep = i;
    if (keep > 0) this.changes = this.changes.slice(keep);
  }

  get size() {
    return this.changes.length;
  }
}

/**
 * When the damper falls on a note let go at `keyUp`: then, or when the pedal next comes up if it is
 * held down at that moment. Infinity while the note is held or the lift is not booked yet.
 */
export function damperAt(keyUp: number, pedal: PedalLine): number {
  return Number.isFinite(keyUp) ? pedal.upFrom(keyUp) : Infinity;
}

/**
 * How fast a damper silences a string (time constant of the exponential fade, seconds). Felt on a
 * thick bass string takes longer to stop it than on a short treble one; these give a fall of 60 dB
 * in about 1.2 s at the bottom and 0.35 s at the top of the damped range.
 */
export function damperTau(midi: number): number {
  const t60 = midi <= 21 ? 1.2 : midi >= 88 ? 0.35 : 1.2 + ((midi - 21) / (88 - 21)) * (0.35 - 1.2);
  return t60 / 6.9;
}

/** A note as the voice allocator sees it. */
export interface VoiceTimes {
  /** When it starts. */
  start: number;
  /** When it has faded to nothing (its sample ends, or its release or choke is over). */
  end: number;
  /** When its release began (Infinity while held). */
  release: number;
}

/** Is this voice still sounding at `t`? */
export const soundingAt = (v: VoiceTimes, t: number) => v.start <= t + 1e-9 && v.end > t;

/**
 * Which voices to cut when a new note at `t` would make more than `limit` sound at once.
 *
 * Those already let go go first (oldest release first: they are the quietest), then the oldest held
 * notes. Notes booked for later than `t` are never taken. Returns the voices to cut.
 */
export function victims<V extends VoiceTimes>(voices: Iterable<V>, t: number, limit: number): V[] {
  const live = [...voices].filter((v) => soundingAt(v, t));
  const over = live.length + 1 - limit;
  if (over <= 0) return [];
  const released = live.filter((v) => v.release <= t).sort((a, b) => a.release - b.release);
  const held = live.filter((v) => !(v.release <= t)).sort((a, b) => a.start - b.start);
  return [...released, ...held].slice(0, over);
}

/** Seconds it takes an exponential fade with time constant `tau` to fall `db` decibels. */
export const fadeSeconds = (tau: number, db = 80) => tau * (db / 8.686);

/**
 * Recorded takes as they sound: with the song, and alone.
 *
 * With the song, a take is one piece of sound laid in the song where it was sung. Every stretch
 * of music the player schedules says which takes lie under it, and where it is in each: a take
 * already sounding from exactly that place carries on; any other is started there, part-way in
 * if need be, and a take sounding that the music has left (the loop came round, the music
 * jumped, another take was chosen) is stopped where the music leaves it. So one take is only
 * ever heard once, and always where it belongs, even when the music is scheduled late (the page
 * was busy): a take started late starts that much further in.
 *
 * Alone, one take at a time is heard: hearing another, playing the song, recording, or leaving
 * the page stops it, and a take still loading when that happens is never heard at all.
 */
import { audioContext } from "./context";
import { fader } from "./mix";
import { loadTake, type TakeRef } from "./takebuffers";

/** A take as the player gets it: on which track, its sound, where it starts (beats into the section listing it), and which part of the buffer plays. */
export interface PlayTake {
  track: string;
  buffer: AudioBuffer;
  at: number;
  offset: number;
  dur: number;
  /** the take (the same take listed in two sections it runs across is one take) */
  id?: string;
}

/** a little later than now, so a take started late is not cut short at its head by the time it reaches the audio thread */
const LATE = 0.02;

/** the fade at each edge of a take or clip as it plays, so a cut never clicks (seconds) */
export const EDGE_FADE = 0.005;

interface Run {
  src: AudioBufferSourceNode;
  /** its fades */
  gain: GainNode;
  buffer: AudioBuffer;
  /** which part of the buffer, as listed (a clip trimmed or split while it plays is started again) */
  offset: number;
  dur: number;
  /** where in time the take's own start lies (it may be before it was started: part-way in) */
  t0: number;
  /** when it stops, as it was started */
  until: number;
}

export class TakeRuns {
  private runs = new Map<string | AudioBuffer, Run>();
  /** every source not yet ended, so ■ can stop them all at once */
  private live = new Set<AudioBufferSourceNode>();

  /**
   * A stretch of music: it starts at `t`, is beats `s0`..`s1` of its section, at `spb` seconds a
   * beat; `takes` are the takes listed in its section. `until`: where the music runs to without
   * jumping (the end of the loop, or of a run of it), so nothing sounds past it. `now`: the
   * clock. `skip`: a track left out.
   */
  item(c: BaseAudioContext, takes: readonly PlayTake[] | undefined, o: { t: number; s0: number; s1: number; spb: number; now: number; until?: number; skip?: string }): void {
    const { t, s0, s1, spb, now } = o;
    const until = o.until ?? Infinity;
    const here = new Set<string | AudioBuffer>();
    for (const tk of takes ?? []) {
      if (tk.track === o.skip || !(tk.dur > 0)) continue;
      // does it lie under this stretch?
      if (!(tk.at < s1 - 1e-6 && tk.at + tk.dur / spb > s0 + 1e-6)) continue;
      const key = tk.id ?? tk.buffer;
      if (here.has(key)) continue;
      here.add(key);
      const t0 = t + (tk.at - s0) * spb;
      const run = this.runs.get(key);
      // already sounding from exactly here: it carries on
      if (run && run.buffer === tk.buffer && Math.abs(run.t0 - t0) < 1e-4 && run.offset === tk.offset && run.dur === tk.dur && run.until > t + 1e-4) continue;
      if (run) this.end(run, Math.max(t, now), now);
      const when = Math.max(t0, t, now > t ? now + LATE : t);
      const into = when - t0;
      const dur = Math.min(tk.dur - into, until - when);
      if (dur < 0.005) {
        this.runs.delete(key);
        continue;
      }
      const src = c.createBufferSource();
      src.buffer = tk.buffer;
      // a short fade in and out at its edges (where it was cut, where the loop cuts it, or part-way in)
      const gain = c.createGain();
      fadeEdges(gain.gain, when, dur);
      src.connect(gain);
      gain.connect(fader(tk.track, c));
      src.start(when, tk.offset + into, dur);
      this.live.add(src);
      src.onended = () => {
        this.live.delete(src);
        gain.disconnect();
      };
      this.runs.set(key, { src, gain, buffer: tk.buffer, offset: tk.offset, dur: tk.dur, t0, until: when + dur });
    }
    // a take sounding that this stretch does not have: the music has left it
    for (const [key, run] of this.runs) {
      if (here.has(key)) continue;
      if (run.until > t + 1e-4) this.end(run, Math.max(t, now), now);
      this.runs.delete(key);
    }
  }

  /** Stop a take early at `at` (the music left it), fading out just before. */
  private end(run: Run, at: number, now: number) {
    if (run.until <= at) return;
    run.until = at;
    const g = run.gain.gain;
    const from = Math.max(now, at - EDGE_FADE);
    g.cancelScheduledValues(from);
    g.setTargetAtTime(0, from, EDGE_FADE / 4);
    try {
      run.src.stop(at);
    } catch {
      /* already ended */
    }
  }

  /** Stop every take now (■, or ▶ again). */
  stopAll(): void {
    for (const src of this.live) {
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    }
    this.live.clear();
    this.runs.clear();
  }

  /** How many takes are sounding or waiting to (for the tests). */
  get sounding(): number {
    return this.live.size;
  }
}

/** A gain that fades in over the first EDGE_FADE of `dur` from `when`, and out over the last (half each at most, for a very short piece). */
export function fadeEdges(g: AudioParam, when: number, dur: number): void {
  const f = Math.min(EDGE_FADE, dur / 2);
  g.setValueAtTime(0, when);
  g.linearRampToValueAtTime(1, when + f);
  g.setValueAtTime(1, when + dur - f);
  g.linearRampToValueAtTime(0, when + dur);
}

// ── one take alone ──
let alone: AudioBufferSourceNode | null = null;
/** counts every ask: a take still loading when another is asked for (or when it is stopped) is never heard */
let asks = 0;
const listeners = new Set<(on: boolean) => void>();
const tell = (on: boolean) => listeners.forEach((f) => f(on));

/** Stop the take being heard alone (and any still loading). */
export function stopAlone(): void {
  asks++;
  const was = alone;
  alone = null;
  if (was) {
    try {
      was.stop();
    } catch {
      /* already ended */
    }
    tell(false);
  }
}

/**
 * Hear one take alone (or a clip's stretch of it, `part`, in frames of the take), through its track's fader: whatever was heard alone
 * before stops first. Resolves false if it could not be read, or if something else was asked
 * for (or it was stopped) while it was loading.
 */
export async function hearAlone(t: TakeRef & { rate: number }, track: string, part?: { from: number; to: number }): Promise<boolean | null> {
  stopAlone();
  const mine = asks;
  const buf = await loadTake(t);
  if (mine !== asks) return null;
  if (!buf) return false;
  const c = audioContext();
  const src = c.createBufferSource();
  src.buffer = buf;
  // just a clip's stretch of it (faded at its edges, as it plays in the song), or the whole take
  const from = part ? Math.max(0, part.from) / t.rate : 0;
  const dur = (part ? Math.min(t.frames, part.to) : t.frames) / t.rate - from;
  if (!(dur > 0)) return false;
  const when = c.currentTime + 0.02;
  const gain = c.createGain();
  fadeEdges(gain.gain, when, dur);
  src.connect(gain);
  gain.connect(fader(track, c));
  src.start(when, from, dur);
  src.onended = () => {
    if (alone !== src) return;
    alone = null;
    tell(false);
  };
  alone = src;
  tell(true);
  return true;
}

/** Is a take being heard alone? */
export const hearingAlone = (): boolean => alone !== null;
/** Hear when a take starts or stops being heard alone. */
export function onAlone(f: (on: boolean) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/**
 * Playing the synth by hand, from the on-screen keys (or the computer keyboard), the way its
 * settings say:
 *
 * - Hold, Strum, Glide: a note sounds while its key is down (Glide's legato voice does the sliding).
 * - Drone: a key latches. Tap it and it holds; tap it again to let it go. A beginner can lay down
 *   a drone and play over it with the other hand.
 * - Arp and Pulse: the keys held down are the chord the arpeggio walks (or the pulse repeats), in
 *   time with the song's tempo, for as long as any key is down. As on the hardware, adding or
 *   lifting a key changes the arpeggio without restarting it.
 *
 * The arpeggio is scheduled a little ahead on the audio clock by `tick()`, which the page calls
 * every few hundredths of a second while keys are down; every note it schedules has an end, so nothing is left
 * hanging if the page goes away.
 */
import { arpOrder, rateBeats } from "./play";
import type { PlaySettings } from "./params";

/** Where the live notes go: one track's synth, on the audio clock. */
export interface LiveOut {
  /** the audio clock now (seconds) */
  now(): number;
  /** the song's tempo */
  bpm(): number;
  /** start a note held until `off`; returns its id */
  on(midi: number, when: number, velocity: number): number;
  off(id: number, when: number): void;
  /** a note with an end of its own (an arpeggio's step) */
  note(midi: number, when: number, velocity: number, length: number): void;
  /** be told when every key must go up (all sound stopped, or the page left); returns how to stop being told */
  onCut?(fn: () => void): () => void;
}

/** How far ahead the arpeggio is scheduled (seconds): enough to ride over a late timer, short enough to stop promptly. */
export const AHEAD = 0.18;
/** The arpeggio's first step waits this long after the first key, so the keys of a chord pressed together all start in it. */
export const GATHER = 0.035;

export class LiveKeys {
  /** keys down (or latched), with the velocity each was played at, in the order they went down */
  private down = new Map<number, number>();
  /** the notes sounding now that wait for their key: midi → its id and when it starts */
  private held = new Map<number, { id: number; at: number }>();
  /** the arpeggio: when the first key went down, when its first step falls (-1: not yet), the next step to schedule */
  private run: { start: number; t0: number; next: number } | null = null;

  constructor(private out: LiveOut, private play: () => PlaySettings) {}

  private get rhythmic() {
    const m = this.play().mode;
    return m === "arp" || m === "pulse";
  }

  /** Is this key sounding (down, or latched by a drone)? */
  isDown(midi: number): boolean {
    return this.down.has(midi);
  }

  /** The keys sounding now, low to high. */
  get keys(): number[] {
    return [...this.down.keys()].sort((a, b) => a - b);
  }

  /** A key goes down. */
  press(midi: number, velocity = 0.8) {
    const vel = Math.max(0.05, Math.min(1, velocity));
    if (this.play().mode === "drone" && this.down.has(midi)) {
      // a latched key tapped again lets go
      this.stop(midi);
      return;
    }
    if (this.down.has(midi)) return;
    this.down.set(midi, vel);
    if (this.rhythmic) {
      if (!this.run) this.run = { start: this.out.now(), t0: -1, next: 0 };
      return;
    }
    const at = this.out.now() + 0.005;
    this.held.set(midi, { id: this.out.on(midi, at, vel), at });
  }

  /** A key comes up (a drone's key stays latched until it is tapped again). */
  release(midi: number) {
    if (this.play().mode === "drone") return;
    this.stop(midi);
  }

  private stop(midi: number) {
    this.down.delete(midi);
    const h = this.held.get(midi);
    if (h) {
      // never before the note starts: the audio clock moves in steps, so a quick tap can come up
      // before its note's start, and an off booked ahead of its on would leave the note sounding
      this.out.off(h.id, Math.max(this.out.now(), h.at));
      this.held.delete(midi);
    }
    if (this.down.size === 0) this.run = null;
  }

  /** Every key up, latched ones too (the page closes, or the way of playing changes). */
  releaseAll() {
    const now = this.out.now();
    for (const h of this.held.values()) this.out.off(h.id, Math.max(now, h.at));
    this.held.clear();
    this.down.clear();
    this.run = null;
  }

  /** Is anything waiting for `tick()`? */
  get running(): boolean {
    return this.run !== null;
  }

  /** Schedule the arpeggio's steps up to a little ahead of now. Call it a few times a second while `running`. */
  tick() {
    const run = this.run;
    if (!run || !this.rhythmic || this.down.size === 0) return;
    const now = this.out.now();
    if (run.t0 < 0) {
      // the first step goes once the chord's keys have had a moment to land (later if the timer was late)
      if (now < run.start + GATHER) return;
      run.t0 = now + 0.01;
    }
    const p = this.play();
    const step = (rateBeats(p.rate) * 60) / Math.max(20, this.out.bpm());
    const len = step * Math.max(0.05, Math.min(1, p.gate));
    const until = now + AHEAD;
    const keys = this.keys;
    const vel = Math.max(...this.down.values());
    const octaves = Math.max(1, Math.min(3, p.octaves));
    for (;;) {
      const t = run.t0 + run.next * step;
      if (t > until) break;
      // a step whose moment has already gone (the timer was late) is skipped, not played late
      if (t >= now - 0.005) {
        if (p.mode === "pulse") for (const m of keys) this.out.note(m, t, vel, len);
        else if (p.pattern === "chord") {
          const oct = 12 * (run.next % octaves);
          for (const m of keys) this.out.note(m + oct, t, vel, len);
        } else {
          const seq = arpOrder(keys, p.pattern, octaves);
          if (seq.length) this.out.note(seq[run.next % seq.length], t, vel * (run.next % 4 === 0 ? 1 : 0.85), len);
        }
      }
      run.next++;
    }
  }
}

/**
 * Playing the synth by hand, from the on-screen keys (or the computer keyboard), the way its
 * settings say:
 *
 * - Hold, Strum, Glide: a note sounds while its key is down (Glide's legato voice does the sliding).
 * - Drone: a key latches. Tap it and it holds; tap it again to let it go. A beginner can lay down
 *   a drone and play over it with the other hand.
 * - Arp and Pulse: the keys held down are the chord the arpeggio walks (or the pulse repeats), in
 *   time with the song's tempo, for as long as any key is down. As on the hardware, adding or
 *   lifting a key changes the arpeggio without restarting it. With the latch on, the arp keeps
 *   playing the keys after they are let go, until the next chord is pressed or the latch is
 *   turned off (stopping all sound, or leaving the page, turns it off). The arp's rhythm of steps
 *   and its swing count from its first step.
 *
 * The arpeggio is scheduled a little ahead on the audio clock by `tick()`, which the page calls
 * every few hundredths of a second while keys are down; every note it schedules has an end, so nothing is left
 * hanging if the page goes away.
 */
import { ACCENT, UNACCENTED, arpOrder, arpStep, octaveOrder, rateBeats } from "./play";
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
  /** keys sounding (down, latched by a drone, or held by the arp's latch), with the velocity each was played at, in the order they went down */
  private down = new Map<number, number>();
  /** the keys a finger is on right now (with the latch on, `down` also has the keys let go of) */
  private fingers = new Set<number>();
  /** the notes sounding now that wait for their key: midi → its id and when it starts */
  private held = new Map<number, { id: number; at: number }>();
  /** the arpeggio: when the first key went down, when its first step falls (-1: not yet), the next step to schedule, and how many steps have played a note */
  private run: { start: number; t0: number; next: number; played: number } | null = null;
  private latchOn = false;

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

  /** Is the arp's latch on? */
  get latched(): boolean {
    return this.latchOn;
  }

  /**
   * The latch, for the arp and the pulse: with it on, the keys let go of keep playing, and the
   * next chord pressed (once every finger is up) takes over from them. Turning it off lets go
   * of every key no finger is on.
   */
  setLatch(on: boolean) {
    this.latchOn = on;
    if (!on) for (const m of [...this.down.keys()]) if (!this.fingers.has(m) && this.play().mode !== "drone") this.stop(m);
  }

  /** A key goes down. */
  press(midi: number, velocity = 0.8) {
    const vel = Math.max(0.05, Math.min(1, velocity));
    if (this.play().mode === "drone" && this.down.has(midi)) {
      // a latched key tapped again lets go
      this.stop(midi);
      return;
    }
    if (this.latchOn && this.rhythmic && this.fingers.size === 0) {
      // a fresh chord on the latch: the one held before gives way (the arp runs on, in time)
      for (const m of [...this.down.keys()]) if (m !== midi) this.down.delete(m);
    }
    this.fingers.add(midi);
    if (this.down.has(midi)) return;
    this.down.set(midi, vel);
    if (this.rhythmic) {
      if (!this.run) this.run = { start: this.out.now(), t0: -1, next: 0, played: 0 };
      return;
    }
    const at = this.out.now() + 0.005;
    this.held.set(midi, { id: this.out.on(midi, at, vel), at });
  }

  /** A key comes up (a drone's key stays latched until it is tapped again, and so does every key while the arp's latch is on). */
  release(midi: number) {
    this.fingers.delete(midi);
    if (this.play().mode === "drone") return;
    if (this.latchOn && this.rhythmic) return;
    this.stop(midi);
  }

  private stop(midi: number) {
    this.down.delete(midi);
    this.fingers.delete(midi);
    const h = this.held.get(midi);
    if (h) {
      // never before the note starts: the audio clock moves in steps, so a quick tap can come up
      // before its note's start, and an off booked ahead of its on would leave the note sounding
      this.out.off(h.id, Math.max(this.out.now(), h.at));
      this.held.delete(midi);
    }
    if (this.down.size === 0) this.run = null;
  }

  /** Every key up, latched ones too (the page closes, or the way of playing changes). The latch stays as it was set. */
  releaseAll() {
    const now = this.out.now();
    for (const h of this.held.values()) this.out.off(h.id, Math.max(now, h.at));
    this.held.clear();
    this.down.clear();
    this.fingers.clear();
    this.run = null;
  }

  /** Every key up and the latch off (all sound stopped). */
  unlatch() {
    this.latchOn = false;
    this.releaseAll();
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
    const gate = Math.max(0.05, Math.min(1, p.gate));
    const until = now + AHEAD;
    const keys = this.keys;
    // (in the order pressed, for the "played" pattern)
    const pressed = [...this.down.keys()];
    const vel = Math.max(...this.down.values());
    const octaves = Math.max(1, Math.min(4, p.octaves));
    const arp = p.mode === "arp";
    const reps = arp ? Math.max(1, Math.min(4, p.ratchet ?? 1)) : 1;
    const accents = arp && /X/.test(p.rhythm ?? "");
    for (;;) {
      const t = run.t0 + run.next * step;
      if (t > until) break;
      // (the pulse plays every step, straight; the arp's rhythm and swing count from its first step)
      const s = arp ? arpStep(run.next, step, p) : { shift: 0, dur: step, hit: 1 as const };
      const at = t + s.shift;
      // a step whose moment has already gone (the timer was late) is skipped, not played late
      if (s.hit && at >= now - 0.005) {
        const sub = s.dur / reps;
        const len = sub * gate;
        const strike = (midi: number, v: number) => {
          for (let r = 0; r < reps; r++) this.out.note(midi, at + r * sub, r ? v * 0.9 : v, len);
        };
        if (p.mode === "pulse") for (const m of keys) this.out.note(m, at, vel, len);
        else if (p.pattern === "chord") {
          const octs = octaveOrder(p.octMove === "span" ? "up" : (p.octMove ?? "up"), octaves);
          const oct = 12 * octs[run.played % octs.length];
          const v = s.hit === 2 ? Math.min(1, vel * ACCENT) : vel * (accents ? UNACCENTED : 1);
          for (const m of keys) strike(m + oct, v);
        } else {
          const seq = arpOrder(pressed, p.pattern, octaves, Math.random, p.octMove ?? "span");
          const v = s.hit === 2 ? Math.min(1, vel * ACCENT) : vel * (run.played % 4 === 0 ? 1 : 0.85) * (accents ? UNACCENTED : 1);
          if (seq.length) strike(seq[run.played % seq.length], v);
        }
      }
      // (a rest uses up no note; a step the timer missed does, so the pattern keeps its place in time)
      if (s.hit) run.played++;
      run.next++;
    }
  }
}

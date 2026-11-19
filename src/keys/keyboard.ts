/**
 * What every keyboard instrument does with its notes, whatever makes the sound: the lanes (slots),
 * a key struck again, too many notes at once, the sustain pedal, stopping and freeing.
 *
 * A note is one voice: a source playing into its own gain. The instrument decides how a voice
 * sounds while the key is down (the piano holds its recording's level, the electric piano fades
 * like a struck tine) and what happens as the damper falls; this class decides when.
 *
 * Everything is booked on the audio clock (the player looks a quarter of a second ahead, an offline
 * render books the whole song at once), so a voice's release can be moved while it is still to come:
 * a pedal pressed after the note was booked keeps it ringing.
 */
import { PedalLine, damperAt, fadeSeconds, soundingAt, victims, type VoiceTimes } from "./damper";

export interface KeyVoice extends VoiceTimes {
  midi: number;
  key: number;
  velocity: number;
  slot?: number;
  src: AudioScheduledSourceNode;
  amp: GainNode;
  /** When the key is let go (Infinity while held). */
  keyUp: number;
  /** Time constant of its fade once the damper falls. */
  tau: number;
  /** Does a damper (and so the pedal) stop it? */
  damped: boolean;
  /** When it would be silent if the key were held for ever (its recording ends, or it has died away). */
  natural: number;
  /** Taken over (same key struck again, voice stolen, stopped): its end is final. */
  cut: boolean;
}

/**
 * Where the keyboards sit in the mix, in dB on top of their own calibration (the piano's pack puts
 * middle C, played mezzo-forte, at -20 LUFS). The guitar plays the same chords and melodies about
 * 13 dB quieter than that (rendered side by side at velocities 0.7-0.9: 12-14 dB in integrated and
 * momentary loudness), so both keyboards are brought down to it: a chords track switched between
 * guitar and piano keeps its level, and a dense pedalled run keeps its headroom (it peaked at
 * +4 dBFS before).
 */
export const KEYS_LEVEL = -13;

/** A key struck again chokes the sound before it this quickly (a hammer re-striking its string). */
export const CHOKE_TAU = 0.06;
/** A stolen voice fades this quickly: fast enough to free it, slow enough not to click. */
export const STEAL_TAU = 0.008;

/** Call stop() again safely: the spec allows it, older WebKit threw. */
export function stopAt(src: AudioScheduledSourceNode, t: number) {
  try {
    src.stop(t);
  } catch {
    /* already stopped; the gain envelope silences it */
  }
}

export abstract class Keyboard<V extends KeyVoice> {
  protected voices = new Set<V>();
  private slots = new Map<number, V>();
  private pedalLine = new PedalLine();
  protected disposed = false;

  constructor(
    readonly ctx: BaseAudioContext,
    protected polyphony: number,
  ) {}

  /** The voice's level at `t` while its key is down (before any release). */
  protected abstract levelAt(v: V, t: number): number;
  /** Book the voice's envelope while the key is down, from `from` on (after the later events were cancelled). */
  protected abstract hold(v: V, from: number): void;
  /** The damper has fallen at `at` (sounds that go with it, such as the felt's own noise). */
  protected onDamper(_v: V, _at: number): void {}
  /** A damper sound booked for a release that has moved or will not happen: it must not play. */
  protected dropDamper(_v: V): void {}

  /** A time to book at: `when`, or now if it has passed (or is not a number, so nothing bad is booked). */
  protected at(when: number): number {
    return Number.isFinite(when) ? Math.max(when, this.ctx.currentTime) : this.ctx.currentTime;
  }

  /** Notes sounding at time `t` (default now). */
  sounding(t = this.ctx.currentTime): number {
    let n = 0;
    this.voices.forEach((v) => soundingAt(v, t) && n++);
    return n;
  }

  /**
   * Make room for a new note on `key` at `t`: the lane's last note is let go, the same key's sound
   * gives way, and over the polyphony the quietest and oldest make way.
   */
  protected admit(key: number, t: number, slot?: number) {
    this.prune();
    // A lane takes over: the note before it on this slot is let go (the pedal may still hold it).
    if (slot !== undefined) {
      const prev = this.slots.get(slot);
      if (prev && !prev.cut && prev.start < t && soundingAt(prev, t)) this.letGo(prev, t);
    }
    // The same key struck again: the hammer re-strikes the string and the old sound gives way. Struck
    // twice at the same moment (a note doubled in a voicing) it is still one key: the later note
    // takes the place of the earlier, which never sounds (two would play it twice as loud).
    this.voices.forEach((v) => {
      if (v.cut || v.key !== key || !soundingAt(v, t)) return;
      if (v.start < t) this.cutVoice(v, t, CHOKE_TAU);
      else this.unbook(v);
    });
    // Too many notes: released ones first, then the oldest (voices already fading out do not count).
    const live = [...this.voices].filter((v) => !v.cut);
    for (const v of victims(live, t, this.polyphony)) this.cutVoice(v, t, STEAL_TAU);
  }

  /** Start tracking a voice whose source has been started: book when its damper falls. */
  protected add(v: V) {
    v.end = v.natural;
    // a looping source never ends by itself: it stops once it has died away (an earlier release moves this)
    stopAt(v.src, v.natural);
    v.src.onended = () => this.forget(v);
    this.voices.add(v);
    if (v.slot !== undefined) this.slots.set(v.slot, v);
    this.scheduleRelease(v, v.damped ? damperAt(v.keyUp, this.pedalLine) : v.keyUp, true);
  }

  /**
   * Press (`down`) or lift the sustain pedal at `when` (default now). Notes let go while it is down
   * ring on; lifting it drops every damper whose key is up.
   */
  pedal(down: boolean, when = this.ctx.currentTime): void {
    if (this.disposed) return;
    const t = this.at(when);
    this.pedalLine.set(down, t);
    this.voices.forEach((v) => {
      // a change at t cannot move a damper that fell before t, nor touch a note already over (an
      // offline bounce books the whole song at once: without this every change would revisit it all)
      if (!v.damped || v.cut || v.release < t || v.end <= t) return;
      const r = damperAt(v.keyUp, this.pedalLine);
      if (r !== v.release) this.scheduleRelease(v, r, true);
    });
  }

  /**
   * The key on lane `slot` comes up at `when` (default now): a key held down by hand on the screen
   * and let go. Its damper falls then, or when the pedal comes up. Nothing on the lane: nothing to do.
   */
  lift(slot: number, when = this.ctx.currentTime): void {
    if (this.disposed) return;
    const v = this.slots.get(slot);
    if (v && !v.cut) this.letGo(v, this.at(when));
  }

  /** Is the pedal down at `t`? */
  pedalDown(t = this.ctx.currentTime): boolean {
    return this.pedalLine.isDown(t);
  }

  stopAll(when = this.ctx.currentTime): void {
    const t = this.at(when);
    this.pedalLine.liftFrom(t);
    this.voices.forEach((v) => {
      if (v.start >= t) {
        this.unbook(v); // booked but not started yet: it never sounds
        return;
      }
      if (v.release <= t || v.cut) return;
      v.keyUp = Math.min(v.keyUp, t);
      this.scheduleRelease(v, t, false);
    });
    this.slots.clear();
  }

  /** A voice booked for later (or for this very moment) that is not to sound at all. */
  private unbook(v: V) {
    v.cut = true;
    v.end = v.start;
    v.release = Math.min(v.release, v.start);
    stopAt(v.src, v.start);
    this.dropDamper(v);
    if (v.slot !== undefined && this.slots.get(v.slot) === v) this.slots.delete(v.slot);
  }

  /** Stop every source now and forget them. */
  protected silence() {
    const t = this.ctx.currentTime;
    this.voices.forEach((v) => {
      stopAt(v.src, t);
      this.dropDamper(v);
    });
    this.voices.clear();
    this.slots.clear();
  }

  /** The key is let go at `t`: the damper falls then, or when the pedal comes up. */
  protected letGo(v: V, t: number) {
    if (v.keyUp <= t) return;
    v.keyUp = t;
    this.scheduleRelease(v, v.damped ? damperAt(t, this.pedalLine) : t, true);
  }

  /**
   * Book (or re-book, when the pedal changed) the moment the damper falls on a voice.
   * Once a release has begun it is left alone: a fading string cannot be un-damped.
   */
  private scheduleRelease(v: V, at: number, withSound: boolean) {
    const now = this.ctx.currentTime;
    if (v.cut || (v.release <= now && v.release !== Infinity) || at === v.release) return;
    const g = v.amp.gain;
    const from = Math.max(v.start, now);
    // Drop the release booked before (if any) and carry on as if the key were held until the new one.
    if (Number.isFinite(v.release)) {
      g.cancelScheduledValues(from);
      this.hold(v, from);
    }
    this.dropDamper(v);
    v.release = at;
    if (!Number.isFinite(at)) {
      v.end = v.natural; // held: it sounds until it ends by itself
      stopAt(v.src, v.natural);
      return;
    }
    const start = Math.max(at, from);
    g.setTargetAtTime(0, start, v.tau);
    v.end = Math.min(v.natural, start + fadeSeconds(v.tau));
    stopAt(v.src, v.end);
    if (withSound && v.damped && start < v.natural) this.onDamper(v, start);
  }

  /** Cut a voice short from `t` with a fade of time constant `tau` (re-strike, stealing). */
  protected cutVoice(v: V, t: number, tau: number) {
    if (v.cut && v.end <= t) return;
    const g = v.amp.gain;
    const from = Math.max(t, v.start);
    g.cancelScheduledValues(from);
    // Already fading from its release: just fade faster from wherever it has got to. Otherwise
    // start the fade from the level it is at (a value the automation can pick up exactly).
    if (!(v.release < from)) g.setValueAtTime(this.levelAt(v, from), from);
    g.setTargetAtTime(0, from, tau);
    if (v.release > from) this.dropDamper(v);
    v.cut = true;
    v.release = Math.min(v.release, from);
    v.end = Math.min(v.end, from + fadeSeconds(tau));
    stopAt(v.src, v.end);
    if (v.slot !== undefined && this.slots.get(v.slot) === v) this.slots.delete(v.slot);
  }

  protected forget(v: V) {
    this.voices.delete(v);
    if (v.slot !== undefined && this.slots.get(v.slot) === v) this.slots.delete(v.slot);
    v.amp.disconnect();
  }

  /** Drop voices that have finished (onended can lag, and an offline context fires it late). */
  protected prune() {
    const now = this.ctx.currentTime;
    this.voices.forEach((v) => v.end < now - 0.5 && this.forget(v));
    this.pedalLine.prune(now - 1);
  }
}

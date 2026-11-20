/**
 * A sampled keyboard instrument: plays a sample pack (the piano) as an Instrument.
 *
 *   recording ─ re-pitch (playbackRate) ─ (lowpass) ─ velocity gain ─┐
 *   damper sound (on release) ─────────────────────── its gain ──────┼─► output
 *
 * Each note picks the recording nearest its key in the velocity layer for its strength, and moves
 * it the last semitone or so with the playback rate (tuned to the piano's own stretch). Played
 * softer than its recording was made, a gentle lowpass darkens it toward the softer recording, so
 * the tone brightens smoothly with velocity rather than in steps (see shade() in pack.ts). Letting
 * a key go drops the damper: the string fades in a fraction of a second and the felt's own sound
 * is heard, unless the sustain pedal is down, in which case it rings on until the pedal comes up.
 * The rest of what happens to notes (lanes, re-struck keys, stealing, the pedal) is keyboard.ts.
 *
 * It works the same on an OfflineAudioContext, for bouncing a song to WAV: the recordings are
 * decoded for that context's sample rate (see bank.ts), and `prepare()` loads what a song needs
 * before it is rendered.
 */
import type { Instrument } from "../audio/instrument";
import { startRecorded } from "../audio/late";
import { Bank, defaultBudget, type BankOptions, type Progress } from "./bank";
import { damperTau } from "./damper";
import { KEYS_LEVEL, Keyboard, stopAt, type KeyVoice } from "./keyboard";
import { filesFor, layerOf, layerSamples, nearestIn, pick, rateFor, releaseFor, velocityDb, type PackManifest } from "./pack";

export interface SamplerOptions extends BankOptions {
  /** Most notes sounding at once; the oldest (released ones first) make way. */
  polyphony?: number;
  /** Decoded audio this pack may keep in memory, in bytes. */
  budget?: number;
  /** The velocity whose layer loads first (the one most notes will use). */
  core?: number;
  /** Play the dampers' own sound when keys are let go. */
  releases?: boolean;
  /** Output level in dB on top of the pack's calibration (default KEYS_LEVEL: the guitar's level). */
  level?: number;
}

interface Voice extends KeyVoice {
  src: AudioBufferSourceNode;
  /** Its velocity gain, held until the damper falls. */
  level: number;
  rel?: { src: AudioBufferSourceNode; amp: GainNode };
}

/** The undamped top keys still fade when let go, as their strings ring into the others. */
const UNDAMPED_TAU = 0.5;
/** Damper sounds quieter than this (dB, after the note was held long) are not worth a voice. */
const QUIETEST_RELEASE = -60;

const dbToGain = (db: number) => 10 ** (db / 20);
/** A lowpass with no bump at the cutoff (Web Audio reads a lowpass's Q in dB: -3.01 dB is Q = 1/√2). */
const BUTTERWORTH_Q = -3.0103;

export class Sampler extends Keyboard<Voice> implements Instrument {
  readonly output: GainNode;
  private bank: Bank;
  private core: number;
  private releases: boolean;
  /** dB added to every sound it makes (see SamplerOptions.level). */
  private trim: number;

  /**
   * `base` is the folder of the pack (ending in "/"), with its manifest.json. Nothing is fetched
   * until load() (or prepare()) is called.
   */
  constructor(ctx: BaseAudioContext, base: string, opts: SamplerOptions = {}) {
    super(ctx, opts.polyphony ?? 64);
    this.output = ctx.createGain();
    this.bank = Bank.for(base, ctx.sampleRate, opts);
    this.bank.attach();
    this.bank.budget = Math.min(this.bank.budget, opts.budget ?? defaultBudget());
    this.core = opts.core ?? 0.7;
    this.releases = opts.releases ?? true;
    this.trim = opts.level ?? KEYS_LEVEL;
  }

  private get m(): PackManifest | undefined {
    return this.bank.manifest;
  }

  ready(): boolean {
    return !this.disposed && this.bank.ready();
  }

  /** Resolves when every key can sound (one layer across the keyboard); the rest keeps loading behind. */
  load(): Promise<void> {
    return this.bank.start(this.core, this.releases);
  }

  /**
   * Load exactly what these notes need (for an offline render, which cannot wait for a file mid-way)
   * and keep it until the next prepare() or dispose(), whatever the memory budget. It loads the
   * first tier too (so ready() holds and any other note can sound) but starts no background
   * loading of its own: a bounce at another sample rate than the live piano decodes only that.
   */
  async prepare(notes: Iterable<{ midi: number; velocity: number }>): Promise<void> {
    await this.bank.start(this.core, this.releases, false);
    const files = filesFor(this.m!, notes, this.releases);
    this.bank.pin(this, files);
    await this.bank.want(files, 0);
  }

  /** How loading is going (bytes of the first layer, and decoded memory in use). */
  progress(): Progress {
    return this.bank.progress();
  }

  /** Call `cb` as files come in. Returns a function that stops it. */
  onProgress(cb: (p: Progress) => void): () => void {
    return this.bank.onProgress(cb);
  }

  /** Decoded audio held by this pack (bytes; shared with other instruments at this sample rate). */
  memory(): number {
    return this.bank.memory();
  }

  play(midi: number, when: number, velocity: number, length: number, slot?: number): void {
    const m = this.m;
    if (!m || this.disposed || !Number.isFinite(midi)) return;
    const t = this.at(when);
    const vel = Math.max(0, Math.min(1, Number.isFinite(velocity) ? velocity : 0.7));
    const key = Math.round(midi);

    const p = pick(m, midi, vel, (f) => this.bank.has(f));
    // The take this note should have had: if it is not here yet, fetch it for next time.
    const own = nearestIn(m, layerSamples(m, layerOf(m, vel)), midi);
    if (own && !this.bank.has(own.file)) this.bank.want([own.file], 1).catch(() => {});
    const rel = this.releases ? releaseFor(m, key, vel) : undefined;
    if (rel && !this.bank.has(rel.file)) this.bank.want([rel.file], 2).catch(() => {});
    const buffer = p && this.bank.get(p.sample.file);
    if (!p || !buffer) return;

    this.admit(key, t, slot);
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = p.rate;
    const amp = c.createGain();
    const level = dbToGain(p.db + this.trim);
    amp.gain.value = 0;
    amp.gain.setValueAtTime(level, t);
    if (p.cutoff) {
      // played softer than the take was recorded: darkened toward the softer take (see pack.ts)
      const tone = c.createBiquadFilter();
      tone.type = "lowpass";
      tone.Q.value = BUTTERWORTH_Q;
      tone.frequency.value = Math.min(p.cutoff, c.sampleRate * 0.45);
      src.connect(tone).connect(amp);
    } else src.connect(amp);
    amp.connect(this.output);
    const lead = Math.min(this.bank.lead, buffer.duration / 2);
    // (booked late, the page having been held up: it starts now, that far into the recording: see late.ts)
    startRecorded(c, src, Number.isFinite(when) ? Math.min(when, t) : t, lead);
    const damped = key <= m.dampedTop;
    this.add({
      midi,
      key,
      velocity: vel,
      slot,
      src,
      amp,
      level,
      start: t,
      keyUp: Number.isFinite(length) ? t + Math.max(0, length) : Infinity,
      release: Infinity,
      tau: damped ? damperTau(key) : UNDAMPED_TAU,
      damped,
      natural: t + (buffer.duration - lead) / p.rate,
      end: 0,
      cut: false,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.silence();
    this.output.disconnect();
    this.bank.unpin(this);
    this.bank.detach();
  }

  protected levelAt(v: Voice): number {
    return v.level;
  }

  protected hold(v: Voice, from: number) {
    v.amp.gain.setValueAtTime(v.level, from);
  }

  /** The felt landing on the string: quieter the longer the note was held (it had died away). */
  protected onDamper(v: Voice, at: number) {
    if (!this.releases) return;
    const m = this.m!;
    const r = releaseFor(m, v.key, v.velocity);
    const buffer = r && this.bank.get(r.file);
    if (!r || !buffer) return;
    const db = r.gain + velocityDb(m, v.key, v.velocity) - r.decay * Math.max(0, at - v.start);
    if (db < QUIETEST_RELEASE) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rateFor(m, r, v.midi);
    const amp = c.createGain();
    amp.gain.value = dbToGain(db + this.trim);
    src.connect(amp).connect(this.output);
    src.start(at, Math.min(this.bank.lead, buffer.duration / 2));
    src.onended = () => amp.disconnect();
    v.rel = { src, amp };
  }

  protected dropDamper(v: Voice) {
    if (!v.rel) return;
    const now = this.ctx.currentTime;
    // (gone in a few milliseconds, not at once: a sound cut at full level clicks)
    v.rel.amp.gain.cancelScheduledValues(now);
    v.rel.amp.gain.setTargetAtTime(0, now, 0.005);
    stopAt(v.rel.src, now + 0.05);
    v.rel = undefined;
  }
}

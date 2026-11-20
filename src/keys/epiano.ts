/**
 * The electric piano: mda ePiano (Paul Kellett, MIT) rebuilt from Web Audio's own nodes, so it
 * needs no worklet and plays the same on an OfflineAudioContext for a WAV bounce.
 *
 *   recording (looped) ─ rate ─ fading gain ─ pan ─┐
 *   … one per note ───────────────────────────────┴─ bus ─┬─ dry ──────────┬─ split ─ L × (1 + lfo) ─┬─► output
 *                                                         ├─ lowpass 800 ──┤        R × (1 ± lfo) ─┘
 *                                                         └─ lowpass 2.2k ─┘   (treble)        (tremolo / autopan)
 *
 * mda multiplies each note's level by a constant every sample; that is an exponential fade, which
 * setTargetAtTime draws exactly, so the decay and the release are the plug-in's own. Its sample
 * table is one 845 KB file (public/keys/epiano/), decoded by hand: no codec touches the loops.
 */
import type { Instrument } from "../audio/instrument";
import { isLate, startRecorded } from "../audio/late";
import { keepLater } from "./bank";
import { KEYS_LEVEL, Keyboard, type KeyVoice } from "./keyboard";
import {
  KEY_GROUPS,
  TINE_RATE,
  TREBLE_W,
  decayTau,
  groupOf,
  groupSlice,
  levelOf,
  lfoOf,
  onePole,
  panOf,
  prepareTable,
  rateOf,
  releaseTau,
  ringSeconds,
  tineParams,
  trebleMix,
  type TineParams,
} from "./tines";

export interface EPianoOptions {
  params?: Partial<TineParams>;
  /** Most notes sounding at once (mda's default is 16; the oldest make way). */
  polyphony?: number;
  fetch?: (url: string) => Promise<ArrayBuffer>;
}

interface Voice extends KeyVoice {
  src: AudioBufferSourceNode;
  /** Level at the start; it fades with time constant `fade` while the key is down. */
  level: number;
  fade: number;
}

/**
 * mda's output level (0.2) with a trim that puts the electric piano as loud as the grand piano at
 * the strengths chords are usually played (measured on rendered chords and single notes), so a
 * track can swap one for the other without a jump in level; both then sit at the guitar's level
 * (KEYS_LEVEL).
 */
export const EP_VOLUME = 0.2 * 0.84 * 10 ** (KEYS_LEVEL / 20);

/** How quickly a knob change glides (so the treble and the tremolo never click). */
const GLIDE = 0.03;

const defaultFetch = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
};

/** The prepared sample table of each pack, fetched once per page and shared by every instrument. */
const tables = new Map<string, Promise<Float32Array>>();

async function loadTable(base: string, fetchFile: (url: string) => Promise<ArrayBuffer>): Promise<Float32Array> {
  // fetched before a service worker looks after the page (a first visit): fetched again once it does, so it keeps them
  const fetchBytes = (url: string) => (keepLater(url, fetchFile), fetchFile(url));
  const m = JSON.parse(new TextDecoder().decode(await fetchBytes(base + "manifest.json"))) as {
    files: { file: string; sha?: string }[];
  };
  const f = m.files[0];
  const bytes = await fetchBytes(base + f.file + (f.sha ? `?v=${f.sha}` : ""));
  // little-endian 16-bit, read through a DataView so a big-endian machine reads it the same
  const view = new DataView(bytes);
  const raw = new Int16Array(bytes.byteLength >> 1);
  for (let i = 0; i < raw.length; i++) raw[i] = view.getInt16(i * 2, true);
  return prepareTable(raw);
}

export class EPiano extends Keyboard<Voice> implements Instrument {
  readonly output: GainNode;
  private p: TineParams;
  private buffers?: { buffer: AudioBuffer; loopStart: number; loopEnd: number }[];
  private loading?: Promise<void>;
  private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;
  // the shared chain after the notes
  private bus: GainNode;
  private dry: GainNode;
  private low: GainNode;
  private high: GainNode;
  private left: GainNode;
  private right: GainNode;
  private lfo: OscillatorNode;
  private depthL: GainNode;
  private depthR: GainNode;
  private nodes: AudioNode[];

  /** `base` is the folder of the pack (ending in "/"). Nothing is fetched until load(). */
  constructor(
    ctx: BaseAudioContext,
    readonly base: string,
    opts: EPianoOptions = {},
  ) {
    super(ctx, opts.polyphony ?? 32);
    this.fetchBytes = opts.fetch ?? defaultFetch;
    this.p = tineParams(opts.params);
    const c = ctx;
    this.output = c.createGain();
    this.bus = c.createGain();
    // Always stereo: with only centred notes sounding (they skip the panner) the bus would turn mono,
    // and the left/right split for the tremolo would then send nothing to the right.
    this.bus.channelCount = 2;
    this.bus.channelCountMode = "explicit";
    this.bus.channelInterpretation = "speakers";
    const mix = c.createGain();
    this.dry = c.createGain();
    this.low = c.createGain();
    this.high = c.createGain();
    const lpLow = c.createIIRFilter(onePole(TREBLE_W.low, c.sampleRate).feedforward, onePole(TREBLE_W.low, c.sampleRate).feedback);
    const lpHigh = c.createIIRFilter(onePole(TREBLE_W.high, c.sampleRate).feedforward, onePole(TREBLE_W.high, c.sampleRate).feedback);
    this.bus.connect(this.dry).connect(mix);
    this.bus.connect(lpLow).connect(this.low).connect(mix);
    this.bus.connect(lpHigh).connect(this.high).connect(mix);
    const split = c.createChannelSplitter(2);
    const merge = c.createChannelMerger(2);
    this.left = c.createGain();
    this.right = c.createGain();
    mix.connect(split);
    split.connect(this.left, 0).connect(merge, 0, 0);
    split.connect(this.right, 1).connect(merge, 0, 1);
    merge.connect(this.output);
    this.lfo = c.createOscillator();
    this.depthL = c.createGain();
    this.depthR = c.createGain();
    this.lfo.connect(this.depthL).connect(this.left.gain);
    this.lfo.connect(this.depthR).connect(this.right.gain);
    this.nodes = [this.bus, mix, this.dry, this.low, this.high, lpLow, lpHigh, split, merge, this.left, this.right, this.lfo, this.depthL, this.depthR];
    this.apply(this.p, 0);
    this.lfo.start(c.currentTime);
  }

  /** The knobs as they are now. */
  params(): TineParams {
    return { ...this.p };
  }

  /**
   * Turn knobs. Treble and modulation glide at once; the others shape the notes played after the
   * change (as on the plug-in, a note keeps the envelope it started with).
   */
  set(params: Partial<TineParams>, when = this.ctx.currentTime): void {
    this.p = tineParams({ ...this.p, ...params });
    this.apply(this.p, this.at(when), GLIDE);
  }

  private apply(p: TineParams, at: number, glide = 0) {
    const go = (param: AudioParam, v: number) => {
      if (glide > 0) param.setTargetAtTime(v, at, glide / 3);
      else param.setValueAtTime(v, at);
    };
    const t = trebleMix(p.treble);
    go(this.dry.gain, t.dry);
    go(this.low.gain, t.low);
    go(this.high.gain, t.high);
    const l = lfoOf(p);
    go(this.lfo.frequency, l.hz);
    go(this.depthL.gain, l.left);
    go(this.depthR.gain, l.right);
  }

  ready(): boolean {
    return !this.disposed && !!this.buffers;
  }

  /** Fetch the sample table (845 KB, once per page) and cut it into the 33 recordings. */
  load(): Promise<void> {
    if (!this.loading) {
      let table = tables.get(this.base);
      if (!table) {
        table = loadTable(this.base, this.fetchBytes);
        tables.set(this.base, table);
        table.catch(() => tables.delete(this.base));
      }
      this.loading = table.then((t) => {
        if (this.disposed) return;
        // AudioBuffers at the recordings' own rate: Web Audio resamples them as they play.
        this.buffers = KEY_GROUPS.map((_, k) => {
          const s = groupSlice(t, k);
          const buffer = this.ctx.createBuffer(1, s.data.length, TINE_RATE);
          buffer.getChannelData(0).set(s.data);
          return { buffer, loopStart: s.loopStart, loopEnd: s.loopEnd };
        });
      });
      this.loading.catch(() => (this.loading = undefined));
    }
    return this.loading;
  }

  play(midi: number, when: number, velocity: number, length: number, slot?: number): void {
    const b = this.buffers;
    if (!b || this.disposed || !Number.isFinite(midi)) return;
    const t = this.at(when);
    const vel = Math.max(0, Math.min(1, Number.isFinite(velocity) ? velocity : 0.7));
    const key = Math.round(midi);
    const p = this.p;
    this.admit(key, t, slot);

    const group = groupOf(key, vel, p.hardness);
    const g = b[group];
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = g.buffer;
    src.loop = true;
    src.loopStart = g.loopStart;
    src.loopEnd = g.loopEnd;
    src.playbackRate.value = rateOf(midi, group);
    const pan = panOf(key, p.width);
    const centred = Math.abs(pan.pan) < 1e-6; // a mono note reaches both sides at full level by itself
    const level = levelOf(key, vel, p.touch) * (centred ? 1 : pan.gain) * EP_VOLUME;
    const fade = decayTau(key, p.decay);
    const amp = c.createGain();
    amp.gain.value = 0;
    amp.gain.setValueAtTime(level, t);
    amp.gain.setTargetAtTime(0, t, fade);
    let out: AudioNode = amp;
    if (!centred) {
      const panner = c.createStereoPanner();
      panner.pan.value = pan.pan;
      amp.connect(panner);
      out = panner;
    }
    out.connect(this.bus);
    // (booked late, the page having been held up: it starts in a moment, that far in, faded in: see late.ts)
    startRecorded(c, src, isLate(c, when) ? when : t, amp);
    this.add({
      midi,
      key,
      velocity: vel,
      slot,
      src,
      amp,
      level,
      fade,
      start: t,
      keyUp: Number.isFinite(length) ? t + Math.max(0, length) : Infinity,
      release: Infinity,
      tau: releaseTau(key, p.release),
      damped: true,
      natural: t + ringSeconds(key, vel, p),
      end: 0,
      cut: false,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.silence();
    try {
      this.lfo.stop();
    } catch {
      /* not started */
    }
    this.nodes.forEach((n) => n.disconnect());
    this.output.disconnect();
    this.buffers = undefined;
  }

  protected levelAt(v: Voice, t: number): number {
    return v.level * Math.exp(-Math.max(0, t - v.start) / v.fade);
  }

  protected hold(v: Voice, from: number) {
    v.amp.gain.setValueAtTime(this.levelAt(v, from), from);
    v.amp.gain.setTargetAtTime(0, from, v.fade);
  }
}


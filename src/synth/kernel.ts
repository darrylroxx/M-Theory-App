/**
 * The synth's sound engine: pure arithmetic on numbers, no DOM, no Web Audio, so the same code
 * runs on the audio thread (synth.worklet.ts), in an offline render and in the tests.
 *
 * Signal path of one voice: oscillator block (one of five) → band-limited steps added → DC blocker
 * (+ noise) → up to twice the sample rate → four-pole ladder low-pass with a saturating input →
 * back down → amplifier → its place between the speakers. All voices are summed, then: the one
 * effect (distortion, chorus/flanger, phaser or delay) → a stereo widener → a light reverb →
 * volume → a soft ceiling that cannot exceed full scale.
 *
 * Rules kept everywhere: nothing is allocated while sound is being made (every buffer is made in
 * the constructor); every knob change is smoothed (no zipper noise); notes start, stop and are
 * stolen without clicks; tiny numbers are flushed to zero so the processor never slows down on
 * denormals; every random number comes from a seeded generator, so a render is a pure function of
 * the sound, the seed and the notes. When nothing has sounded for half a second the engine rests
 * (silent blocks cost nothing) until the next event.
 *
 * Where the methods come from (credited in NOTICE.md): the 4-point polynomial band-limited step
 * follows the PolyBLEP idea (Välimäki & Huovilainen; Tale's PolyBLEP) with a cubic B-spline kernel
 * instead of the usual linear one; the 7-saw stack uses Adam Szabo's measurements of the JP-8000
 * supersaw; the sine is VCV Rack's 9th-order polynomial; FM is phase modulation as in Dexed's
 * engine, its depth capped by Carson's rule; the ladder is a zero-delay-feedback
 * (topology-preserving) four-pole after Zavalishin, with the input saturation placed as in
 * Vital's ladder, run at twice the rate as Vital and OB-Xf do; the half-band filters are Laurent
 * de Soras' HIIR design; envelopes, glide and voice stealing follow OB-Xf; drift follows Surge's
 * drift LFO; the supersaw mix and the delay, chorus and phaser constants follow the research
 * notes; the distortion is first-order antiderivative anti-aliasing (Parker, Zavalishin, Le
 * Bivic; as in chowdsp); the reverb is a small feedback delay network (Jot; Stautner & Puckette).
 */
import {
  type FxType,
  type OscType,
  type SynthParams,
  DEFAULT_PARAMS,
  attackSec,
  chorusHz,
  delaySec,
  distToneHz,
  fadeSec,
  fmIndex,
  fmRatio,
  glideSec,
  lfoHz,
  phaserHz,
  pulseInterval,
  resonanceK,
  ringRatio,
  timeSec,
} from "./params";

/** Control rate: pitches, filter coefficients and smoothed knobs are worked out every 16 samples and slid between. */
export const CTRL = 16;
/** Largest block rendered at once (the Web Audio render quantum). */
const BLOCK = 128;
/** Level of one voice before the effects: eight voices at full tilt stay near full scale. */
const VOICE_GAIN = 0.25;
/** Where successive notes sit between the speakers (times the Width knob), alternating sides. */
const PANS = [-1, 1, -0.5, 0.5, -0.75, 0.25, 0.75, -0.25];
/** Voices beyond the polyphony that are kept to let stolen notes fade out. */
const SPARE = 4;

// ── Small exact helpers ──────────────────────────────────────────────────────────────────────

/** sin(2πx), 9th-order odd polynomial (max error 6.5e-6), from VCV Rack's Fundamental VCO. */
export function sin2pi(x: number): number {
  x -= Math.floor(x);
  const t = 2 * x - 1;
  const t2 = t * t;
  return t * (t2 - 1) * (3.1415211942925003 + t2 * (-2.0247734792732333 + t2 * (0.51749274223813413 + t2 * -0.063691093590695858)));
}

/** tanh, rational approximation (exact to 2% and smooth; hard ±1 beyond ±3). */
export function tanhA(z: number): number {
  if (z > 3) return 1;
  if (z < -3) return -1;
  const z2 = z * z;
  return (z * (27 + z2)) / (27 + 9 * z2);
}

/** Szabo's fit of the JP-8000 supersaw detune knob (0..1 → fraction of the full detune). */
export function detuneCurve(x: number): number {
  return (
    ((((((((((10028.7312891634 * x - 50818.8652045924) * x + 111363.4808729368) * x - 138150.6761080548) * x + 106649.6679158292) * x - 53046.9642751875) * x +
      17019.951858008) * x - 3425.0836591318) * x + 404.2703938388) * x - 24.1878824391) * x + 0.6717417634) * x + 0.0030115596
  );
}

/** Detune of the seven saws at full spread (fraction of the note's frequency), centre first, then the pairs from outside in. */
const SAW_OFFSETS = [0, -0.11002313, 0.10745242, -0.06288439, 0.06216538, -0.01952356, 0.01991221];

/**
 * The band-limited step correction (4-point, from the integral of a cubic B-spline): for a jump
 * that happened `x` samples before the current sample (0 ≤ x < 1), what to add to the samples at
 * x−2, x−1, x and x+1 so the jump is smooth instead of aliasing. Written to RB[0..3].
 */
// (kept in a typed array: a number stored in a module variable would be boxed, a small allocation every time)
const RB = new Float64Array(4);
function blep4(x: number) {
  const x2 = x * x;
  const a = 1 - x;
  const a2 = a * a;
  RB[0] = (x2 * x2) / 24;
  RB[1] = 0.5 - ((2 / 3) * a - (a2 * a) / 3 + (a2 * a2) / 8);
  RB[2] = -0.5 + (2 / 3) * x - (x2 * x) / 3 + (x2 * x2) / 8;
  RB[3] = -(a2 * a2) / 24;
}

/**
 * Half-band decimator (two samples in, one out) for the oscillator that runs at twice the rate:
 * the two-path polyphase all-pass design of Laurent de Soras' HIIR (WTFPL), five coefficients,
 * about 80 dB of rejection above 28 kHz and flat to 20 kHz (the same filter as the vocal chain's
 * os.rs). `st` holds the five all-pass states (x1, y1) of one voice.
 */
const HB = [0.061090700071086, 0.221065199762536, 0.430463831503146, 0.650964800633457, 0.876656677083713];
function halfDown(st: Float64Array, a: number, b: number): number {
  // even coefficients on the second sample, odd ones on the first
  let x = b;
  for (let i = 0; i < 5; i += 2) {
    const y = HB[i] * (x - st[2 * i + 1]) + st[2 * i];
    st[2 * i] = x;
    st[2 * i + 1] = y;
    x = y;
  }
  let z = a;
  for (let i = 1; i < 5; i += 2) {
    const y = HB[i] * (z - st[2 * i + 1]) + st[2 * i];
    st[2 * i] = z;
    st[2 * i + 1] = y;
    z = y;
  }
  return 0.5 * (x + z);
}

/**
 * The other direction (one sample in, two out) for the filter, which runs at twice the rate: the
 * same two paths, each giving one of the two new samples (written to UP).
 */
const UP = new Float64Array(2);
function halfUp(st: Float64Array, x: number) {
  let a = x;
  for (let i = 0; i < 5; i += 2) {
    const y = HB[i] * (a - st[2 * i + 1]) + st[2 * i];
    st[2 * i] = a;
    st[2 * i + 1] = y;
    a = y;
  }
  let b = x;
  for (let i = 1; i < 5; i += 2) {
    const y = HB[i] * (b - st[2 * i + 1]) + st[2 * i];
    st[2 * i] = b;
    st[2 * i + 1] = y;
    b = y;
  }
  UP[0] = a;
  UP[1] = b;
}

/** A 32-bit xorshift; returns 0..1. Seeded, so renders repeat exactly. */
function xorshift(s: number): number {
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return s | 0;
}
const toUnit = (s: number) => (s >>> 0) / 4294967296;

/** 440·2^((n−69)/12), written with exp (faster than pow on the audio thread) */
const midiHz = (n: number) => 8.175798915643707 * Math.exp(0.057762265046662105 * n);
/** 2^(semitones/12) */
const semis = (st: number) => Math.exp(0.057762265046662105 * st);
/** first-order smoothing coefficient for a time constant of `tau` seconds, stepping `n` samples at a time */
const coef = (tau: number, sr: number, n = 1) => (tau <= 0 ? 1 : 1 - Math.exp(-n / (tau * sr)));
const flush = (v: number) => (v > 1e-20 || v < -1e-20 ? v : 0);

// ── One voice ────────────────────────────────────────────────────────────────────────────────

class Voice {
  active = false;
  held = false;
  kill = false;
  killGain = 1;
  id = -1;
  midi = 60;
  slot = -1;
  vel = 0.8;
  order = 0;
  // envelope: 1 attack, 2 decay/sustain, 3 release
  stage = 0;
  env = 0;
  gate = 0;
  gateEnv = 0;
  /** samples since the last (re)trigger, for the LFO fade-in */
  tOn = 0;
  // pitch in semitones (MIDI scale), sliding toward `target` when gliding
  pitch = 60;
  target = 60;
  // what velocity does to this note
  vgT = 1;
  vg = 1;
  vgInc = 0;
  velCut = 0;
  velTex = 1;
  // analogue drift and per-note slop
  rng = 1;
  walk = 0;
  slopPitch = 0;
  slopCut = 0;
  slopTime = 1;
  // where it sits between the speakers
  gl = 1;
  gr = 1;
  // oscillators: the seven saws and the sub use ph[0..7]; the two-oscillator types use pA/pB
  ph = new Float64Array(8);
  dt = new Float64Array(8);
  dtInc = new Float64Array(8);
  nSaw = 1;
  gC = 1;
  gS = 0;
  gSub = 0;
  gSubInc = 0;
  pA = 0;
  pB = 0;
  hiA = false;
  hiB = false;
  dtA = 0;
  dtAInc = 0;
  dtB = 0;
  dtBInc = 0;
  /** pulse width, or FM index */
  w = 0.5;
  wInc = 0;
  gA = 0.5;
  gB = 0.5;
  gBInc = 0;
  /** the Pulse oscillator's current interval, and its fade while it changes step */
  iv = 0;
  ivFade = 1;
  // band-limited step corrections: the oscillator output runs two samples late so jumps can be smoothed on both sides
  nm2 = 0;
  nm1 = 0;
  cm2 = 0;
  cm1 = 0;
  c0 = 0;
  /** the decimator of the ring oscillator, which runs at twice the sample rate */
  hb = new Float64Array(10);
  /** the filter's way up to twice the sample rate and back down */
  up = new Float64Array(10);
  dn = new Float64Array(10);
  /** 2^(interval/12) of the Pulse oscillator's second square */
  ivMul = 1;
  // DC blocker
  dcx = 0;
  dcy = 0;
  // ladder
  s1 = 0;
  s2 = 0;
  s3 = 0;
  s4 = 0;
  G = 0.5;
  GInc = 0;
  /** 1/(1 + k·G⁴): the zero-delay feedback solve's divisor, slid like G */
  D = 1;
  DInc = 0;
  // amplitude modulation by the LFO
  trem = 1;
  tremInc = 0;
  // envelope coefficients for this note (they carry its slop), and which version of the sound they were worked out for
  cA = 0;
  cD = 0;
  cR = 0;
  envVer = -1;
}

// ── Effects (each owns its buffers; process in place) ────────────────────────────────────────

/** Distortion: tanh with first-order antiderivative anti-aliasing, then a two-pole tone control. */
class Dist {
  private x1 = new Float64Array(2);
  private f1 = new Float64Array(2);
  private lp = new Float64Array(4);
  reset() {
    this.x1.fill(0);
    this.f1.fill(0);
    this.lp.fill(0);
  }
  process(L: Float64Array, R: Float64Array, len: number, depth: number, rate: number, sr: number) {
    const drive = Math.pow(10, (30 * depth) / 20);
    // loudness kept roughly level: the wet signal is squashed toward ±1, so bring it back down as drive rises
    const make = 1 / (1 + 0.35 * Math.sqrt(drive - 1));
    const mix = Math.min(1, depth * 2.5);
    const g = Math.tan((Math.PI * Math.min(distToneHz(rate), 0.45 * sr)) / sr);
    const G = g / (1 + g);
    const x1 = this.x1;
    const f1 = this.f1;
    const lp = this.lp;
    for (let c = 0; c < 2; c++) {
      const buf = c === 0 ? L : R;
      let xp = x1[c];
      let fp = f1[c];
      let a = lp[2 * c];
      let b = lp[2 * c + 1];
      for (let i = 0; i < len; i++) {
        const dry = buf[i];
        const x = dry * drive * 2;
        const ax = x < 0 ? -x : x;
        // F(x) = log cosh x, computed without overflow
        const F = ax + Math.log1p(Math.exp(-2 * ax)) - Math.LN2;
        const dx = x - xp;
        const y = dx > 1e-5 || dx < -1e-5 ? (F - fp) / dx : tanhA(0.5 * (x + xp));
        xp = x;
        fp = F;
        // tone: two TPT one-poles
        let v = (y - a) * G;
        const y1 = v + a;
        a = y1 + v;
        v = (y1 - b) * G;
        const y2 = v + b;
        b = y2 + v;
        buf[i] = dry + mix * (y2 * 0.5 * make - dry);
      }
      x1[c] = xp;
      f1[c] = fp;
      lp[2 * c] = flush(a);
      lp[2 * c + 1] = flush(b);
    }
  }
}

/** Read a ring buffer `d` samples behind the write head, with 4-point Hermite interpolation. */
function hermite(buf: Float32Array, w: number, d: number): number {
  const size = buf.length;
  let pos = w - d;
  while (pos < 0) pos += size;
  const i = pos | 0;
  const f = pos - i;
  const xm1 = buf[(i - 1 + size) % size];
  const x0 = buf[i % size];
  const x1 = buf[(i + 1) % size];
  const x2 = buf[(i + 2) % size];
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/** Chorus at low depth, flanger (short delay with feedback) at high depth; the two sides swing in quadrature. */
class ChorusFlanger {
  private bl: Float32Array;
  private br: Float32Array;
  private w = 0;
  /** where its sweep is (restarted by a sync) */
  ph = 0;
  private fbl = 0;
  private fbr = 0;
  constructor(sr: number) {
    const n = Math.ceil(0.045 * sr) + 4;
    this.bl = new Float32Array(n);
    this.br = new Float32Array(n);
  }
  reset() {
    this.bl.fill(0);
    this.br.fill(0);
    this.fbl = this.fbr = 0;
  }
  process(L: Float64Array, R: Float64Array, len: number, depth: number, rate: number, sr: number) {
    const t = depth < 0.4 ? 0 : depth > 0.6 ? 1 : ((depth - 0.4) / 0.2) * ((depth - 0.4) / 0.2) * (3 - 2 * ((depth - 0.4) / 0.2));
    const base = (0.012 + (0.0025 - 0.012) * t) * sr;
    const swing = (Math.min(0.005, depth * 0.01) * (1 - t) + 0.002 * (0.5 + depth) * t) * sr;
    const fb = t * Math.max(0, (depth - 0.4) / 0.6) * 0.75;
    const mix = Math.min(1, depth * 4);
    const dph = chorusHz(rate) / sr;
    const bl = this.bl;
    const br = this.br;
    const size = bl.length;
    let w = this.w;
    let ph = this.ph;
    let fbl = this.fbl;
    let fbr = this.fbr;
    for (let i = 0; i < len; i++) {
      const dl = base + swing * (0.5 + 0.5 * sin2pi(ph));
      const dr = base + swing * (0.5 + 0.5 * sin2pi(ph + 0.25));
      const xl = L[i];
      const xr = R[i];
      bl[w] = xl + fbl * fb;
      br[w] = xr + fbr * fb;
      const yl = hermite(bl, w, dl);
      const yr = hermite(br, w, dr);
      fbl = yl;
      fbr = yr;
      L[i] = xl * (1 - 0.3 * mix) + yl * 0.7 * mix;
      R[i] = xr * (1 - 0.3 * mix) + yr * 0.7 * mix;
      w = w + 1 === size ? 0 : w + 1;
      ph += dph;
      if (ph >= 1) ph -= 1;
    }
    this.w = w;
    this.ph = ph;
    this.fbl = flush(fbl);
    this.fbr = flush(fbr);
  }
}

/** Six all-pass stages per side swept by an LFO, with feedback; the sides sweep a quarter-cycle apart. */
class Phaser {
  private s = new Float64Array(12);
  /** where its sweep is (restarted by a sync) */
  ph = 0;
  private fb = new Float64Array(2);
  private G = new Float64Array(2);
  reset() {
    this.s.fill(0);
    this.fb.fill(0);
  }
  process(L: Float64Array, R: Float64Array, len: number, depth: number, rate: number, sr: number) {
    const fmin = 180;
    const span = 0.6 + 3.8 * depth;
    const fbk = 0.65 * depth;
    const mix = Math.min(0.5, depth * 2);
    const dph = phaserHz(rate) / sr;
    const s = this.s;
    for (let c = 0; c < 2; c++) {
      const buf = c === 0 ? L : R;
      // the coefficient is worked out once per block and slid toward
      const lfo = 0.5 + 0.5 * sin2pi(this.ph + c * 0.25 + dph * len);
      const fc = Math.min(fmin * Math.pow(2, span * lfo), 0.4 * sr);
      const g = Math.tan((Math.PI * fc) / sr);
      const Gt = g / (1 + g);
      let G = this.G[c] || Gt;
      const inc = (Gt - G) / len;
      let fb = this.fb[c];
      const o = c * 6;
      for (let i = 0; i < len; i++) {
        G += inc;
        const dry = buf[i];
        let x = dry + fb * fbk;
        for (let k = 0; k < 6; k++) {
          const st = s[o + k];
          const v = (x - st) * G;
          const lp = v + st;
          s[o + k] = lp + v;
          x = 2 * lp - x;
        }
        fb = x;
        buf[i] = dry * (1 - mix) + x * mix;
      }
      this.G[c] = G;
      this.fb[c] = flush(fb);
      for (let k = 0; k < 6; k++) s[o + k] = flush(s[o + k]);
    }
    this.ph += dph * len;
    this.ph -= Math.floor(this.ph);
  }
}

/** Ping-pong echo: each repeat crosses to the other side and gets darker and thinner. */
class Delay {
  private bl: Float32Array;
  private br: Float32Array;
  private w = 0;
  private d = 0;
  private lp = new Float64Array(2);
  private hp = new Float64Array(2);
  constructor(sr: number) {
    const n = Math.ceil(1.25 * sr) + 4;
    this.bl = new Float32Array(n);
    this.br = new Float32Array(n);
  }
  reset() {
    this.bl.fill(0);
    this.br.fill(0);
    this.lp.fill(0);
    this.hp.fill(0);
    this.d = 0;
  }
  process(L: Float64Array, R: Float64Array, len: number, depth: number, rate: number, sr: number) {
    const target = Math.min(delaySec(rate) * sr, this.bl.length - 4);
    if (this.d === 0) this.d = target;
    const smooth = coef(0.08, sr);
    const fb = 0.72 * Math.pow(depth, 0.7);
    const wet = 0.55 * Math.min(1, depth * 1.6);
    const gLp = coef(1 / (2 * Math.PI * 5200), sr);
    const gHp = coef(1 / (2 * Math.PI * 140), sr);
    const bl = this.bl;
    const br = this.br;
    const size = bl.length;
    let w = this.w;
    let d = this.d;
    let lpl = this.lp[0];
    let lpr = this.lp[1];
    let hpl = this.hp[0];
    let hpr = this.hp[1];
    for (let i = 0; i < len; i++) {
      d += (target - d) * smooth;
      const yl = hermite(bl, w, d);
      const yr = hermite(br, w, d);
      // darker and thinner each time round
      lpl += (yl - lpl) * gLp;
      lpr += (yr - lpr) * gLp;
      hpl += (lpl - hpl) * gHp;
      hpr += (lpr - hpr) * gHp;
      const xl = L[i];
      const xr = R[i];
      // the input enters on the left; each side feeds the other
      bl[w] = 0.5 * (xl + xr) + (lpr - hpr) * fb;
      br[w] = (lpl - hpl) * fb;
      L[i] = xl + yl * wet;
      R[i] = xr + yr * wet;
      w = w + 1 === size ? 0 : w + 1;
    }
    this.w = w;
    this.d = d;
    this.lp[0] = flush(lpl);
    this.lp[1] = flush(lpr);
    this.hp[0] = flush(hpl);
    this.hp[1] = flush(hpr);
  }
}

/** Widens without hurting mono: a short, slowly moving delayed copy is added to one side and taken from the other. */
class Widener {
  private b: Float32Array;
  private w = 0;
  /** where its sweep is (restarted by a sync) */
  ph = 0;
  constructor(sr: number) {
    this.b = new Float32Array(Math.ceil(0.03 * sr) + 4);
  }
  process(L: Float64Array, R: Float64Array, len: number, amount: number, sr: number) {
    const b = this.b;
    const size = b.length;
    const base = 0.013 * sr;
    const swing = 0.0012 * sr;
    const dph = 0.31 / sr;
    let w = this.w;
    let ph = this.ph;
    const g = 0.4 * amount;
    for (let i = 0; i < len; i++) {
      const m = 0.5 * (L[i] + R[i]);
      b[w] = m;
      const y = hermite(b, w, base + swing * sin2pi(ph)) * g;
      L[i] += y;
      R[i] -= y;
      w = w + 1 === size ? 0 : w + 1;
      ph += dph;
      if (ph >= 1) ph -= 1;
    }
    this.w = w;
    this.ph = ph;
  }
}

/** A light reverb: pre-delay, four all-pass diffusers, then eight delay lines mixed by a Hadamard matrix. */
class Reverb {
  private pre: Float32Array;
  private pw = 0;
  private ap: Float32Array[];
  private apw: Int32Array;
  private lines: Float32Array[];
  private lw: Int32Array;
  private damp = new Float64Array(8);
  private gains = new Float64Array(8);
  private v = new Float64Array(8);
  private rt = -1;
  constructor(private sr: number) {
    this.pre = new Float32Array(Math.ceil(0.02 * sr) + 1);
    this.ap = [142, 107, 379, 277].map((n) => new Float32Array(Math.max(2, Math.round((n * sr) / 44100))));
    this.apw = new Int32Array(4);
    this.lines = [0.0297, 0.0371, 0.0411, 0.0437, 0.053, 0.0599, 0.0677, 0.0739].map((s) => new Float32Array(Math.round(s * sr)));
    this.lw = new Int32Array(8);
  }
  reset() {
    this.pre.fill(0);
    for (const a of this.ap) a.fill(0);
    for (const l of this.lines) l.fill(0);
    this.damp.fill(0);
  }
  /** wet output is added to L/R */
  process(L: Float64Array, R: Float64Array, len: number, amount: number) {
    const sr = this.sr;
    const rt60 = 1.1 + 2.2 * amount;
    if (Math.abs(rt60 - this.rt) > 1e-3) {
      this.rt = rt60;
      for (let k = 0; k < 8; k++) this.gains[k] = Math.pow(10, (-3 * this.lines[k].length) / (rt60 * sr));
    }
    const wet = 0.55 * amount;
    const dampG = coef(1 / (2 * Math.PI * 5500), sr);
    const pre = this.pre;
    const ap = this.ap;
    const apw = this.apw;
    const lines = this.lines;
    const lw = this.lw;
    const v = this.v;
    const damp = this.damp;
    const gains = this.gains;
    let pw = this.pw;
    for (let i = 0; i < len; i++) {
      // pre-delay
      const x = pre[pw];
      pre[pw] = 0.5 * (L[i] + R[i]);
      pw = pw + 1 === pre.length ? 0 : pw + 1;
      // diffusion
      let y = x;
      for (let a = 0; a < 4; a++) {
        const buf = ap[a];
        const j = apw[a];
        const d = buf[j];
        const u = y + 0.6 * d;
        buf[j] = u;
        y = d - 0.6 * u;
        apw[a] = j + 1 === buf.length ? 0 : j + 1;
      }
      // the delay network: read, damp, mix (fast Hadamard), feed back
      for (let k = 0; k < 8; k++) {
        const o = lines[k][lw[k]];
        damp[k] += (o - damp[k]) * dampG;
        v[k] = damp[k] * gains[k];
      }
      let a0 = v[0] + v[1], a1 = v[0] - v[1], a2 = v[2] + v[3], a3 = v[2] - v[3];
      let a4 = v[4] + v[5], a5 = v[4] - v[5], a6 = v[6] + v[7], a7 = v[6] - v[7];
      let b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3;
      let b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
      const h = 0.35355339059327373;
      a0 = (b0 + b4) * h; a1 = (b1 + b5) * h; a2 = (b2 + b6) * h; a3 = (b3 + b7) * h;
      a4 = (b0 - b4) * h; a5 = (b1 - b5) * h; a6 = (b2 - b6) * h; a7 = (b3 - b7) * h;
      b0 = a0 + y; b1 = a1 + y; b2 = a2; b3 = a3; b4 = a4 + y; b5 = a5; b6 = a6 + y; b7 = a7;
      lines[0][lw[0]] = b0; lines[1][lw[1]] = b1; lines[2][lw[2]] = b2; lines[3][lw[3]] = b3;
      lines[4][lw[4]] = b4; lines[5][lw[5]] = b5; lines[6][lw[6]] = b6; lines[7][lw[7]] = b7;
      for (let k = 0; k < 8; k++) lw[k] = lw[k] + 1 === lines[k].length ? 0 : lw[k] + 1;
      L[i] += (v[0] - v[2] + v[4] - v[6]) * wet;
      R[i] += (v[1] - v[3] + v[5] - v[7]) * wet;
    }
    this.pw = pw;
    for (let k = 0; k < 8; k++) damp[k] = flush(damp[k]);
  }
}

// ── The engine ───────────────────────────────────────────────────────────────────────────────

export interface KernelOptions {
  /** notes that can sound at once (default 8) */
  voices?: number;
  /** seed for drift, oscillator start phases and noise */
  seed?: number;
}

const EV_ON = 1;
const EV_OFF = 2;
const EV_ALL_OFF = 3;
const EV_PARAMS = 4;
const EV_SYNC = 5;

const FX_INDEX: Record<FxType, number> = { off: -1, dist: 0, chorus: 1, phaser: 2, delay: 3 };
/** How hard the filter's input is pushed with Drive at zero: a touch of warmth, no audible distortion. */
const DRIVE0 = 0.4;
/** Where the filter's input saturation flattens out. */
const SAT = 2;
const OSC_LEVEL: Record<OscType, number> = { saw: 0.85, pulse: 0.72, sync: 0.85, ring: 1.35, fm: 0.72 };

/** Polyphonic synth engine. Feed it notes (in frames on its own clock) and render blocks of stereo audio. */
export class SynthKernel {
  readonly sr: number;
  readonly poly: number;
  /** the frame the next render starts at */
  now = 0;

  private p: SynthParams = DEFAULT_PARAMS;
  private voices: Voice[];
  private order = 0;
  private notes = 0;
  private seed: number;
  private rng: number;
  private nr = 1;

  // event queue, kept in time order (struct of arrays so nothing is allocated per event)
  private evFrame = new Float64Array(256);
  private evType = new Int8Array(256);
  private evA = new Float64Array(256);
  private evB = new Float64Array(256);
  private evC = new Float64Array(256);
  private evD = new Float64Array(256);
  private evHead = 0;
  private evTail = 0;
  private bank: SynthParams[] = [];

  // mono / legato: the keys held, last-note priority
  private stackMidi = new Float64Array(64);
  private stackVel = new Float64Array(64);
  private stackId = new Float64Array(64);
  private stackN = 0;
  private mono: Voice | null = null;
  private lastPitch = -1;

  // smoothed knobs
  private ctlPos = 0;
  private sTex = 0;
  private sMod = 0;
  private sNoise = 0;
  private sCut = 0;
  private sRes = 0;
  private sKey = 0;
  private sDrive = 0;
  private sBal = 0;
  private sSus = 0;
  private sDrift = 0;
  private sWidth = 0;
  private lAmp = 0;
  private lFilt = 0;
  private lPitch = 0;
  private lOsc = 0;
  private fxW = new Float64Array(4);
  private sFxDepth = 0;
  private sFxRate = 0;
  private sRev = 0;
  private gain = 0;
  private gainInc = 0;
  private og = 1;
  private ogInc = 0;
  private osc: OscType = "saw";
  private pendingOsc: OscType | null = null;

  // LFO (one for the whole synth, as on the hardware)
  private lfoPh = 0;
  private lfoRaw = 0;
  private lfoVal = 0;
  private lfoHold = 0;

  private glideC = 0;
  private fadeN = 0;
  private idle = false;
  private silent = 0;
  private SM: number;

  // worked out once per control block and shared by every voice
  private envVer = 0;
  private tA = 0.001;
  private tD = 0.1;
  private tR = 0.1;
  private sawN = 1;
  private sawDet = 0;
  private sawGC = 1;
  private sawGS = 0;
  private ringA = 1;
  private ringB = 1;
  private fmR = 1;
  private kRes = 0;
  private kIn = 1;
  private outG = 1;
  private aAmt = 1;
  private oscAmt = 1;
  private noiseAmt = 0;
  // constants for this sample rate
  private readonly dcR: number;
  private readonly cGOn: number;
  private readonly cGOff: number;
  private readonly lfoC: number;
  private readonly walkA: number;
  private readonly walkS: number;

  // buffers
  private oscBuf = new Float64Array(CTRL);
  private mixL = new Float64Array(BLOCK);
  private mixR = new Float64Array(BLOCK);
  private fxL = new Float64Array(BLOCK);
  private fxR = new Float64Array(BLOCK);

  private dist = new Dist();
  private chorus: ChorusFlanger;
  private phaser = new Phaser();
  private delay: Delay;
  private widener: Widener;
  private reverb: Reverb;
  private fxLive = [false, false, false, false];
  private revLive = false;

  constructor(sampleRate: number, opts: KernelOptions = {}) {
    this.sr = sampleRate;
    this.poly = Math.max(1, Math.min(16, Math.round(opts.voices ?? 8)));
    this.seed = (opts.seed ?? 0x5eed) >>> 0 || 1;
    this.rng = this.seed;
    this.voices = Array.from({ length: this.poly + SPARE }, () => new Voice());
    this.chorus = new ChorusFlanger(sampleRate);
    this.delay = new Delay(sampleRate);
    this.widener = new Widener(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.SM = coef(0.015, sampleRate, CTRL);
    this.dcR = 1 - (2 * Math.PI * 8) / sampleRate;
    this.cGOn = coef(0.0015, sampleRate);
    this.cGOff = coef(0.003, sampleRate);
    this.lfoC = coef(1 / (2 * Math.PI * 120), sampleRate, CTRL);
    this.walkA = (2 * Math.PI * 0.08 * CTRL) / sampleRate;
    this.walkS = Math.sqrt(3 * this.walkA) * 1.2;
    this.setParams(DEFAULT_PARAMS);
    this.snapSmoothing();
  }

  // ── Control ──

  /** Change the sound now. Knobs glide to their new places; a new oscillator type fades in. */
  setParams(p: SynthParams) {
    const prev = this.p;
    this.p = p;
    this.wake();
    if (p.osc !== this.osc && p.osc !== this.pendingOsc) this.pendingOsc = p.osc;
    else if (p.osc === this.osc) this.pendingOsc = null;
    this.glideC = glideSec(p.glide) > 0 ? coef(glideSec(p.glide) / 2.3, this.sr, CTRL) : 0;
    this.fadeN = fadeSec(p.lfoFade) * this.sr;
    // envelope time constants: the attack aims at 1.3 and arrives at 1 after 1.466 τ; decay and release fall 60 dB in 6.9 τ
    const tA = attackSec(p.attack) / 1.466;
    const tD = timeSec(p.decay) / 6.9;
    const tR = timeSec(p.release) / 6.9;
    if (tA !== this.tA || tD !== this.tD || tR !== this.tR) {
      this.tA = tA;
      this.tD = tD;
      this.tR = tR;
      this.envVer++;
    }
    if (prev.voice !== p.voice) {
      // leaving or entering mono: start from a clean slate of keys
      this.stackN = 0;
      this.mono = null;
    }
  }

  /** Jump every smoothed knob to its target (used at start, so the first note is not a slide). */
  snapSmoothing() {
    const p = this.p;
    this.osc = p.osc;
    this.pendingOsc = null;
    this.og = 1;
    this.ogInc = 0;
    this.sTex = p.texture;
    this.sMod = p.mod;
    this.sNoise = p.noise;
    this.sCut = p.cutoff;
    this.sRes = p.resonance;
    this.sKey = p.keyTrack;
    this.sDrive = p.drive;
    this.sBal = p.balance;
    this.sSus = p.sustain;
    this.sDrift = p.drift;
    this.sWidth = p.width;
    const d = p.lfoDepth;
    this.lAmp = p.lfoDest === "amp" ? d : 0;
    this.lFilt = p.lfoDest === "filter" ? 48 * d * d : 0;
    this.lPitch = p.lfoDest === "pitch" ? 2 * d * d : 0;
    this.lOsc = p.lfoDest === "osc" ? d : 0;
    for (let i = 0; i < 4; i++) this.fxW[i] = FX_INDEX[p.fx] === i ? 1 : 0;
    this.sFxDepth = p.fxDepth;
    this.sFxRate = p.fxRate;
    this.sRev = p.reverb;
    this.gain = this.targetGain();
    this.gainInc = 0;
    this.shared();
  }

  private targetGain() {
    return this.p.volume * this.p.volume * Math.pow(10, this.p.trim / 20);
  }

  /** Grow the event queue (only ever called when a message arrives, never while rendering). */
  private ensure(n: number) {
    if (this.evTail + n <= this.evFrame.length) return;
    // compact first
    const live = this.evTail - this.evHead;
    const cap = Math.max(256, 1 << Math.ceil(Math.log2(live + n + 1)));
    const grow = <T extends Float64Array | Int8Array>(a: T, make: (n: number) => T) => {
      const b = make(cap);
      b.set(a.subarray(this.evHead, this.evTail));
      return b;
    };
    this.evFrame = grow(this.evFrame, (k) => new Float64Array(k));
    this.evType = grow(this.evType, (k) => new Int8Array(k));
    this.evA = grow(this.evA, (k) => new Float64Array(k));
    this.evB = grow(this.evB, (k) => new Float64Array(k));
    this.evC = grow(this.evC, (k) => new Float64Array(k));
    this.evD = grow(this.evD, (k) => new Float64Array(k));
    this.evTail = live;
    this.evHead = 0;
  }

  private push(frame: number, type: number, a = 0, b = 0, c = 0, d = 0) {
    this.ensure(1);
    // insert in time order; equal times keep the order they were given in
    let i = this.evTail;
    while (i > this.evHead && this.evFrame[i - 1] > frame) i--;
    for (let j = this.evTail; j > i; j--) {
      this.evFrame[j] = this.evFrame[j - 1];
      this.evType[j] = this.evType[j - 1];
      this.evA[j] = this.evA[j - 1];
      this.evB[j] = this.evB[j - 1];
      this.evC[j] = this.evC[j - 1];
      this.evD[j] = this.evD[j - 1];
    }
    this.evFrame[i] = frame;
    this.evType[i] = type;
    this.evA[i] = a;
    this.evB[i] = b;
    this.evC[i] = c;
    this.evD[i] = d;
    this.evTail++;
  }

  /** A note starts at `frame` (on this kernel's clock). `id` names it for its note-off; `slot` ≥ 0 takes over from the last note on that slot. */
  noteOn(frame: number, midi: number, velocity: number, id: number, slot = -1) {
    this.push(Math.round(frame), EV_ON, midi, velocity, id, slot);
  }
  noteOff(frame: number, id: number) {
    this.push(Math.round(frame), EV_OFF, 0, 0, id);
  }
  /**
   * Let every note go at `frame`. With `cancel` (the default), notes already queued to start at or
   * after that frame are dropped too (a stop button); notes queued after this call are not touched.
   */
  allOff(frame: number, cancel = true) {
    const f = Math.round(frame);
    if (cancel) {
      let w = this.evHead;
      for (let r = this.evHead; r < this.evTail; r++) {
        if (this.evType[r] === EV_ON && this.evFrame[r] >= f) continue;
        if (w !== r) {
          this.evFrame[w] = this.evFrame[r];
          this.evType[w] = this.evType[r];
          this.evA[w] = this.evA[r];
          this.evB[w] = this.evB[r];
          this.evC[w] = this.evC[r];
          this.evD[w] = this.evD[r];
        }
        w++;
      }
      this.evTail = w;
    }
    this.push(f, EV_ALL_OFF);
  }
  /**
   * The song starts (again) at `frame`: everything that moves on its own (the LFO, the drift, the
   * per-note differences) starts over from the seed, so a song played live from here sounds
   * exactly like an offline render that starts here.
   */
  syncAt(frame: number) {
    this.push(Math.round(frame), EV_SYNC);
  }
  /** Change the sound at `frame` (for renders where the sound changes partway, e.g. per section). */
  paramsAt(frame: number, p: SynthParams) {
    this.bank.push(p);
    this.push(Math.round(frame), EV_PARAMS, this.bank.length - 1);
  }
  /** Forget every note still to come. */
  clearEvents() {
    this.evHead = this.evTail = 0;
  }
  /** Silence at once (fast fade) and forget every note still to come. */
  panic() {
    this.wake();
    this.clearEvents();
    for (const v of this.voices) if (v.active) v.kill = true;
    this.stackN = 0;
    this.mono = null;
  }
  /** How many voices are sounding. */
  activeVoices() {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  private apply(i: number) {
    const t = this.evType[i];
    if (t === EV_ON) this.on(this.evA[i], this.evB[i], this.evC[i], this.evD[i]);
    else if (t === EV_OFF) this.off(this.evC[i]);
    else if (t === EV_ALL_OFF) this.releaseAll();
    else if (t === EV_PARAMS) {
      const p = this.bank[this.evA[i]];
      if (p) this.setParams(p);
    } else if (t === EV_SYNC) this.restart();
  }

  /** Free-running movement back to where it starts (see syncAt). */
  private restart() {
    this.rng = this.seed;
    this.notes = 0;
    this.lfoPh = 0;
    this.lfoHold = 0;
    this.lfoRaw = 0;
    this.lfoVal = 0;
    this.ctlPos = 0;
    // the effects' own sweeps too
    this.chorus.ph = 0;
    this.phaser.ph = 0;
    this.widener.ph = 0;
  }

  private random() {
    this.rng = xorshift(this.rng);
    return toUnit(this.rng);
  }

  /** the next of the current note's own random numbers (seeded from the note's place in the song) */
  private rnd() {
    this.nr = xorshift(this.nr);
    return toUnit(this.nr);
  }

  // ── Notes ──

  private on(midi: number, vel: number, id: number, slot: number) {
    vel = vel < 0 ? 0 : vel > 1 ? 1 : vel;
    if (this.p.voice !== "poly") return this.monoOn(midi, vel, id);
    if (slot >= 0) for (const v of this.voices) if (v.active && v.held && !v.kill && v.slot === slot) this.release(v);
    // the same key struck again while it rings: strike that voice again, as a piano would
    for (const v of this.voices) {
      if (v.active && !v.held && !v.kill && v.midi === midi) {
        this.retrigger(v, midi, vel, id, slot);
        return;
      }
    }
    this.start(this.allocate(), midi, vel, id, slot);
  }

  private off(id: number) {
    if (this.p.voice !== "poly") return this.monoOff(id);
    for (const v of this.voices) if (v.active && v.held && v.id === id) this.release(v);
  }

  private releaseAll() {
    for (const v of this.voices) if (v.active && v.held) this.release(v);
    this.stackN = 0;
  }

  /** A free voice; when all are busy the oldest released (else the oldest held) note fades out quickly to make room. */
  private allocate(): Voice {
    let busy = 0;
    for (const v of this.voices) if (v.active && !v.kill) busy++;
    if (busy >= this.poly) {
      let victim: Voice | null = null;
      for (const v of this.voices) if (v.active && !v.kill && !v.held && (!victim || v.order < victim.order)) victim = v;
      if (!victim) for (const v of this.voices) if (v.active && !v.kill && (!victim || v.order < victim.order)) victim = v;
      if (victim) victim.kill = true;
    }
    for (const v of this.voices) if (!v.active) return v;
    // every spare is still fading: take the quietest
    let q = this.voices[0];
    for (const v of this.voices) if (v.kill && v.killGain < q.killGain) q = v;
    q.active = false;
    return q;
  }

  private velocityResponse(v: Voice, vel: number) {
    const s = this.p.velocity;
    const d = vel - 0.8;
    v.vgT = Math.pow(10, (24 * s * d) / 20);
    v.velCut = 30 * s * d;
    v.velTex = Math.max(0, 1 + 1.5 * s * d);
  }

  private start(v: Voice, midi: number, vel: number, id: number, slot: number, from = midi) {
    v.active = true;
    v.held = true;
    v.kill = false;
    v.killGain = 1;
    v.id = id;
    v.midi = midi;
    v.slot = slot;
    v.vel = vel;
    v.order = ++this.order;
    v.stage = 1;
    v.env = 0;
    v.gate = 1;
    v.gateEnv = 0;
    v.tOn = 0;
    v.pitch = from;
    v.target = midi;
    this.velocityResponse(v, vel);
    v.vg = v.vgT;
    v.vgInc = 0;
    // every note gets its own little differences, from the seed and how many notes came before
    this.nr = (this.seed ^ Math.imul(++this.notes, 0x9e3779b9)) | 0 || 1;
    for (let j = 0; j < 8; j++) v.ph[j] = this.rnd();
    v.ph[7] = v.ph[0] * 0.5;
    // free-running phases sound analogue; the pulse pair starts together so a unison square never cancels itself
    v.pA = this.p.osc === "fm" ? 0 : this.rnd();
    v.pB = this.p.osc === "fm" ? 0 : this.p.osc === "pulse" ? v.pA : this.rnd();
    v.hiA = v.pA < 0.5;
    v.hiB = v.pB < 0.5;
    v.walk = this.rnd() * 2 - 1;
    v.slopPitch = this.rnd() * 2 - 1;
    v.slopCut = this.rnd() * 2 - 1;
    v.slopTime = 1 + 0.08 * (this.rnd() * 2 - 1) * this.p.drift;
    v.rng = this.nr;
    v.iv = pulseInterval(this.sTex);
    v.ivMul = semis(v.iv);
    v.ivFade = 1;
    v.nm2 = v.nm1 = v.cm2 = v.cm1 = v.c0 = 0;
    v.hb.fill(0);
    v.up.fill(0);
    v.dn.fill(0);
    v.envVer = -1;
    v.dcx = v.dcy = 0;
    v.s1 = v.s2 = v.s3 = v.s4 = 0;
    v.trem = 1;
    v.tremInc = 0;
    // spread across the speakers, alternating sides
    const pan = this.p.voice === "poly" ? PANS[this.notes % 8] * 0.8 : 0;
    this.pan(v, pan * this.sWidth);
    this.voiceControl(v, true);
  }

  private pan(v: Voice, p: number) {
    const a = ((p + 1) * Math.PI) / 4;
    v.gl = Math.cos(a) * Math.SQRT2;
    v.gr = Math.sin(a) * Math.SQRT2;
  }

  private retrigger(v: Voice, midi: number, vel: number, id: number, slot: number) {
    v.held = true;
    v.stage = 1;
    v.gate = 1;
    v.id = id;
    v.slot = slot;
    v.vel = vel;
    v.order = ++this.order;
    v.tOn = 0;
    v.target = midi;
    v.midi = midi;
    this.velocityResponse(v, vel);
  }

  private release(v: Voice) {
    v.held = false;
    v.stage = 3;
    v.gate = 0;
  }

  private monoOn(midi: number, vel: number, id: number) {
    // remember the key (last-note priority)
    if (this.stackN >= this.stackMidi.length) this.stackN = this.stackMidi.length - 1;
    this.stackMidi[this.stackN] = midi;
    this.stackVel[this.stackN] = vel;
    this.stackId[this.stackN] = id;
    this.stackN++;
    const legato = this.p.voice === "legato";
    let v = this.mono;
    if (!v || !v.active || v.kill) {
      v = this.allocate();
      const from = !legato && this.glideC > 0 && this.lastPitch >= 0 ? this.lastPitch : midi;
      this.start(v, midi, vel, id, -1, from);
      this.mono = v;
    } else if (v.held) {
      // a new key while another is held: slide there; mono strikes the envelope again, legato does not
      v.target = midi;
      if (this.glideC === 0) v.pitch = midi;
      v.midi = midi;
      v.id = id;
      if (!legato) this.retrigger(v, midi, vel, id, -1);
    } else {
      // the last note is still ringing out
      this.retrigger(v, midi, vel, id, -1);
      if (legato || this.glideC === 0) v.pitch = midi;
    }
    this.lastPitch = midi;
  }

  private monoOff(id: number) {
    let at = -1;
    for (let i = 0; i < this.stackN; i++) if (this.stackId[i] === id) at = i;
    if (at < 0) return;
    for (let i = at; i < this.stackN - 1; i++) {
      this.stackMidi[i] = this.stackMidi[i + 1];
      this.stackVel[i] = this.stackVel[i + 1];
      this.stackId[i] = this.stackId[i + 1];
    }
    this.stackN--;
    const v = this.mono;
    if (!v || !v.active || v.id !== id) return;
    if (this.stackN > 0) {
      // back to the key still held
      const top = this.stackN - 1;
      const midi = this.stackMidi[top];
      v.target = midi;
      v.midi = midi;
      v.id = this.stackId[top];
      if (this.glideC === 0) v.pitch = midi;
      if (this.p.voice === "mono") this.retrigger(v, midi, this.stackVel[top], v.id, -1);
      this.lastPitch = midi;
    } else this.release(v);
  }

  // ── Rendering ──

  /**
   * Render `n` frames (from `this.now`) into L and R starting at `offset`. Notes due inside the
   * block start on their exact frame.
   */
  render(L: Float32Array, R: Float32Array, n: number, offset = 0) {
    let i = 0;
    while (i < n) {
      // notes due now (or late)
      if (this.evHead < this.evTail && this.evFrame[this.evHead] <= this.now) {
        this.wake();
        while (this.evHead < this.evTail && this.evFrame[this.evHead] <= this.now) this.apply(this.evHead++);
      }
      if (this.evHead === this.evTail) {
        this.evHead = this.evTail = 0;
        // nothing left refers to a stored sound
        if (this.bank.length) this.bank.length = 0;
      }
      let len = Math.min(CTRL - this.ctlPos, n - i);
      if (this.evHead < this.evTail) len = Math.min(len, Math.max(1, this.evFrame[this.evHead] - this.now));
      if (this.idle) {
        // nothing sounds and every echo has died away: nothing to work out until something happens
        L.fill(0, offset + i, offset + i + len);
        R.fill(0, offset + i, offset + i + len);
      } else {
        if (this.ctlPos === 0) this.controlTick();
        const peak = this.renderSpan(L, R, offset + i, len);
        // silent for half a second with no note sounding: rest
        if (peak < 1e-7 && this.activeVoices() === 0) {
          this.silent += len;
          if (this.silent >= this.sr / 2) this.idle = true;
        } else this.silent = 0;
      }
      i += len;
      this.now += len;
      this.ctlPos = (this.ctlPos + len) % CTRL;
    }
  }

  private wake() {
    this.idle = false;
    this.silent = 0;
  }

  /** Resting: nothing has sounded for a while, so blocks are silence without any work. */
  isIdle() {
    return this.idle;
  }

  /** Move this kernel's clock (the worklet keeps it equal to the audio clock). */
  seek(frame: number) {
    this.now = frame;
  }

  private controlTick() {
    const p = this.p;
    const SM = this.SM;
    const sr = this.sr;
    // oscillator type change: dip, switch, come back
    let ogT = 1;
    if (this.pendingOsc) {
      ogT = 0;
      if (this.og < 0.002) {
        this.osc = this.pendingOsc;
        this.pendingOsc = null;
        for (const v of this.voices) {
          v.nm2 = v.nm1 = v.cm2 = v.cm1 = v.c0 = 0;
          v.hb.fill(0);
          v.iv = pulseInterval(this.sTex);
          v.ivMul = semis(v.iv);
        }
        ogT = 1;
      }
    }
    const ogStep = CTRL / (0.004 * sr);
    const ogNext = ogT > this.og ? Math.min(ogT, this.og + ogStep) : Math.max(ogT, this.og - ogStep);
    this.ogInc = (ogNext - this.og) / CTRL;

    this.sTex += (p.texture - this.sTex) * SM;
    this.sMod += (p.mod - this.sMod) * SM;
    this.sNoise += (p.noise - this.sNoise) * SM;
    this.sCut += (p.cutoff - this.sCut) * SM;
    this.sRes += (p.resonance - this.sRes) * SM;
    this.sKey += (p.keyTrack - this.sKey) * SM;
    this.sDrive += (p.drive - this.sDrive) * SM;
    this.sBal += (p.balance - this.sBal) * SM;
    this.sSus += (p.sustain - this.sSus) * SM;
    this.sDrift += (p.drift - this.sDrift) * SM;
    this.sWidth += (p.width - this.sWidth) * SM;
    const d = p.lfoDepth;
    this.lAmp += ((p.lfoDest === "amp" ? d : 0) - this.lAmp) * SM;
    this.lFilt += ((p.lfoDest === "filter" ? 48 * d * d : 0) - this.lFilt) * SM;
    this.lPitch += ((p.lfoDest === "pitch" ? 2 * d * d : 0) - this.lPitch) * SM;
    this.lOsc += ((p.lfoDest === "osc" ? d : 0) - this.lOsc) * SM;
    const fxi = FX_INDEX[p.fx];
    for (let i = 0; i < 4; i++) {
      const w = this.fxW[i] + ((fxi === i ? 1 : 0) - this.fxW[i]) * SM;
      this.fxW[i] = w < 1e-4 && fxi !== i ? 0 : w > 0.9999 && fxi === i ? 1 : w;
    }
    this.sFxDepth += (p.fxDepth - this.sFxDepth) * SM;
    this.sFxRate += (p.fxRate - this.sFxRate) * SM;
    this.sRev += (p.reverb - this.sRev) * SM;
    const gT = this.gain + (this.targetGain() - this.gain) * SM;
    this.gainInc = (gT - this.gain) / CTRL;

    // the LFO
    this.lfoPh += (lfoHz(p.lfoSpeed) * CTRL) / sr;
    let wrapped = false;
    if (this.lfoPh >= 1) {
      this.lfoPh -= Math.floor(this.lfoPh);
      wrapped = true;
    }
    const ph = this.lfoPh;
    switch (p.lfoShape) {
      case "sine":
        this.lfoRaw = sin2pi(ph);
        break;
      case "triangle":
        this.lfoRaw = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        break;
      case "square":
        this.lfoRaw = ph < 0.5 ? 1 : -1;
        break;
      case "saw":
        this.lfoRaw = 1 - 2 * ph;
        break;
      case "random":
        if (wrapped) this.lfoHold = this.random() * 2 - 1;
        this.lfoRaw = this.lfoHold;
        break;
    }
    // a short glide takes the corners off square and random steps (no clicks)
    this.lfoVal += (this.lfoRaw - this.lfoVal) * this.lfoC;

    this.shared();
    for (const v of this.voices) if (v.active) this.voiceControl(v, false);
  }

  /** What every voice uses this control block (worked out once, not once per voice). */
  private shared() {
    const m = this.sMod;
    const osc = this.osc;
    if (osc === "saw") {
      // Szabo's supersaw: the detune knob's curve, and the centre and side levels kept at one loudness
      this.sawN = m < 0.001 ? 1 : 7;
      this.sawDet = m < 0.001 ? 0 : detuneCurve(0.9 * Math.pow(m, 0.8));
      const x = 0.3 + 0.6 * m;
      const c = 0.99785 - 0.55366 * x;
      const sd = (-0.73764 * x * x + 1.2841 * x + 0.044372) * Math.min(1, 25 * m);
      const norm = 1 / Math.sqrt(c * c + (this.sawN - 1) * sd * sd);
      this.sawGC = c * norm;
      this.sawGS = sd * norm;
    } else if (osc === "ring") {
      this.ringA = semis(24 * this.sTex);
      this.ringB = ringRatio(m);
    } else if (osc === "fm") this.fmR = fmRatio(m);
    // the filter: resonance, and drive into the saturating input (gentle at zero, a growl at the top)
    const k = resonanceK(this.sRes);
    const kc = 0.5 * k;
    const d = this.sDrive;
    const drive = DRIVE0 + (8 - DRIVE0) * d * d;
    this.kRes = k;
    this.kIn = drive * (1 + kc);
    // the passband held level as resonance thins it, and loudness kept steady as drive pushes into the saturation
    this.outG = Math.sqrt((1 + k) / (1 + kc)) / (Math.pow(drive, 0.55) * Math.pow(DRIVE0, 0.45));
    this.aAmt = Math.min(1, 2 * (1 - this.sBal));
    // Noise: up to half it is mixed in; past half the oscillator fades out, until only noise is left
    const nz = this.sNoise;
    this.noiseAmt = Math.min(1, 2 * nz) * 0.7;
    this.oscAmt = nz > 0.5 ? 2 * (1 - nz) : 1;
  }

  /** Work out where one voice's pitches, filter and gains should be by the end of this control block. */
  private voiceControl(v: Voice, snap: boolean) {
    const p = this.p;
    const sr = this.sr;
    const osc = this.osc;
    if (!snap) v.tOn += CTRL;
    const fade = this.fadeN > 0 ? Math.min(1, v.tOn / this.fadeN) : 1;
    const lfo = this.lfoVal * fade;

    // glide
    if (this.glideC > 0 && p.voice !== "poly") v.pitch += (v.target - v.pitch) * this.glideC;
    else v.pitch = v.target;
    // drift: a slow random walk (corner ≈ 0.08 Hz) plus a fixed offset per note
    v.rng = xorshift(v.rng);
    v.walk += (toUnit(v.rng) * 2 - 1) * this.walkS - v.walk * this.walkA;
    const dr = this.sDrift;
    const cents = dr * (7 * v.walk + 3 * v.slopPitch);
    const pitch = v.pitch + cents / 100 + this.lPitch * lfo;
    const f = midiHz(pitch);
    const inv = 1 / sr;
    const tex = this.sTex;
    const mod = this.sMod;
    const lo = this.lOsc;
    const k = snap ? 0 : 1 / CTRL;

    if (osc === "saw") {
      const det = this.sawDet;
      // the LFO on the oscillator bends the saws, not the sub (as the manual of the original has it)
      const fs = lo > 0 ? f * semis(7 * lo * lo * lfo) : f;
      v.nSaw = this.sawN;
      for (let j = 0; j < v.nSaw; j++) {
        const t = Math.min(0.45, fs * (1 + SAW_OFFSETS[j] * det) * inv);
        if (snap) v.dt[j] = t;
        v.dtInc[j] = (t - v.dt[j]) * k;
      }
      v.gC = this.sawGC;
      v.gS = this.sawGS;
      const sub = 0.6 * tex;
      if (snap) v.gSub = sub;
      v.gSubInc = (sub - v.gSub) * k;
      const ts = Math.min(0.45, 0.5 * f * inv);
      if (snap) v.dt[7] = ts;
      v.dtInc[7] = (ts - v.dt[7]) * k;
    } else if (osc === "pulse") {
      // the second square: detuned below 0.4, stepped intervals above (faded across each step)
      const ivT = pulseInterval(tex);
      if (Math.abs(ivT - v.iv) < 0.5) {
        if (ivT !== v.iv) {
          v.iv = ivT;
          v.ivMul = semis(ivT);
        }
        v.ivFade = Math.min(1, v.ivFade + CTRL / (0.004 * sr));
      } else {
        v.ivFade -= CTRL / (0.004 * sr);
        if (v.ivFade <= 0) {
          v.ivFade = 0;
          v.iv = ivT;
          v.ivMul = semis(ivT);
        }
      }
      const ta = Math.min(0.45, f * inv);
      const tb = Math.min(0.45, f * v.ivMul * inv);
      let w = 0.5 + 0.45 * mod + 0.45 * lo * lfo;
      // never so narrow that an edge pair falls inside one sample
      const lim = 2 * Math.max(ta, tb);
      w = Math.max(Math.max(0.03, lim), Math.min(Math.min(0.97, 1 - lim), w));
      // a narrow pulse is quieter: bring it back up
      const comp = 1 / Math.sqrt(2 * Math.sqrt(w * (1 - w)));
      v.gA = 0.5 * comp;
      const gb = 0.5 * comp * v.ivFade;
      if (snap) {
        v.dtA = ta;
        v.dtB = tb;
        v.w = w;
        v.gB = gb;
      }
      v.dtAInc = (ta - v.dtA) * k;
      v.dtBInc = (tb - v.dtB) * k;
      v.wInc = (w - v.w) * k;
      v.gBInc = (gb - v.gB) * k;
    } else if (osc === "sync") {
      // the second oscillator's pitch: Texture sets it, Mod sweeps it with the envelope
      const st = 36 * tex * Math.min(1.5, v.velTex) + 36 * mod * v.env + 24 * lo * lo * lfo;
      const ta = Math.min(0.45, f * inv);
      const tb = Math.min(0.45, f * semis(st) * inv);
      if (snap) {
        v.dtA = ta;
        v.dtB = tb;
      }
      v.dtAInc = (ta - v.dtA) * k;
      v.dtBInc = (tb - v.dtB) * k;
    } else if (osc === "ring") {
      const ta = Math.min(0.45, f * this.ringA * inv);
      const tb = Math.min(0.45, f * this.ringB * (lo > 0 ? semis(24 * lo * lo * lfo) : 1) * inv);
      if (snap) {
        v.dtA = ta;
        v.dtB = tb;
      }
      v.dtAInc = (ta - v.dtA) * k;
      v.dtBInc = (tb - v.dtB) * k;
    } else {
      // FM: depth from Texture (and velocity, and the LFO), capped so the sidebands stay below half the sample rate (Carson's rule)
      const fm = f * this.fmR;
      let idx = fmIndex(tex) * v.velTex + 5 * lo * lfo;
      if (idx < 0) idx = 0;
      const cap = Math.max(0, (0.42 * sr - f) / fm - 1);
      if (idx > cap) idx = cap;
      const ta = Math.min(0.45, f * inv);
      const tb = Math.min(0.45, fm * inv);
      if (snap) {
        v.dtA = ta;
        v.dtB = tb;
        v.w = idx;
      }
      v.dtAInc = (ta - v.dtA) * k;
      v.dtBInc = (tb - v.dtB) * k;
      v.wInc = (idx - v.w) * k;
    }

    // filter: cutoff in semitones (MIDI scale) from the knob, the keyboard, the envelope, the LFO and velocity
    const fAmt = Math.min(1, 2 * this.sBal);
    const n = 15.486 + 120 * this.sCut + this.sKey * (v.pitch - 60) + fAmt * 48 * v.env + this.lFilt * lfo + v.velCut + dr * 1.2 * v.slopCut;
    const fc = Math.min(Math.max(midiHz(n), 16), 0.45 * sr);
    // the filter runs at twice the sample rate
    const g = Math.tan((Math.PI * fc) / (2 * sr));
    const G = g / (1 + g);
    const G2 = G * G;
    const D = 1 / (1 + this.kRes * G2 * G2);
    if (snap) {
      v.G = G;
      v.D = D;
    }
    v.GInc = (G - v.G) * k;
    v.DInc = (D - v.D) * k;

    // tremolo
    const trem = 1 - this.lAmp * (0.5 + 0.5 * lfo);
    if (snap) {
      v.trem = trem;
      v.vg = v.vgT;
    }
    v.tremInc = (trem - v.trem) * k;
    v.vgInc = (v.vgT - v.vg) * k;

    // envelope speeds for this note, worked out again only when the sound's times change
    if (v.envVer !== this.envVer) {
      const st = v.slopTime;
      v.cA = coef(this.tA * st, sr);
      v.cD = coef(this.tD * st, sr);
      v.cR = coef(this.tR * st, sr);
      v.envVer = this.envVer;
    }

    v.s1 = flush(v.s1);
    v.s2 = flush(v.s2);
    v.s3 = flush(v.s3);
    v.s4 = flush(v.s4);
  }

  /** Render one span (at most one control block) and return its peak. */
  private renderSpan(L: Float32Array, R: Float32Array, at: number, len: number): number {
    const mixL = this.mixL;
    const mixR = this.mixR;
    for (let i = 0; i < len; i++) mixL[i] = mixR[i] = 0;
    const osc = this.osc;
    const buf = this.oscBuf;
    for (const v of this.voices) {
      if (!v.active) continue;
      if (osc === "saw") this.oscSaw(v, buf, len);
      else if (osc === "pulse") this.oscPulse(v, buf, len);
      else if (osc === "sync") this.oscSync(v, buf, len);
      else if (osc === "ring") this.oscRing(v, buf, len);
      else this.oscFm(v, buf, len);
      this.chain(v, buf, len, OSC_LEVEL[osc]);
    }
    this.og += this.ogInc * len;
    this.effects(len);
    let g = this.gain;
    const gi = this.gainInc;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      g += gi;
      let l = mixL[i] * g;
      let r = mixR[i] * g;
      // soft ceiling: untouched below 0.7, bending toward (never past) 1
      const al = l < 0 ? -l : l;
      if (al > 0.7) l = (l < 0 ? -1 : 1) * (0.7 + 0.3 * tanhA((al - 0.7) / 0.3));
      const ar = r < 0 ? -r : r;
      if (ar > 0.7) r = (r < 0 ? -1 : 1) * (0.7 + 0.3 * tanhA((ar - 0.7) / 0.3));
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
      L[at + i] = l;
      R[at + i] = r;
    }
    this.gain = g;
    return peak;
  }

  // ── Oscillators: each writes `len` samples into `out` ──

  private oscSaw(v: Voice, out: Float64Array, len: number) {
    const ph = v.ph;
    const dt = v.dt;
    const di = v.dtInc;
    const n = v.nSaw;
    const gc = v.gC;
    const gs = v.gS;
    let gsub = v.gSub;
    const gsubInc = v.gSubInc;
    let nm2 = v.nm2;
    let nm1 = v.nm1;
    let cm2 = v.cm2;
    let cm1 = v.cm1;
    let c0 = v.c0;
    let sp = ph[7];
    let sdt = dt[7];
    const sdi = di[7];
    for (let i = 0; i < len; i++) {
      let y = 0;
      let cp1 = 0;
      for (let j = 0; j < n; j++) {
        const d = (dt[j] += di[j]);
        let p = ph[j] + d;
        const g = j === 0 ? gc : gs;
        if (p >= 1) {
          p -= 1;
          blep4(p / d);
          const h = -2 * g;
          cm2 += h * RB[0];
          cm1 += h * RB[1];
          c0 += h * RB[2];
          cp1 += h * RB[3];
        }
        ph[j] = p;
        y += g * (2 * p - 1);
      }
      // sub-oscillator: a square an octave down
      gsub += gsubInc;
      sdt += sdi;
      let q = sp + sdt;
      if (q >= 0.5 && sp < 0.5) {
        blep4((q - 0.5) / sdt);
        const h = -2 * gsub;
        cm2 += h * RB[0];
        cm1 += h * RB[1];
        c0 += h * RB[2];
        cp1 += h * RB[3];
      }
      if (q >= 1) {
        q -= 1;
        blep4(q / sdt);
        const h = 2 * gsub;
        cm2 += h * RB[0];
        cm1 += h * RB[1];
        c0 += h * RB[2];
        cp1 += h * RB[3];
        if (q >= 0.5) {
          blep4((q - 0.5) / sdt);
          cm2 -= h * RB[0];
          cm1 -= h * RB[1];
          c0 -= h * RB[2];
          cp1 -= h * RB[3];
        }
      }
      sp = q;
      y += gsub * (q < 0.5 ? 1 : -1);
      out[i] = nm2 + cm2;
      nm2 = nm1;
      nm1 = y;
      cm2 = cm1;
      cm1 = c0;
      c0 = cp1;
    }
    ph[7] = sp;
    dt[7] = sdt;
    v.gSub = gsub;
    v.nm2 = nm2;
    v.nm1 = nm1;
    v.cm2 = cm2;
    v.cm1 = cm1;
    v.c0 = c0;
  }

  private oscPulse(v: Voice, out: Float64Array, len: number) {
    let pa = v.pA;
    let pb = v.pB;
    let ha = v.hiA;
    let hb = v.hiB;
    let da = v.dtA;
    let db = v.dtB;
    let w = v.w;
    let gb = v.gB;
    const ga = v.gA;
    const dai = v.dtAInc;
    const dbi = v.dtBInc;
    const wi = v.wInc;
    const gbi = v.gBInc;
    let nm2 = v.nm2;
    let nm1 = v.nm1;
    let cm2 = v.cm2;
    let cm1 = v.cm1;
    let c0 = v.c0;
    for (let i = 0; i < len; i++) {
      da += dai;
      db += dbi;
      w += wi;
      gb += gbi;
      let cp1 = 0;
      // first square
      pa += da;
      if (ha && pa >= w) {
        blep4(Math.min(0.99999, (pa - w) / da));
        const h = -2 * ga;
        cm2 += h * RB[0];
        cm1 += h * RB[1];
        c0 += h * RB[2];
        cp1 += h * RB[3];
        ha = false;
      }
      if (pa >= 1) {
        pa -= 1;
        blep4(pa / da);
        const h = 2 * ga;
        cm2 += h * RB[0];
        cm1 += h * RB[1];
        c0 += h * RB[2];
        cp1 += h * RB[3];
        ha = true;
        if (pa >= w) {
          blep4(Math.min(0.99999, (pa - w) / da));
          cm2 -= h * RB[0];
          cm1 -= h * RB[1];
          c0 -= h * RB[2];
          cp1 -= h * RB[3];
          ha = false;
        }
      }
      // second square
      pb += db;
      if (hb && pb >= w) {
        blep4(Math.min(0.99999, (pb - w) / db));
        const h = -2 * gb;
        cm2 += h * RB[0];
        cm1 += h * RB[1];
        c0 += h * RB[2];
        cp1 += h * RB[3];
        hb = false;
      }
      if (pb >= 1) {
        pb -= 1;
        blep4(pb / db);
        const h = 2 * gb;
        cm2 += h * RB[0];
        cm1 += h * RB[1];
        c0 += h * RB[2];
        cp1 += h * RB[3];
        hb = true;
        if (pb >= w) {
          blep4(Math.min(0.99999, (pb - w) / db));
          cm2 -= h * RB[0];
          cm1 -= h * RB[1];
          c0 -= h * RB[2];
          cp1 -= h * RB[3];
          hb = false;
        }
      }
      const y = ga * (ha ? 2 - 2 * w : -2 * w) + gb * (hb ? 2 - 2 * w : -2 * w);
      out[i] = nm2 + cm2;
      nm2 = nm1;
      nm1 = y;
      cm2 = cm1;
      cm1 = c0;
      c0 = cp1;
    }
    v.pA = pa;
    v.pB = pb;
    v.hiA = ha;
    v.hiB = hb;
    v.dtA = da;
    v.dtB = db;
    v.w = w;
    v.gB = gb;
    v.nm2 = nm2;
    v.nm1 = nm1;
    v.cm2 = cm2;
    v.cm1 = cm1;
    v.c0 = c0;
  }

  /** Hard sync: a saw (B) restarted every cycle of a silent master (A); both its own wraps and the restarts are smoothed. */
  private oscSync(v: Voice, out: Float64Array, len: number) {
    let pm = v.pA;
    let ps = v.pB;
    let dm = v.dtA;
    let ds = v.dtB;
    const dmi = v.dtAInc;
    const dsi = v.dtBInc;
    let nm2 = v.nm2;
    let nm1 = v.nm1;
    let cm2 = v.cm2;
    let cm1 = v.cm1;
    let c0 = v.c0;
    for (let i = 0; i < len; i++) {
      dm += dmi;
      ds += dsi;
      let cp1 = 0;
      pm += dm;
      ps += ds;
      if (pm >= 1) {
        pm -= 1;
        const xm = pm / dm;
        let at = ps - ds * xm;
        if (at >= 1) {
          // the slave wrapped on its own just before the restart
          blep4(Math.min(0.99999, (ps - 1) / ds));
          cm2 -= 2 * RB[0];
          cm1 -= 2 * RB[1];
          c0 -= 2 * RB[2];
          cp1 -= 2 * RB[3];
          at -= 1;
        }
        blep4(xm);
        const h = -2 * at;
        cm2 += h * RB[0];
        cm1 += h * RB[1];
        c0 += h * RB[2];
        cp1 += h * RB[3];
        ps = ds * xm;
      } else if (ps >= 1) {
        ps -= 1;
        blep4(ps / ds);
        cm2 -= 2 * RB[0];
        cm1 -= 2 * RB[1];
        c0 -= 2 * RB[2];
        cp1 -= 2 * RB[3];
      }
      out[i] = nm2 + cm2;
      nm2 = nm1;
      nm1 = 2 * ps - 1;
      cm2 = cm1;
      cm1 = c0;
      c0 = cp1;
    }
    v.pA = pm;
    v.pB = ps;
    v.dtA = dm;
    v.dtB = ds;
    v.nm2 = nm2;
    v.nm1 = nm1;
    v.cm2 = cm2;
    v.cm1 = cm1;
    v.c0 = c0;
  }

  /**
   * Ring: a band-limited saw multiplied by a sine (a fifth of the saw is left dry so the note
   * still reads). Multiplying shifts every harmonic of the saw up by the sine's pitch, and even
   * two clean inputs then reach past half the sample rate and fold back as noise; so this one
   * oscillator runs at twice the rate and is filtered down (the shifted harmonics land above the
   * audible band, where the half-band filter removes them).
   */
  private oscRing(v: Voice, out: Float64Array, len: number) {
    let pa = v.pA;
    let pb = v.pB;
    let da = v.dtA * 0.5;
    let db = v.dtB * 0.5;
    const dai = v.dtAInc * 0.5;
    const dbi = v.dtBInc * 0.5;
    const hb = v.hb;
    let nm2 = v.nm2;
    let nm1 = v.nm1;
    let cm2 = v.cm2;
    let cm1 = v.cm1;
    let c0 = v.c0;
    for (let i = 0; i < len; i++) {
      da += dai;
      db += dbi;
      let a = 0;
      for (let h2 = 0; h2 < 2; h2++) {
        let cp1 = 0;
        pb += db;
        if (pb >= 1) pb -= 1;
        const m = 0.2 + 0.8 * sin2pi(pb);
        pa += da;
        if (pa >= 1) {
          pa -= 1;
          const x = pa / da;
          blep4(x);
          // the jump is the saw's drop times the sine where it was at the moment of the wrap, not at the sample
          const h = -2 * (0.2 + 0.8 * sin2pi(pb - db * x));
          cm2 += h * RB[0];
          cm1 += h * RB[1];
          c0 += h * RB[2];
          cp1 += h * RB[3];
        }
        const y = nm2 + cm2;
        nm2 = nm1;
        nm1 = m * (2 * pa - 1);
        cm2 = cm1;
        cm1 = c0;
        c0 = cp1;
        if (h2 === 0) a = y;
        else out[i] = halfDown(hb, a, y);
      }
    }
    for (let k = 0; k < 10; k++) hb[k] = flush(hb[k]);
    da *= 2;
    db *= 2;
    v.pA = pa;
    v.pB = pb;
    v.dtA = da;
    v.dtB = db;
    v.nm2 = nm2;
    v.nm1 = nm1;
    v.cm2 = cm2;
    v.cm1 = cm1;
    v.c0 = c0;
  }

  /** Two-operator FM (phase modulation): a sine carrier at the note, bent by a sine modulator. */
  private oscFm(v: Voice, out: Float64Array, len: number) {
    let pc = v.pA;
    let pm = v.pB;
    let dc = v.dtA;
    let dm = v.dtB;
    let idx = v.w;
    const dci = v.dtAInc;
    const dmi = v.dtBInc;
    const ii = v.wInc;
    const k = 1 / (2 * Math.PI);
    // the same two-sample delay as the other oscillators, so switching type never shifts the timing
    let nm2 = v.nm2;
    let nm1 = v.nm1;
    for (let i = 0; i < len; i++) {
      dc += dci;
      dm += dmi;
      idx += ii;
      pc += dc;
      if (pc >= 1) pc -= 1;
      pm += dm;
      if (pm >= 1) pm -= 1;
      out[i] = nm2;
      nm2 = nm1;
      nm1 = sin2pi(pc + idx * k * sin2pi(pm));
    }
    v.pA = pc;
    v.pB = pm;
    v.dtA = dc;
    v.dtB = dm;
    v.w = idx;
    v.nm2 = nm2;
    v.nm1 = nm1;
  }

  /**
   * DC blocker, noise, the ladder filter, envelope and amplifier, then into the mix. The filter
   * and its saturating input run at twice the sample rate (up with a half-band filter, down with
   * another): a saturating filter makes new high harmonics, and at the plain rate those above
   * 24 kHz would fold back down as noise.
   */
  private chain(v: Voice, x: Float64Array, len: number, level: number) {
    const mixL = this.mixL;
    const mixR = this.mixR;
    const R = this.dcR;
    let dcx = v.dcx;
    let dcy = v.dcy;
    const noise = this.noiseAmt;
    const oscG = this.oscAmt;
    let rng = v.rng;
    let s1 = v.s1;
    let s2 = v.s2;
    let s3 = v.s3;
    let s4 = v.s4;
    let G = v.G;
    const GInc = v.GInc;
    let D = v.D;
    const DInc = v.DInc;
    const k = this.kRes;
    const kIn = this.kIn;
    const outG = this.outG;
    const up = v.up;
    const dn = v.dn;
    let env = v.env;
    let stage = v.stage;
    let gateEnv = v.gateEnv;
    const gate = v.gate;
    const cA = v.cA;
    const cD = v.cD;
    const cR = v.cR;
    const sus = this.sSus;
    const cG = gate > 0 ? this.cGOn : this.cGOff;
    const aAmt = this.aAmt;
    let trem = v.trem;
    const tremInc = v.tremInc;
    let vg = v.vg;
    const vgInc = v.vgInc;
    let kg = v.killGain;
    const kill = v.kill;
    const kStep = 1 / (0.005 * this.sr);
    let og = this.og;
    const ogInc = this.ogInc;
    const gl = v.gl * VOICE_GAIN * level * outG;
    const gr = v.gr * VOICE_GAIN * level * outG;
    const invSat = 1 / SAT;
    for (let i = 0; i < len; i++) {
      // DC blocker
      let s = x[i] * oscG;
      const y0 = s - dcx + R * dcy;
      dcx = s;
      dcy = y0;
      s = y0;
      if (noise > 0) {
        rng ^= rng << 13;
        rng ^= rng >>> 17;
        rng ^= rng << 5;
        s += noise * ((rng >>> 0) / 2147483648 - 1);
      }
      // four-pole ladder, zero-delay feedback solved exactly, the input saturating; two steps per sample
      G += GInc;
      D += DInc;
      const b = 1 - G;
      halfUp(up, s * kIn);
      let ya = 0;
      let yb = 0;
      for (let h = 0; h < 2; h++) {
        const S = b * (G * (G * (G * s1 + s2) + s3) + s4);
        let u = (UP[h] - k * S) * D;
        u = SAT * tanhA(u * invSat);
        let vv = (u - s1) * G;
        const y1 = vv + s1;
        s1 = y1 + vv;
        vv = (y1 - s2) * G;
        const y2 = vv + s2;
        s2 = y2 + vv;
        vv = (y2 - s3) * G;
        const y3 = vv + s3;
        s3 = y3 + vv;
        vv = (y3 - s4) * G;
        const y4 = vv + s4;
        s4 = y4 + vv;
        if (h === 0) ya = y4;
        else yb = y4;
      }
      const y = halfDown(dn, ya, yb);
      // envelope (analogue style: the attack aims past the top and stops there)
      if (stage === 1) {
        env += (1.3 - env) * cA;
        if (env >= 1) {
          env = 1;
          stage = 2;
        }
      } else if (stage === 2) env += (sus - env) * cD;
      else env -= env * cR;
      gateEnv += (gate - gateEnv) * cG;
      if (kill) {
        kg -= kStep;
        if (kg < 0) kg = 0;
      }
      trem += tremInc;
      vg += vgInc;
      og += ogInc;
      const out = y * (aAmt * env + (1 - aAmt) * gateEnv) * trem * vg * kg * og;
      mixL[i] += out * gl;
      mixR[i] += out * gr;
    }
    v.dcx = dcx;
    v.dcy = flush(dcy);
    v.rng = rng;
    v.s1 = s1;
    v.s2 = s2;
    v.s3 = s3;
    v.s4 = s4;
    v.G = G;
    v.D = D;
    v.env = env;
    v.stage = stage;
    v.gateEnv = gateEnv;
    v.trem = trem;
    v.vg = vg;
    v.killGain = kg;
    // finished: released and below −90 dB, or faded out after being stolen
    const level0 = aAmt * env + (1 - aAmt) * gateEnv;
    if ((kill && kg <= 0) || (stage === 3 && level0 < 3e-5)) {
      v.active = false;
      v.held = false;
      if (this.mono === v) this.mono = null;
    }
  }

  private effects(len: number) {
    const mixL = this.mixL;
    const mixR = this.mixR;
    const fxL = this.fxL;
    const fxR = this.fxR;
    const sr = this.sr;
    const depth = this.sFxDepth;
    const rate = this.sFxRate;
    for (let e = 0; e < 4; e++) {
      const w = this.fxW[e];
      if (w <= 0) {
        this.fxLive[e] = false;
        continue;
      }
      if (!this.fxLive[e]) {
        // coming back after a rest: start from silence, not from an old echo
        if (e === 0) this.dist.reset();
        else if (e === 1) this.chorus.reset();
        else if (e === 2) this.phaser.reset();
        else this.delay.reset();
        this.fxLive[e] = true;
      }
      if (w >= 1) {
        if (e === 0) this.dist.process(mixL, mixR, len, depth, rate, sr);
        else if (e === 1) this.chorus.process(mixL, mixR, len, depth, rate, sr);
        else if (e === 2) this.phaser.process(mixL, mixR, len, depth, rate, sr);
        else this.delay.process(mixL, mixR, len, depth, rate, sr);
        continue;
      }
      // crossfading between effects: process a copy and blend
      for (let i = 0; i < len; i++) {
        fxL[i] = mixL[i];
        fxR[i] = mixR[i];
      }
      if (e === 0) this.dist.process(fxL, fxR, len, depth, rate, sr);
      else if (e === 1) this.chorus.process(fxL, fxR, len, depth, rate, sr);
      else if (e === 2) this.phaser.process(fxL, fxR, len, depth, rate, sr);
      else this.delay.process(fxL, fxR, len, depth, rate, sr);
      for (let i = 0; i < len; i++) {
        mixL[i] += w * (fxL[i] - mixL[i]);
        mixR[i] += w * (fxR[i] - mixR[i]);
      }
    }
    if (this.sWidth > 0.01) this.widener.process(mixL, mixR, len, this.sWidth, sr);
    // reverb: runs while it is turned up (it starts from silence each time it is turned back on)
    const rev = this.sRev;
    if (rev > 1e-4) {
      if (!this.revLive) {
        this.reverb.reset();
        this.revLive = true;
      }
      this.reverb.process(mixL, mixR, len, rev);
    } else this.revLive = false;
  }
}

// ── Messages ─────────────────────────────────────────────────────────────────────────────────

/** The name the worklet registers its processor under. */
export const SYNTH_PROCESSOR = "m-theory-synth";

/**
 * What the synth can be told, in seconds on the audio clock. The same list drives the worklet
 * (live, sent a few at a time; offline, all at once in its options) and the tests, so a render
 * is made of exactly the events a live performance is.
 */
export type SynthEvent =
  /** a note starts; `id` names it for its "off"; `slot` ≥ 0 takes over from the note before on that slot */
  | { type: "on"; t: number; midi: number; vel: number; id: number; slot?: number }
  | { type: "off"; t: number; id: number }
  /** every note lets go at `t`, and notes already sent that would start at or after `t` are dropped */
  | { type: "stop"; t: number }
  /** a new sound (the engine's own terms: macros already applied); at `t`, or at once without it */
  | { type: "params"; t?: number; params: SynthParams }
  /** the song starts here: movement that runs on its own starts over (see SynthKernel.syncAt) */
  | { type: "sync"; t: number }
  /** silence at once and forget everything to come */
  | { type: "panic" };

/** Hand one event to a kernel. */
export function feed(k: SynthKernel, e: SynthEvent) {
  const sr = k.sr;
  switch (e.type) {
    case "on":
      k.noteOn(e.t * sr, e.midi, e.vel, e.id, e.slot ?? -1);
      break;
    case "off":
      k.noteOff(e.t * sr, e.id);
      break;
    case "stop":
      k.allOff(e.t * sr, true);
      break;
    case "params":
      if (e.t === undefined) k.setParams(e.params);
      else k.paramsAt(e.t * sr, e.params);
      break;
    case "sync":
      k.syncAt(e.t * sr);
      break;
    case "panic":
      k.panic();
      break;
  }
}

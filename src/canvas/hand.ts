/**
 * The hand: it holds the brushes.
 *
 * Every tone the ear is following has a brush of its own on the canvas, for exactly as long as
 * the tone sounds. The brush comes down when the tone starts, at the height of its frequency;
 * it is pulled along with the music while the tone lasts, pressed as hard as the tone is loud,
 * following its pitch up and down (a bend is a slope, a vibrato a ripple); and it is lifted the
 * moment the tone stops. Nothing is decided in advance: a staccato note is over before the brush
 * has moved, so it leaves a dab; a held note leaves a stroke as long as itself; a plucked note
 * that dies away leaves a head and a thinning tail.
 *
 * A brush carries only so much paint. It runs dry as it goes, its fullest hairs marking last
 * and only the tops of the paper's grain taking colour, until the tone swells again or the hand
 * dips it.
 *
 * A hit (a drum, a consonant, the click of a pick) is paint thrown: drops across the stretch of
 * the scale the hit filled, big and few for a thump, fine and many for a hiss. Noise that goes
 * on (a cymbal's wash, breath) is a dry brush scrubbed lightly where the noise is.
 *
 * The hand is never quite steady and no two of its brushes are alike: each has its own size,
 * its own lean and its own load of paint, and the tip follows where it is sent the way a real
 * one does, a little late and with a little overshoot.
 */
import type { Frame, Hit, Voice } from "../listen/ear";
import { NOISE_BANDS, noiseHz } from "../listen/ear";
import { hexToRgb, mix as mixRgb, vary, type RGB } from "./color";
import { colorIndex, midiOfHz, noteColors, upOfHz, yOfHz } from "./layout";
import { roles, type Palette } from "./palettes";
import { gauss, noise, rng, type Rng } from "./rand";
import { paintOf, type Stamp } from "./sim";

/** The manner of the painting just now (set from the mood of the music, or by choice). */
export interface Manner {
  /** 0 = thick, dry paint … 1 = thin and wet */
  wet: number;
  /** how unsteady the hand is, 0..1 */
  loose: number;
  /** how much paint there is to a mark, 1 = as usual */
  body: number;
}

interface Brush {
  id: number;
  /** the tip: where it is and how it is moving (pixels, pixels a second) */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** where a mark was last left, and how far the tip has gone since */
  px: number;
  py: number;
  /** the brush itself: how big for its pitch, its paint, its lean */
  size: number;
  k: [number, number, number];
  lean: number;
  seed: number;
  /** paint left on it (1 = just dipped), and how far a load lasts (pixels) */
  load: number;
  reach: number;
  /** how wet this brush is against the others */
  water: number;
  /** the loudest the tone has been since the brush was last dipped */
  top: number;
  /** how hard the tone began, and how long the brush has been down (seconds) */
  struck: number;
  age: number;
  r: number;
  /** a soft tone that swelled in is laid as a wash, not a line */
  wash: boolean;
  /** the height it is being sent to, eased (the ear's reading of a pitch flickers a little) */
  ty: number;
  /** how much the stroke climbs or falls as it goes (pixels a pixel): no hand pulls a dead level line */
  slope: number;
  x0: number;
  /** the tone it was set down for, and when; and whether it is the overtone of another brush's note */
  hz: number;
  born: number;
  overtone: boolean;
}

const TAU = Math.PI * 2;
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
/** The tip follows its target like a weight on a spring (8.6 Hz, a little under-damped: the measure a well-known ink library settled on for a natural hand). */
const SPRING = 54.3;
const DAMP = 72;

export class Hand {
  private brushes = new Map<number, Brush>();
  private r: Rng;
  private seed: number;
  private h = 400;
  /** real pixels to one design pixel (the canvas is designed 560 tall) */
  private u = 1;
  private pal: Palette | null = null;
  private map: number[] = noteColors(0, [0, 2, 4, 5, 7, 9, 11], 6);
  private colors: RGB[] = [[40, 40, 40]];
  private low: RGB = [30, 30, 30];
  private high: RGB = [240, 240, 240];
  private ink: RGB = [20, 20, 20];
  private pop: RGB = [200, 60, 40];
  /** the last place the music was, across the canvas: a jump back means a new pass */
  private lastX = -1;
  /** the time of the last frame painted */
  private lastT = -1;
  /** how many marks have gone down */
  made = 0;

  constructor(seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0) {
    this.seed = seed;
    this.r = rng(seed);
  }

  size(w: number, h: number) {
    void w;
    this.h = h;
    this.u = h / 560;
  }
  setPalette(p: Palette) {
    this.pal = p;
    this.colors = p.colors.map(hexToRgb);
    const role = roles(p);
    this.low = hexToRgb(role.low);
    this.high = hexToRgb(role.high);
    this.pop = hexToRgb(role.pop);
    this.ink = hexToRgb(p.ink);
    this.map = noteColors(this.tonic, this.scale, this.colors.length);
  }
  private tonic = 0;
  private scale = [0, 2, 4, 5, 7, 9, 11];
  /** The key: which notes are family, so which share neighbouring colours. */
  setKey(tonic: number, scale: number[]) {
    this.tonic = tonic;
    this.scale = scale;
    this.map = noteColors(tonic, scale, this.colors.length);
  }

  /** A new painting: a new hand, unlike the last. */
  reseed(seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0) {
    this.seed = seed;
    this.r = rng(seed);
    this.lift();
    this.made = 0;
  }

  /** Every brush off the canvas (the music stopped, or jumped). */
  lift() {
    this.brushes.clear();
    this.lastX = -1;
    this.lastT = -1;
  }
  get down() {
    return this.brushes.size;
  }

  /** The colour a tone is painted in: its note's place in the key, never quite the same twice. */
  private colourOf(hz: number): RGB {
    const midi = Math.round(midiOfHz(hz));
    const base = this.pal ? this.pal.colors[colorIndex(midi, this.map, this.colors.length)] : "#333333";
    return vary(base, this.r, 1.3);
  }

  /**
   * Paint what was heard. `xAt` says where across the canvas a moment of the music is (real
   * pixels; null = not on the canvas). Marks are handed to `put`.
   */
  paint(frames: Frame[], xAt: (t: number) => number | null, manner: Manner, put: (s: Stamp) => void) {
    const out = (s: Stamp) => {
      this.made++;
      put(s);
    };
    for (const f of frames) {
      const x = xAt(f.t);
      if (x === null) {
        this.lift();
        continue;
      }
      const dt = this.lastT < 0 ? 0.01 : clamp(f.t - this.lastT, 0.002, 0.05);
      // the music came round again (or jumped): every brush is lifted and set down afresh
      const wrapped = this.lastX >= 0 && (x < this.lastX - 3 * this.u || x > this.lastX + 60 * this.u + 400 * dt * this.u);
      if (wrapped) this.brushes.clear();
      this.lastX = x;
      this.lastT = f.t;
      for (const id of f.ended) this.release(id, manner, out);
      for (const v of f.voices) this.follow(v, f.t, x, dt, xAt, manner, out);
      for (const hit of f.hits) this.thrown(hit, x, manner, out);
      this.scrub(f, x, dt, manner, out);
    }
    // a brush whose tone the ear no longer reports has been lifted
    if (frames.length) {
      const alive = new Set(frames[frames.length - 1].voices.map((v) => v.id));
      for (const id of this.brushes.keys()) if (!alive.has(id)) this.brushes.delete(id);
    }
  }

  /** How big a brush is for a tone at `hz`: broad for the low notes, fine for the high ones (design pixels of radius, for a tone at full strength). */
  private sizeOf(hz: number): number {
    const up = upOfHz(hz);
    return 1.8 + 10 * Math.pow(1 - up, 1.7);
  }

  private follow(v: Voice, t: number, x: number, dt: number, xAt: (t: number) => number | null, m: Manner, put: (s: Stamp) => void) {
    const { u, r } = this;
    let b = this.brushes.get(v.id);
    const ty0 = yOfHz(v.hz, this.h);
    if (!b) {
      // the brush comes down where the tone began
      const bx = (v.fresh ? xAt(v.born) : null) ?? x;
      const size = this.sizeOf(v.hz) * (0.75 + 0.6 * r());
      // an overtone of a note that is already being painted (twice, three times … its frequency, begun
      // with it) is that note's shimmer, not a note of its own: a drier, lighter brush, in the note's colour
      let parent: Brush | null = null;
      for (const o of this.brushes.values()) {
        if (o.overtone || Math.abs(o.born - v.born) > 0.06 || o.hz >= v.hz * 0.6) continue;
        const ratio = v.hz / o.hz;
        const whole = Math.round(ratio);
        if (whole >= 2 && whole <= 12 && Math.abs(ratio - whole) < 0.04 * whole && (!parent || o.hz < parent.hz)) parent = o;
      }
      const wash = !parent && v.struck < 0.25 && r() < 0.2 + 0.5 * m.wet;
      b = {
        id: v.id,
        x: Math.min(bx, x),
        y: ty0 + gauss(r) * 0.8 * u * (1 + 2 * m.loose),
        vx: 0,
        vy: 0,
        px: 0,
        py: 0,
        size,
        k: parent ? parent.k : paintOf(this.colourOf(v.hz)),
        lean: gauss(r) * 0.2,
        seed: r() * 97,
        load: parent ? 0.3 + 0.3 * r() : 0.75 + 0.25 * r(),
        reach: (130 + 520 * r() * r()) * u * (0.6 + 0.8 * v.amp),
        water: clamp(0.55 + 0.5 * (r() - 0.5) + (wash ? 0.35 : 0)),
        top: v.amp,
        struck: v.struck,
        age: 0,
        r: 0,
        wash,
        ty: ty0,
        slope: gauss(r) * 0.06 * (0.4 + m.loose),
        x0: Math.min(bx, x),
        hz: v.hz,
        born: v.born,
        overtone: !!parent,
      };
      b.px = b.x;
      b.py = b.y;
      this.brushes.set(v.id, b);
      // set down: a struck tone lands with weight, and may throw a few drops
      b.r = this.radius(b, v, m);
      this.mark(b, b.x, b.y, b.r * (1 + 0.35 * v.struck), 0, m, put, 1.25);
      if (v.struck > 0.75 && v.amp > 0.5 && r() < 0.5) this.spatter(b.x, b.y, b.r * 2.4, Math.round(2 + 5 * r()), b.k, 0.5 * b.r, 0.5, m, put, 0, -1);
    }
    b.age += dt;
    // where it is sent: with the music across, at the tone's own height, and never quite steady
    const wander = m.loose * u;
    b.ty += (ty0 - b.ty) * clamp(dt / 0.04);
    const tx = x + (noise(t * 0.8 + b.seed, 3) - 0.5) * 4 * wander;
    // (the climb is never allowed to carry a long note far from its own height)
    const ty = b.ty + 7 * u * Math.tanh(((x - b.x0) * b.slope) / (7 * u)) + (noise(t * 1.1 + b.seed * 1.7, 5) - 0.5) * 5 * wander;
    // the tip goes there as a weight on a spring does
    const steps = 2;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      b.vx += ((tx - b.x) * SPRING * SPRING - DAMP * b.vx) * h;
      b.vy += ((ty - b.y) * SPRING * SPRING - DAMP * b.vy) * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    // the tone swelled well past where it was when the brush was dipped: it is dipped again
    if (!b.overtone && v.amp > b.top + 0.18) {
      b.load = Math.max(b.load, 0.7 + 0.3 * r());
      b.top = v.amp;
    }
    const want = this.radius(b, v, m);
    // pressure does not jump: it follows over a few hundredths of a second
    b.r += (want - b.r) * clamp(dt / 0.03);
    this.pull(b, m, put);
  }

  /** How wide the brush marks right now (real pixels of radius): pressed as hard as the tone is loud. */
  private radius(b: Brush, v: Voice, _m: Manner): number {
    const press = 0.16 + 1.0 * Math.pow(v.amp, 1.7);
    return Math.max(0.6, b.size * press * this.u * (b.wash ? 1.35 : b.overtone ? 0.8 : 1));
  }

  /** Leave marks along the way from where the last one was left to where the tip is now. */
  private pull(b: Brush, m: Manner, put: (s: Stamp) => void) {
    const dx = b.x - b.px;
    const dy = b.y - b.py;
    const dist = Math.hypot(dx, dy);
    const space = Math.max(0.7, b.r * 0.34);
    if (dist < space) return;
    const n = Math.min(40, Math.floor(dist / space));
    const ang = Math.atan2(dy, dx);
    for (let i = 1; i <= n; i++) {
      const f = (i * space) / dist;
      this.mark(b, b.px + dx * f, b.py + dy * f, b.r, ang, m, put, 1);
      b.load = Math.max(0, b.load - space / b.reach);
    }
    b.px += dx * ((n * space) / dist);
    b.py += dy * ((n * space) / dist);
  }

  /** One touch of a brush. */
  private mark(b: Brush, x: number, y: number, radius: number, ang: number, m: Manner, put: (s: Stamp) => void, weight: number) {
    const { r } = this;
    const wet = clamp(m.wet * (0.5 + b.water));
    const speed = Math.hypot(b.vx, b.vy);
    // every touch a little different in size and weight; scattered a little across the stroke, more as the hand loosens
    const size = radius * (0.87 + 0.26 * r());
    const side = gauss(r) * radius * 0.07 * (0.5 + m.loose);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    // touches overlap about four deep along a stroke: each carries its share
    const share = 0.17 * weight * m.body * (0.78 + 0.3 * r()) * (0.45 + 0.75 * clamp(radius / (b.size * this.u)));
    put({
      x: x + nx * side,
      y: y + ny * side,
      r: size,
      angle: ang + b.lean * 0.3,
      stretch: b.wash ? 1.1 : 1.25 + Math.min(0.9, speed / (140 * this.u)),
      k: b.k,
      // thick paint covers; a wash is mostly water
      paint: share * (b.wash ? 0.45 : 1) * (1.15 - 0.55 * wet),
      water: share * wet * (b.wash ? 3.2 : 2.2),
      vx: b.vx * 0.5,
      vy: b.vy * 0.5,
      load: b.wash ? 1 : clamp(b.load + 0.25 * wet),
      kind: b.wash ? 2 : 0,
      hard: b.wash ? 0.2 : 0.35 + 0.45 * (1 - wet),
      seed: b.seed,
    });
  }

  /** The tone stopped: the brush is lifted, leaving a short tail the way it was going. */
  private release(id: number, m: Manner, put: (s: Stamp) => void) {
    const b = this.brushes.get(id);
    if (!b) return;
    this.brushes.delete(id);
    if (b.wash || b.overtone || b.r < 0.9 * this.u) return;
    const speed = Math.hypot(b.vx, b.vy);
    const ang = speed > 4 ? Math.atan2(b.vy, b.vx) + gauss(this.r) * 0.25 : gauss(this.r) * 0.5;
    // a flick: longer the quicker the hand is, each touch smaller and drier than the last
    const len = b.r * (1.2 + 1.8 * this.r() + Math.min(2, speed / (120 * this.u)));
    const n = Math.max(2, Math.round(len / Math.max(0.7, b.r * 0.4)));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const ease = 1 - f * f;
      b.load *= 0.86;
      this.mark(b, b.px + Math.cos(ang) * len * f, b.py + Math.sin(ang) * len * f, b.r * (0.25 + 0.75 * ease), ang, m, put, 0.9 * ease + 0.1);
    }
  }

  /** Drops of paint about a point. Sizes fall as real spatter does: most are small, a few are large (and the large ones thinner). */
  private spatter(x: number, y: number, spread: number, count: number, k: [number, number, number], median: number, sigma: number, m: Manner, put: (s: Stamp) => void, dirX: number, dirY: number, tall = 0) {
    const { r } = this;
    const wet = clamp(m.wet + 0.15);
    for (let i = 0; i < count; i++) {
      const size = clamp(median * Math.exp(gauss(r) * sigma), 0.45 * this.u, 11 * this.u);
      // thrown: further along the throw than across it
      const far = Math.abs(gauss(r)) * spread;
      const a = Math.atan2(dirY, dirX) + gauss(r) * (dirX === 0 && dirY === 0 ? 3 : 0.7);
      const big = Math.min(1, (median / size) * (median / size));
      put({
        x: x + Math.cos(a) * far + gauss(r) * spread * 0.25,
        y: y + Math.sin(a) * far + gauss(r) * (spread * 0.25 + tall),
        r: size,
        angle: a,
        stretch: 1 + Math.min(1.4, far / (spread + 1)) * r(),
        k,
        paint: 0.55 * m.body * (0.35 + 0.65 * big) * (0.8 + 0.4 * r()),
        water: wet * (0.5 + 0.6 * r()) * (size > 4 * this.u ? 1.2 : 0.5),
        vx: Math.cos(a) * 30 * this.u,
        vy: Math.sin(a) * 30 * this.u,
        load: 1,
        kind: 1,
        hard: 0.55 + 0.4 * r(),
        seed: r() * 97,
      });
    }
  }

  /** A hit: paint thrown across the stretch of the scale it filled. */
  private thrown(hit: Hit, x: number, m: Manner, put: (s: Stamp) => void) {
    const { r, u } = this;
    const yLo = yOfHz(hit.lo, this.h);
    const yHi = yOfHz(hit.hi, this.h);
    const y = yOfHz(hit.hz, this.h);
    const span = Math.abs(yLo - yHi);
    const up = upOfHz(hit.hz);
    // what it is thrown in: the dark of the palette for a thump, its light for a tick, the note's own colour between
    const own = this.colourOf(hit.hz);
    const tone = up < 0.25 ? mixRgb(this.low, own, 0.25) : up > 0.72 ? mixRgb(this.high, this.ink, r() < 0.5 ? 0.15 : 0.6) : mixRgb(own, this.ink, 0.35 * hit.noisy);
    const k = paintOf(vary(`#${tone.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`, r, 1));
    const s = hit.strength;
    if (hit.noisy < 0.45 && up < 0.4) {
      // a thump: one soft, wet blot where its weight is, and a few drops off it
      const size = (6 + 17 * s) * u * (0.8 + 0.4 * r());
      put({ x: x + gauss(r) * 2 * u, y: y + gauss(r) * 3 * u, r: size, angle: r() * TAU, stretch: 1 + 0.3 * r(), k, paint: 0.32 * m.body * (0.5 + 0.6 * s), water: (0.35 + 0.8 * m.wet) * (0.6 + 0.5 * s), vx: 0, vy: 0, load: 1, kind: 2, hard: 0.25 + 0.3 * (1 - m.wet), seed: r() * 97 });
      this.made++;
      this.spatter(x, y, size * 1.3, Math.round(2 + 7 * s * r()), k, 1.6 * u, 0.7, m, put, 0, 0);
      return;
    }
    // otherwise drops: fine and many for a hiss, fewer and fatter for something with a note in it,
    // spread up and down over the stretch of the scale the hit filled
    const count = Math.round((2 + 50 * s) * (0.35 + 0.65 * hit.noisy) * (0.7 + 0.6 * r()));
    const median = (0.9 + 2.6 * s * (1 - 0.6 * hit.noisy)) * u * (1.4 - 0.7 * up);
    const sigma = 0.3 + 0.4 * (1 - hit.noisy) + 0.2 * s;
    // thrown a little way on from where the music is, up or down as it happens
    const dir = gauss(r) * 0.6;
    this.spatter(x + 2 * u, y, (5 + 16 * s) * u, count, k, median, sigma, m, put, Math.cos(dir), Math.sin(dir), span * 0.3);
  }

  /** Noise that goes on: a dry brush scrubbed where it is, lightly, catching the tops of the grain. */
  private scrub(f: Frame, x: number, dt: number, m: Manner, put: (s: Stamp) => void) {
    const { r, u } = this;
    for (let b = 0; b < NOISE_BANDS; b++) {
      const n = f.noise[b];
      if (n < 0.22) continue;
      // so many touches a second, more the louder the noise
      if (r() > (n - 0.18) * 22 * dt) continue;
      const hz = noiseHz(b) * Math.pow(2, (r() - 0.5) / 3);
      const up = upOfHz(hz);
      const tone = up > 0.7 ? mixRgb(this.high, this.ink, r() < 0.6 ? 0.2 : 0.7) : mixRgb(this.colourOf(hz), this.ink, 0.4);
      const size = (2.5 + 7 * (1 - up) + 4 * n) * u * (0.6 + 0.8 * r());
      this.made++;
      put({
        x: x - r() * 10 * u,
        y: yOfHz(hz, this.h) + gauss(r) * 2 * u,
        r: size,
        angle: gauss(r) * 0.5,
        stretch: 1.6 + 1.4 * r(),
        k: paintOf(tone),
        paint: 0.22 * m.body * (0.5 + n),
        water: 0.1 * m.wet,
        vx: 20 * u,
        vy: 0,
        load: 0.18 + 0.3 * n * r(),
        kind: 0,
        hard: 0.5,
        seed: r() * 97,
      });
    }
    void this.pop;
    void this.seed;
  }
}

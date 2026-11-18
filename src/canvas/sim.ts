/**
 * Wet paint, on the graphics card.
 *
 * The painting is three sheets, each as large as the canvas:
 *
 * - **wet paint**: for every point, how much pigment lies there still wet, and what it is;
 * - **water and movement**: how wet the point is, and which way the paint there is moving;
 * - **the dry painting**: the colour that has set, and how thick the set paint is.
 *
 * A brush (or a drop) puts pigment, water and a push onto the first two. Then, sixty times a
 * second, every point is worked out again from itself and its neighbours:
 *
 * - paint flows from where it stands thick and wet to where it is thin, is carried the way it
 *   was pushed, sinks if drips are on, and is stirred a little by the music; it only moves
 *   while it is wet, so it runs out to the edge of its puddle and stops there, which is what
 *   leaves the dark rim of a watercolour wash;
 * - pigment bleeds between neighbouring points that are both wet (wet into wet), and water
 *   creeps a little way into dry paper;
 * - water dries off, and as a point dries its pigment settles onto the dry painting, more of
 *   it in the hollows of the paper than on its ridges (granulation). A stroke put down with
 *   no water sets at once, only where the brush's hairs and the tooth of the paper met.
 *
 * Colours mix as pigments do, not as lights: each is held as how much it absorbs against how
 * much it scatters (Kubelka and Munk's measure, K/S, kept for red, green and blue), and
 * those add up when paints meet. That is why blue into yellow goes green here, where plain
 * averaging of screen colours would give grey.
 *
 * The picture shown is the dry painting with the wet paint over it, lit from the upper left
 * by the thickness of the paint, with a shine where it is still wet.
 *
 * Paint also knows how deep it lies. Every mark carries a depth (fog and washes underneath,
 * lines in the middle, impacts on top), and when paint sets under paint that lies above it, it
 * shows only where that paint is thin: a wash that dries after a spatter of drops goes in
 * under the drops, as an underpainting would, instead of over them.
 *
 * A fourth sheet holds light: a glaze laid on in light rather than pigment (the voice's ribbon)
 * brightens what is under it, as light does, where pigment would darken it.
 *
 * The whole canvas can also drift (the river layout): the sheets are moved along a whole pixel
 * at a time, so nothing is blurred by the move.
 */

export interface Stamp {
  /** where (canvas pixels) and how big (the radius across the hairs) */
  x: number;
  y: number;
  r: number;
  /** which way the brush is moving (radians) and how much longer than wide the mark is */
  angle: number;
  stretch: number;
  /** the paint: its colour as K/S for red, green, blue; how much pigment; how much water */
  k: [number, number, number];
  paint: number;
  water: number;
  /** the push it gives the wet paint (pixels a second) */
  vx: number;
  vy: number;
  /** how loaded the brush is: 1 = full, towards 0 = dry, leaving only streaks on the tooth of the paper */
  load: number;
  /** 0 = a brush (hairs along the stroke), 1 = a drop (round, crisp), 2 = a soft bloom */
  kind: number;
  /** how crisp its edge is, 0..1, and a number that makes this mark unlike the last */
  hard: number;
  seed: number;
  /** how deep it lies: 0 = underneath everything … 1 = on top (0.5 when not said) */
  depth?: number;
}

export interface SimSettings {
  /** how fast paint levels out and runs (1 = as usual) */
  flow: number;
  /** how much wet paint bleeds into wet paint */
  bleed: number;
  /** how fast it dries (1 = as usual; less = it stays wet and keeps moving for longer) */
  dry: number;
  /** drips: how hard wet paint is pulled down the canvas (0 = not at all) */
  gravity: number;
  /** how much the music stirs what is still wet */
  stir: number;
  /** how fast the dry painting fades back into the ground (a part each second; 0 = it stays) */
  fade: number;
  /** how much the thickness of the paint is lit */
  relief: number;
  /** how the whole canvas drifts (pixels a second; the river flows left) */
  driftX: number;
  driftY: number;
}

export const SIM_DEFAULTS: SimSettings = { flow: 1, bleed: 1, dry: 1, gravity: 0, stir: 0.4, fade: 0, relief: 1, driftX: 0, driftY: 0 };

/** Screen colour (0..255 each) to light as it really is (linear, 0..1). */
export const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
export const toScreen = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
/** A colour's absorption against its scattering (Kubelka-Munk), from how much light it sends back (0..1). */
export const ksOf = (r: number) => {
  const x = Math.min(0.985, Math.max(0.015, r));
  return ((1 - x) * (1 - x)) / (2 * x);
};
/** And back: how much light a paint of that K/S sends back. */
export const reflOf = (ks: number) => 1 + ks - Math.sqrt(ks * ks + 2 * ks);
/** A screen colour as paint. */
export const paintOf = (rgb: readonly [number, number, number]): [number, number, number] => [ksOf(toLinear(rgb[0])), ksOf(toLinear(rgb[1])), ksOf(toLinear(rgb[2]))];
/** What two paints make, `t` of the second in the first (0..1): as screen colours in and out. */
export function mixPaint(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  const ka = paintOf(a);
  const kb = paintOf(b);
  return [0, 1, 2].map((i) => toScreen(reflOf(ka[i] * (1 - t) + kb[i] * t))) as [number, number, number];
}

const STRIDE = 20;
const MAX_STAMPS = 8192;

const VERT_QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 ksOf(vec3 r) { vec3 x = clamp(r, 0.015, 0.985); return (1.0 - x) * (1.0 - x) / (2.0 * x); }
vec3 reflOf(vec3 k) { return 1.0 + k - sqrt(k * k + 2.0 * k); }
`;

const VERT_STAMP = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPlace;   // x, y, radius, angle
layout(location = 2) in vec4 aPaint;   // k.rgb, amount
layout(location = 3) in vec4 aPush;    // water, vx, vy, load
layout(location = 4) in vec4 aMore;    // seed, kind, stretch, hard
layout(location = 5) in vec4 aExtra;   // depth
uniform vec2 uRes;
out vec2 vLocal;
out vec4 vPaint;
out vec4 vPush;
out vec4 vMore;
out vec4 vExtra;
out vec2 vAt;
void main() {
  float c = cos(aPlace.w), s = sin(aPlace.w);
  // a little room round the mark for its ragged edge
  vec2 l = aCorner * vec2(aMore.z, 1.0) * 1.25;
  vec2 p = aPlace.xy + aPlace.z * vec2(l.x * c - l.y * s, l.x * s + l.y * c);
  vLocal = aCorner * 1.25;
  vPaint = aPaint; vPush = aPush; vMore = aMore; vExtra = aExtra; vAt = p / uRes;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const FRAG_STAMP = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vPaint;
in vec4 vPush;
in vec4 vMore;
in vec4 vExtra;
in vec2 vAt;
uniform sampler2D uPaper;
layout(location = 0) out vec4 oWet;
layout(location = 1) out vec4 oFlow;
layout(location = 2) out vec4 oLight;
${COMMON}
void main() {
  float seed = vMore.x, kind = vMore.y, hard = vMore.w, load = vPush.w;
  vec2 p = vLocal;
  float ang = atan(p.y, p.x);
  // the outline is never a perfect circle: it wanders with the angle
  float wob = (vnoise(vec2(ang * 1.7 + seed * 9.1, seed)) - 0.5) * (kind > 0.5 ? 0.22 : 0.3)
            + (vnoise(vec2(ang * 5.0 + seed * 3.3, seed * 2.0)) - 0.5) * 0.12;
  float d = length(p) / (1.0 + wob);
  float soft = mix(0.75, 0.08, hard);
  float mask = 1.0 - smoothstep(1.0 - soft, 1.0, d);
  float paper = clamp((texture(uPaper, vec2(vAt.x, 1.0 - vAt.y)).r - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  float water = vPush.x;
  if (kind < 0.5) {
    // a brush: its hairs lie along the stroke, each carrying its own share of paint
    float across = p.y * 0.5 + 0.5;
    float hairs = vnoise(vec2(across * 46.0 + seed * 17.0, seed)) * 0.6 + vnoise(vec2(across * 13.0 + seed * 5.0, seed * 3.0)) * 0.4;
    // the paint lies in ridges, one to a hair, deeper the drier the paint (water lets them level)
    float fine = vnoise(vec2(across * 110.0 + seed * 29.0, seed * 5.0));
    float ridge = mix(0.8 + 0.4 * hairs, 0.25 + 1.1 * hairs + 0.5 * fine, clamp(1.0 - water * 4.0, 0.0, 1.0));
    // a brush running dry leaves only what its fullest hairs and the tops of the paper's grain take
    float need = (1.0 - load) * 1.15;
    float takes = smoothstep(need - 0.12, need + 0.12, hairs * 0.62 + paper * 0.5 + (water > 0.3 ? 0.25 : 0.0));
    mask *= ridge * mix(takes, 1.0, clamp(load * load, 0.0, 1.0));
  } else if (kind < 1.5) {
    // a drop: thicker at its rim, where the paint is left as it dries
    mask *= 0.85 + 0.35 * smoothstep(0.45, 0.95, d);
  } else if (kind < 2.5) {
    // a bloom: soft, and uneven as water is
    mask *= 0.6 + 0.6 * vnoise(p * 2.3 + seed * 7.0);
  } else {
    // a glaze of light: a fine strand, a little uneven along its length
    float across = p.y * 0.5 + 0.5;
    mask *= 0.55 + 0.45 * vnoise(vec2(across * 9.0 + seed * 3.0, p.x * 2.0 + seed));
  }
  if (mask <= 0.0005) discard;
  float glaze = step(2.5, kind);
  // a glaze is mostly light, with only a breath of pigment in it
  float a = vPaint.a * mask * mix(1.0, 0.3, glaze);
  float depth = vExtra.x;
  oWet = vec4(vPaint.rgb * a, a);
  oFlow = vec4(vPush.yz * mask, water * mask, depth * a);
  oLight = vec4(reflOf(vPaint.rgb) * vPaint.a * mask * 1.6 * glaze, 0.0);
}`;

const FRAG_SIM = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uWet;
uniform sampler2D uFlow;
uniform sampler2D uDry;
uniform sampler2D uPaper;
uniform sampler2D uLight;
uniform vec2 uRes;
uniform vec2 uShift;
uniform float uDt;
uniform float uTime;
uniform float uFlowK;
uniform float uBleed;
uniform float uDryK;
uniform float uGravity;
uniform float uStir;
uniform float uFade;
uniform vec3 uGround;
layout(location = 0) out vec4 oWet;
layout(location = 1) out vec4 oFlow;
layout(location = 2) out vec4 oDry;
layout(location = 3) out vec4 oLight;
${COMMON}
void main() {
  vec2 px = 1.0 / uRes;
  // the canvas drifting: everything is read from where it was (whole pixels, so nothing blurs);
  // what drifts in from beyond the edge is bare ground
  vec2 at = vUv + uShift;
  if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) {
    oWet = vec4(0.0); oFlow = vec4(0.0); oDry = vec4(uGround, 0.0); oLight = vec4(0.0);
    return;
  }
  vec4 f = texture(uFlow, at);
  vec4 fl = texture(uFlow, at - vec2(px.x, 0.0));
  vec4 fr = texture(uFlow, at + vec2(px.x, 0.0));
  vec4 fd = texture(uFlow, at - vec2(0.0, px.y));
  vec4 fu = texture(uFlow, at + vec2(0.0, px.y));
  vec4 wl = texture(uWet, at - vec2(px.x, 0.0));
  vec4 wr = texture(uWet, at + vec2(px.x, 0.0));
  vec4 wd = texture(uWet, at - vec2(0.0, px.y));
  vec4 wu = texture(uWet, at + vec2(0.0, px.y));
  // the paper does not drift with the paint
  float paper = texture(uPaper, vUv).r;

  // paint stands as high as its water and its pigment, and creeps downhill: from where it is deep
  // to where it is shallow
  float hl = fl.b + wl.a * 0.6, hr = fr.b + wr.a * 0.6, hd = fd.b + wd.a * 0.6, hu = fu.b + wu.a * 0.6;
  vec2 slope = vec2(hr - hl, hu - hd) * 0.5;
  float waterAvg = 0.25 * (fl.b + fr.b + fd.b + fu.b);
  float waterMax = max(max(fl.b, fr.b), max(fd.b, fu.b));
  // only wet paint moves. The edge of a wash holds (as water does on dry paper) unless the wash
  // beside it stands so deep that it spills over: that is a bloom, or the start of a drip
  float mob = max(smoothstep(0.015, 0.3, f.b), smoothstep(0.85, 1.25, waterMax));
  // the push a brush gave: shared with the neighbours, so a smear spreads, and soon spent
  vec2 v = mix(f.rg, 0.25 * (fl.rg + fr.rg + fd.rg + fu.rg), 0.35) * mob * exp(-5.0 * uDt);
  // the music stirs what is wet: a slow swirl that never repeats
  vec2 q = at * vec2(uRes.x / uRes.y, 1.0) * 3.1 + vec2(uTime * 0.07, -uTime * 0.05);
  float e = 0.02;
  float n0 = vnoise(q);
  vec2 curl = vec2(vnoise(q + vec2(0.0, e)) - n0, -(vnoise(q + vec2(e, 0.0)) - n0)) / e;
  vec2 u = v * 0.35 - uFlowK * 14.0 * slope + curl * uStir * 3.0 * min(f.b, 1.0);
  u.y -= uGravity * 55.0 * f.b * (0.4 + smoothstep(0.5, 1.2, f.b));
  u *= mob;
  float sp = length(u);
  if (sp > 420.0) u *= 420.0 / sp;

  // carried along
  vec2 from = at - u * uDt * px;
  vec4 wet = texture(uWet, from);
  vec4 ff = texture(uFlow, from);
  float water = ff.b;
  // how deep the wet paint lies goes with it (kept as depth times amount)
  float deep = ff.a;

  // wet into wet: pigment bleeds between points that are both wet
  vec4 wetAvg = 0.25 * (wl + wr + wd + wu);
  float both = min(water, waterAvg);
  float bleed = clamp(uBleed * 9.0 * uDt * smoothstep(0.05, 0.6, both), 0.0, 0.8);
  wet = mix(wet, wetAvg, bleed);
  deep = mix(deep, 0.25 * (fl.a + fr.a + fd.a + fu.a), bleed);
  // water evens out over what is wet (a dry point takes none, unless it is being spilled into),
  // never stands deeper than a puddle can, and dries off: fastest where it is thin, so from the edges in
  water = mix(water, waterAvg, clamp(4.0 * uDt * mob, 0.0, 0.5));
  water = min(water, 1.6);
  water = max(0.0, water - uDryK * uDt * (0.07 + 0.16 * (1.0 - smoothstep(0.0, 0.6, water))));

  // as it dries the pigment settles: slowly while there is water to hold it, at once when there is none,
  // and more of it in the hollows of the paper than on the ridges
  float rate = uDryK * max(0.1, 0.35 + 2.2 * (0.5 - paper)) / (0.02 + water * water * 6.0) + (water < 0.02 ? 14.0 : 0.0);
  float part = 1.0 - exp(-rate * uDt);
  vec4 set = wet * part;
  float deepSet = deep * part;
  wet -= set;
  deep -= deepSet;
  if (wet.a < 0.0004) { set += wet; deepSet += deep; wet = vec4(0.0); deep = 0.0; }

  vec4 dry = texture(uDry, at);
  vec4 light = texture(uLight, at);
  if (set.a > 0.00001) {
    float cover = 1.0 - exp(-3.2 * set.a);
    // paint that lies deeper than what has already set goes in under it, showing only where that is thin
    float d = clamp(deepSet / set.a, 0.0, 1.0);
    float under = smoothstep(0.03, 0.15, light.a - d) * (1.0 - exp(-2.5 * dry.a));
    cover *= 1.0 - 0.88 * under;
    dry.rgb = reflOf(mix(ksOf(dry.rgb), set.rgb / set.a, cover));
    light.a = d >= light.a ? mix(light.a, d, max(cover, 1.0 - smoothstep(0.0, 0.05, dry.a))) : light.a;
    dry.a += set.a;
  }
  // old paint sinks back into the ground; light fades a little slower than that, and slowly of itself
  float keep = exp(-uFade * uDt);
  dry.rgb = mix(uGround, dry.rgb, keep);
  dry.a *= keep;
  light.rgb *= exp(-(0.012 + uFade * 0.8) * uDt);

  oWet = max(wet, vec4(0.0));
  oFlow = vec4(v, water, max(deep, 0.0));
  oDry = dry;
  oLight = light;
}`;

const FRAG_SHOW = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uWet;
uniform sampler2D uFlow;
uniform sampler2D uDry;
uniform sampler2D uLight;
uniform vec2 uRes;
uniform float uRelief;
uniform float uFlip;
out vec4 oColor;
${COMMON}
float height(vec2 uv) { return log(1.0 + 2.0 * (texture(uDry, uv).a * 0.6 + texture(uWet, uv).a)) * 0.5; }
vec3 toScreen(vec3 v) { return mix(12.92 * v, 1.055 * pow(max(v, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), v)); }
void main() {
  vec2 uv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlip));
  vec2 px = 1.0 / uRes;
  vec4 dry = texture(uDry, uv);
  vec4 wet = texture(uWet, uv);
  vec4 fl = texture(uFlow, uv);
  vec4 light = texture(uLight, uv);
  float water = fl.b;
  vec3 col = dry.rgb;
  if (wet.a > 0.00001) {
    float cover = 1.0 - exp(-3.2 * wet.a);
    // wet paint that lies under the dry paint shows only where that is thin
    float under = smoothstep(0.03, 0.15, light.a - clamp(fl.a / wet.a, 0.0, 1.0)) * (1.0 - exp(-2.5 * dry.a));
    col = reflOf(mix(ksOf(col), wet.rgb / wet.a, cover * (1.0 - 0.88 * under)));
  }
  // light glazed on brightens what is under it, as light does
  col = 1.0 - (1.0 - col) * (1.0 - clamp(light.rgb, 0.0, 0.95));
  // lit from the upper left by the thickness of the paint
  float hx = height(uv + vec2(px.x, 0.0)) - height(uv - vec2(px.x, 0.0));
  float hy = height(uv + vec2(0.0, px.y)) - height(uv - vec2(0.0, px.y));
  vec3 n = normalize(vec3(-hx * 2.2 * uRelief, -hy * 2.2 * uRelief, 1.0));
  vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
  float lit = dot(n, light) / light.z;
  col *= mix(1.0, clamp(lit, 0.6, 1.4), 0.45);
  // wet paint is a shade deeper, and shines
  float sheen = smoothstep(0.05, 0.7, water);
  col *= 1.0 - 0.05 * sheen;
  vec3 hv = normalize(light + vec3(0.0, 0.0, 1.0));
  col += 0.07 * sheen * pow(max(dot(n, hv), 0.0), 60.0) * smoothstep(0.004, 0.03, abs(hx) + abs(hy));
  oColor = vec4(toScreen(clamp(col, 0.0, 1.0)), 1.0);
}`;

const FRAG_COPY = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 oColor;
void main() { oColor = texture(uSrc, vUv); }`;

/** How much of each cell of a coarse grid is painted: sixteen points looked at in each, counted where the paint stands out from the ground. */
const FRAG_MEASURE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uWet;
uniform sampler2D uDry;
uniform sampler2D uLight;
uniform vec2 uCells;
uniform vec3 uGround;
out vec4 oColor;
${COMMON}
void main() {
  vec2 cell = floor(vUv * uCells);
  float n = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    vec2 uv = (cell + (vec2(float(i), float(j)) + 0.5) / 4.0) / uCells;
    vec4 dry = texture(uDry, uv);
    vec4 wet = texture(uWet, uv);
    vec3 col = dry.rgb;
    if (wet.a > 0.00001) col = reflOf(mix(ksOf(col), wet.rgb / wet.a, 1.0 - exp(-3.2 * wet.a)));
    col = 1.0 - (1.0 - col) * (1.0 - clamp(texture(uLight, uv).rgb, 0.0, 0.95));
    vec3 d = abs(sqrt(max(col, 0.0)) - sqrt(uGround));
    n += step(0.045, max(d.r, max(d.g, d.b)));
  }
  oColor = vec4(n / 16.0, 0.0, 0.0, 1.0);
}`;

interface Target {
  tex: WebGLTexture;
}

export class Sim {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private w = 0;
  private h = 0;
  private wet: [Target, Target] | null = null;
  private flow: [Target, Target] | null = null;
  private dry: [Target, Target] | null = null;
  private light: [Target, Target] | null = null;
  private paper: WebGLTexture;
  private fboStamp: WebGLFramebuffer;
  private fboSim: WebGLFramebuffer;
  private fboOne: WebGLFramebuffer;
  private progStamp: WebGLProgram;
  private progSim: WebGLProgram;
  private progShow: WebGLProgram;
  private progCopy: WebGLProgram;
  private progMeasure: WebGLProgram;
  private measured: { tex: WebGLTexture; cols: number; rows: number; out: Uint8Array } | null = null;
  /** how far the canvas has drifted and not yet been moved (less than a pixel) */
  private driftAcc = { x: 0, y: 0 };
  /** how far it was moved at the last step (whole pixels) */
  moved = { x: 0, y: 0 };
  private quad: WebGLVertexArrayObject;
  private stampVao: WebGLVertexArrayObject;
  private stampBuf: WebGLBuffer;
  private data = new Float32Array(MAX_STAMPS * STRIDE);
  private count = 0;
  private ground: [number, number, number] = [1, 1, 1];
  private time = 0;
  private loc = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  settings: SimSettings = { ...SIM_DEFAULTS };
  /** how many marks have been put down since the canvas was last cleared */
  made = 0;

  /** Can this browser run the paint at all? */
  static supported(): boolean {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      return !!gl && !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("no webgl2");
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) throw new Error("no float targets");
    this.gl = gl;
    this.progStamp = this.program(VERT_STAMP, FRAG_STAMP);
    this.progSim = this.program(VERT_QUAD, FRAG_SIM);
    this.progShow = this.program(VERT_QUAD, FRAG_SHOW);
    this.progCopy = this.program(VERT_QUAD, FRAG_COPY);
    this.progMeasure = this.program(VERT_QUAD, FRAG_MEASURE);
    this.fboStamp = gl.createFramebuffer()!;
    this.fboSim = gl.createFramebuffer()!;
    this.fboOne = gl.createFramebuffer()!;

    // one square, used for everything that covers the whole canvas
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const p of [this.progSim, this.progShow, this.progCopy, this.progMeasure]) gl.bindAttribLocation(p, 0, "aPos");
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // and one square per mark, each with its own place, paint and push
    this.stampVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.stampVao);
    const cb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.stampBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stampBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < STRIDE / 4; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);

    this.paper = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.paper);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const make = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, vs === VERT_QUAD ? "aPos" : "aCorner");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    return p;
  }
  private u(p: WebGLProgram, name: string) {
    let m = this.loc.get(p);
    if (!m) this.loc.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }
  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex };
  }
  private bind(unit: number, tex: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
  }
  private fill(t: Target, r: number, g: number, b: number, a: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboOne);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** The size of the painting in real pixels. A painting already there is kept, stretched to fit. */
  size(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h && this.dry) return;
    const gl = this.gl;
    const oldDry = this.dry;
    const old = [this.wet, this.flow, this.dry, this.light];
    this.canvas.width = w;
    this.canvas.height = h;
    this.w = w;
    this.h = h;
    this.wet = [this.target(w, h), this.target(w, h)];
    this.flow = [this.target(w, h), this.target(w, h)];
    this.dry = [this.target(w, h), this.target(w, h)];
    this.light = [this.target(w, h), this.target(w, h)];
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    for (const t of [...this.wet, ...this.flow, ...this.light]) this.fill(t, 0, 0, 0, 0);
    for (const t of this.dry) this.fill(t, this.ground[0], this.ground[1], this.ground[2], 0);
    if (oldDry) {
      // the painting so far, at its new size (what was still wet is taken as dry)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboOne);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.dry[0].tex, 0);
      gl.useProgram(this.progCopy);
      this.bind(0, oldDry[0].tex);
      gl.uniform1i(this.u(this.progCopy, "uSrc"), 0);
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    for (const pair of old) if (pair) for (const t of pair) gl.deleteTexture(t.tex);
    this.show();
  }

  /** The colour of the canvas itself (a screen colour). The painting is not touched: clear it to see the new ground. */
  setGround(rgb: readonly [number, number, number]) {
    this.ground = [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])];
  }

  /** The grain of what is painted on: a grey picture, lighter where the surface stands higher. */
  setPaper(source: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.paper);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  clear() {
    if (!this.wet || !this.flow || !this.dry || !this.light) return;
    this.gl.disable(this.gl.BLEND);
    for (const t of [...this.wet, ...this.flow, ...this.light]) this.fill(t, 0, 0, 0, 0);
    for (const t of this.dry) this.fill(t, this.ground[0], this.ground[1], this.ground[2], 0);
    this.count = 0;
    this.made = 0;
    this.show();
  }

  /** Put a mark down (it reaches the canvas at the next step). */
  stamp(s: Stamp) {
    if (this.count >= MAX_STAMPS) return;
    const d = this.data;
    const o = this.count++ * STRIDE;
    d[o] = s.x;
    d[o + 1] = s.y;
    d[o + 2] = s.r;
    d[o + 3] = s.angle;
    d[o + 4] = s.k[0];
    d[o + 5] = s.k[1];
    d[o + 6] = s.k[2];
    d[o + 7] = s.paint;
    d[o + 8] = s.water;
    d[o + 9] = s.vx;
    d[o + 10] = -s.vy;
    d[o + 11] = s.load;
    d[o + 12] = s.seed;
    d[o + 13] = s.kind;
    d[o + 14] = s.stretch;
    d[o + 15] = s.hard;
    d[o + 16] = s.depth ?? 0.5;
    d[o + 17] = 0;
    d[o + 18] = 0;
    d[o + 19] = 0;
    this.made++;
  }
  /** How many marks are waiting for the next step. */
  get waiting() {
    return this.count;
  }

  /** Let `dt` seconds pass: the waiting marks land, the paint moves and dries, and the picture is shown. */
  step(dt: number, moving = true) {
    const gl = this.gl;
    if (!this.wet || !this.flow || !this.dry || !this.light) return;
    const [w, h] = [this.w, this.h];
    gl.viewport(0, 0, w, h);
    this.moved = { x: 0, y: 0 };
    if (this.count > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboStamp);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wet[0].tex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.flow[0].tex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.light[0].tex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.useProgram(this.progStamp);
      gl.uniform2f(this.u(this.progStamp, "uRes"), w, h);
      this.bind(0, this.paper);
      gl.uniform1i(this.u(this.progStamp, "uPaper"), 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.stampVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stampBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
      gl.disable(gl.BLEND);
      this.count = 0;
    }
    if (moving) {
      const d = Math.min(1 / 30, Math.max(1 / 240, dt));
      this.time += d;
      const s = this.settings;
      // the canvas drifts a whole pixel at a time (the rest is kept for the next step)
      this.driftAcc.x += s.driftX * dt;
      this.driftAcc.y += s.driftY * dt;
      const mx = Math.trunc(this.driftAcc.x);
      const my = Math.trunc(this.driftAcc.y);
      this.driftAcc.x -= mx;
      this.driftAcc.y -= my;
      this.moved = { x: mx, y: my };
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboSim);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wet[1].tex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.flow[1].tex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.dry[1].tex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, this.light[1].tex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
      const p = this.progSim;
      gl.useProgram(p);
      this.bind(0, this.wet[0].tex);
      this.bind(1, this.flow[0].tex);
      this.bind(2, this.dry[0].tex);
      this.bind(3, this.paper);
      this.bind(4, this.light[0].tex);
      gl.uniform1i(this.u(p, "uWet"), 0);
      gl.uniform1i(this.u(p, "uFlow"), 1);
      gl.uniform1i(this.u(p, "uDry"), 2);
      gl.uniform1i(this.u(p, "uPaper"), 3);
      gl.uniform1i(this.u(p, "uLight"), 4);
      // (moved left on the canvas = read from the right; the texture's rows run bottom to top)
      gl.uniform2f(this.u(p, "uShift"), -mx / w, my / h);
      gl.uniform2f(this.u(p, "uRes"), w, h);
      gl.uniform1f(this.u(p, "uDt"), d);
      gl.uniform1f(this.u(p, "uTime"), this.time);
      gl.uniform1f(this.u(p, "uFlowK"), s.flow);
      gl.uniform1f(this.u(p, "uBleed"), s.bleed);
      gl.uniform1f(this.u(p, "uDryK"), s.dry);
      gl.uniform1f(this.u(p, "uGravity"), s.gravity);
      gl.uniform1f(this.u(p, "uStir"), s.stir);
      gl.uniform1f(this.u(p, "uFade"), s.fade);
      gl.uniform3f(this.u(p, "uGround"), this.ground[0], this.ground[1], this.ground[2]);
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.wet.reverse();
      this.flow.reverse();
      this.dry.reverse();
      this.light.reverse();
    }
    this.show();
  }

  /** Draw the painting as it is now. */
  show() {
    const gl = this.gl;
    if (!this.wet || !this.flow || !this.dry || !this.light) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    const p = this.progShow;
    gl.useProgram(p);
    this.bind(0, this.wet[0].tex);
    this.bind(1, this.flow[0].tex);
    this.bind(2, this.dry[0].tex);
    this.bind(3, this.light[0].tex);
    gl.uniform1i(this.u(p, "uWet"), 0);
    gl.uniform1i(this.u(p, "uFlow"), 1);
    gl.uniform1i(this.u(p, "uDry"), 2);
    gl.uniform1i(this.u(p, "uLight"), 3);
    gl.uniform2f(this.u(p, "uRes"), this.w, this.h);
    gl.uniform1f(this.u(p, "uRelief"), this.settings.relief);
    gl.uniform1f(this.u(p, "uFlip"), 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * How much of the canvas is painted, cell by cell on a coarse grid (`cols` by `rows`, top row
   * first): for each cell, the part of it where the paint stands out from the ground.
   */
  measure(cols: number, rows: number): Float32Array {
    const gl = this.gl;
    const out = new Float32Array(cols * rows);
    if (!this.wet || !this.dry || !this.light) return out;
    let m = this.measured;
    if (!m || m.cols !== cols || m.rows !== rows) {
      if (m) gl.deleteTexture(m.tex);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      m = this.measured = { tex, cols, rows, out: new Uint8Array(cols * rows * 4) };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboOne);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, m.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, cols, rows);
    gl.disable(gl.BLEND);
    const p = this.progMeasure;
    gl.useProgram(p);
    this.bind(0, this.wet[0].tex);
    this.bind(1, this.dry[0].tex);
    this.bind(2, this.light[0].tex);
    gl.uniform1i(this.u(p, "uWet"), 0);
    gl.uniform1i(this.u(p, "uDry"), 1);
    gl.uniform1i(this.u(p, "uLight"), 2);
    gl.uniform2f(this.u(p, "uCells"), cols, rows);
    gl.uniform3f(this.u(p, "uGround"), this.ground[0], this.ground[1], this.ground[2]);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, m.out);
    gl.viewport(0, 0, this.w, this.h);
    // (the texture's rows run bottom to top)
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) out[(rows - 1 - y) * cols + x] = m.out[(y * cols + x) * 4] / 255;
    return out;
  }

  /** Is any paint still wet? (So the canvas can rest when everything has set.) */
  private idle = 0;
  settled(dt: number): boolean {
    // the paint is taken to have set a few seconds after the last mark, depending on how fast it dries
    if (this.count > 0) this.idle = 0;
    else this.idle += dt;
    return this.idle > 14 / Math.max(0.2, this.settings.dry);
  }
  touched() {
    this.idle = 0;
  }

  destroy() {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  }
}

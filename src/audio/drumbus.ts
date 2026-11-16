/**
 * The live half of the drum machine: a small mixing desk built from Web Audio nodes.
 *
 *   each drum ─ level ─ pan ─┬──────────────► grit ─┐
 *                            ├─ reverb send ─► room ─┤
 *                            └─ echo send ──► echo ──┤
 *                                                    ▼
 *                     tape wobble ─ tone ─ glue ─ volume ─ soft ceiling ─ out
 *
 * The sound of each hit is rendered by `renderDrum`; this file only plays and mixes it.
 */
import { ECHO_TIMES, STEP_VELOCITY, fxOf, soundOf, voiceOf, type Beat, type BeatFx } from "./beats";
import { audioContext, audioIfStarted } from "./context";
import { DRUM_IDS, SHAPE_KEYS, renderDrum, renderSpace, type DrumId, type DrumParams, type KitId } from "./drums";

interface Channel {
  input: GainNode;
  pan: StereoPannerNode;
  space: GainNode;
  echo: GainNode;
}

interface Bus {
  dry: GainNode;
  shaper: WaveShaperNode;
  verb: ConvolverNode;
  verbWet: GainNode;
  echo: DelayNode;
  echoFb: GainNode;
  echoWet: GainNode;
  wow: GainNode;
  flutter: GainNode;
  tape: DelayNode;
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  air: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  channels: Record<DrumId, Channel>;
}

interface Ringing {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Saturation, compression and a darker tone all make the kit louder as a side effect (measured
 * on the finished output). These take that back, so each knob changes the character, not the volume.
 */
const GLUE_DB = [0, -1.9, -4.6, -5.6, -4.6]; // at glue 0, ¼, ½, ¾, 1
function trim(fx: BeatFx): number {
  const g = Math.min(0.9999, Math.max(0, fx.glue)) * 4;
  const glue = GLUE_DB[Math.floor(g)] + (GLUE_DB[Math.floor(g) + 1] - GLUE_DB[Math.floor(g)]) * (g % 1);
  const db = glue - 4 * fx.grit + (fx.tone < 0 ? 3 * fx.tone : fx.tone);
  return Math.pow(10, db / 20);
}

/** Level going into the effects (it sets how hard grit and glue bite) and coming out of them (it sets the balance with the guitar). */
const IN = 0.44;
const OUT = 1.7;

let bus: Bus | null = null;
let applied: Partial<BeatFx> & { bpm?: number } = {};
const mixed = new Map<DrumId, string>();
const drumBuffers = new Map<string, AudioBuffer>();
const live = new Set<Ringing>();
let openHat: Ringing | null = null;
let solo: DrumId | null = null;
let sizeTimer: number | undefined;

/** Hear one drum on its own (null = all of them). Not saved with the beat. */
export function setDrumSolo(id: DrumId | null) {
  solo = id;
}

/** The level a typical drum arrives at; grit leaves a sound of this size as loud as it was. */
const GRIT_REF = 0.25;

/**
 * Saturation curve for the whole kit. More grit bends the curve harder, but a sound at the
 * usual level comes out just as loud: quiet hits are lifted, loud ones are flattened.
 */
export function driveCurve(grit: number): Float32Array<ArrayBuffer> {
  const k = 1 + grit * 11;
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = (Math.tanh(k * x) / Math.tanh(k * GRIT_REF)) * GRIT_REF;
  }
  return curve;
}

/** Straight up to 0.75, then bending over so nothing can leave louder than about 0.94. */
export function softCeiling(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.75 ? a : 0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25));
  }
  return curve;
}

function impulse(c: AudioContext, size: number): AudioBuffer {
  const sides = renderSpace(c.sampleRate, size);
  const buf = c.createBuffer(2, sides[0].length, c.sampleRate);
  sides.forEach((d, ch) => buf.getChannelData(ch).set(d));
  return buf;
}

function getBus(): Bus {
  const c = audioContext();
  if (bus) return bus;
  const dry = c.createGain();
  dry.gain.value = IN;
  const shaper = c.createWaveShaper();
  shaper.oversample = "2x";
  const mix = c.createGain();
  dry.connect(shaper).connect(mix);

  // reverb
  const verbIn = c.createGain();
  verbIn.gain.value = IN;
  const verb = c.createConvolver();
  verb.normalize = false; // the room is already scaled so that it returns exactly the energy it is sent
  const verbWet = c.createGain();
  verbIn.connect(verb).connect(verbWet).connect(mix);

  // echo: a delay feeding back through filters, so each repeat is duller and thinner, like tape
  const echoIn = c.createGain();
  echoIn.gain.value = IN;
  const echo = c.createDelay(2);
  const echoLp = c.createBiquadFilter();
  echoLp.type = "lowpass";
  echoLp.frequency.value = 3200;
  const echoHp = c.createBiquadFilter();
  echoHp.type = "highpass";
  echoHp.frequency.value = 250;
  const echoFb = c.createGain();
  const echoWet = c.createGain();
  const echoToVerb = c.createGain();
  echoToVerb.gain.value = 0.3;
  echoIn.connect(echo).connect(echoLp).connect(echoHp);
  echoHp.connect(echoFb).connect(echo);
  echoHp.connect(echoWet).connect(mix);
  echoWet.connect(echoToVerb).connect(verbIn);

  // tape: a very short delay whose length drifts (slow "wow") and shivers (fast "flutter")
  const tape = c.createDelay(0.05);
  tape.delayTime.value = 0;
  const lfo = (freq: number) => {
    const osc = c.createOscillator();
    osc.frequency.value = freq;
    const depth = c.createGain();
    depth.gain.value = 0;
    osc.connect(depth).connect(tape.delayTime);
    osc.start();
    return depth;
  };
  const wow = lfo(0.55);
  const flutter = lfo(6.3);

  const low = c.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 220;
  const high = c.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 3800;
  const air = c.createBiquadFilter();
  air.type = "lowpass";
  air.Q.value = 0.5;
  const comp = c.createDynamicsCompressor();
  comp.knee.value = 12;
  comp.release.value = 0.14;
  const makeup = c.createGain();
  // a soft ceiling instead of a second compressor: it adds no delay, so drums stay locked to the guitar
  const limiter = c.createWaveShaper();
  limiter.curve = softCeiling();
  limiter.oversample = "2x";
  mix.connect(tape).connect(low).connect(high).connect(air).connect(comp).connect(makeup).connect(limiter).connect(c.destination);

  const channels = {} as Record<DrumId, Channel>;
  for (const id of DRUM_IDS) {
    const input = c.createGain();
    const pan = c.createStereoPanner();
    const space = c.createGain();
    const send = c.createGain();
    input.connect(pan);
    pan.connect(dry);
    pan.connect(space).connect(verbIn);
    pan.connect(send).connect(echoIn);
    channels[id] = { input, pan, space, echo: send };
  }
  bus = { dry, shaper, verb, verbWet, echo, echoFb, echoWet, wow, flutter, tape, low, high, air, comp, makeup, channels };
  applied = {};
  mixed.clear();
  return bus;
}

/** Set the effects for the whole kit. Only what changed is touched, so it is cheap to call often. */
export function setDrumFx(settings: Partial<BeatFx>, bpm = 100) {
  const b = getBus();
  const c = audioContext();
  const t = c.currentTime;
  const fx = fxOf(settings);
  const was = applied;
  const to = (param: AudioParam, value: number, tc = 0.03) => param.setTargetAtTime(value, t, tc);
  if (fx.space !== was.space) to(b.verbWet.gain, Math.pow(fx.space, 1.2) * 2.2);
  if (fx.size !== was.size) {
    // building a room takes a moment: wait until the knob stops moving
    window.clearTimeout(sizeTimer);
    if (!b.verb.buffer) b.verb.buffer = impulse(c, fx.size);
    else sizeTimer = window.setTimeout(() => (b.verb.buffer = impulse(c, fx.size)), 140);
  }
  if (fx.echo !== was.echo) {
    to(b.echoWet.gain, fx.echo * 1.8);
    to(b.echoFb.gain, fx.echo > 0 ? 0.25 + 0.4 * fx.echo : 0);
  }
  if (fx.echoTime !== was.echoTime || bpm !== was.bpm) {
    const beats = ECHO_TIMES.find((e) => e.id === fx.echoTime)?.beats ?? 0.75;
    to(b.echo.delayTime, Math.min(1.9, (beats * 60) / bpm), 0.05);
  }
  if (fx.grit !== was.grit) b.shaper.curve = driveCurve(fx.grit);
  if (fx.tape !== was.tape) {
    // at full, the pitch drifts by about a quarter of a semitone and shivers a little on top
    const depth = fx.tape * fx.tape * 0.004;
    to(b.tape.delayTime, depth + fx.tape * 0.0001, 0.05);
    to(b.wow.gain, depth, 0.05);
    to(b.flutter.gain, fx.tape * 0.0001, 0.05);
  }
  if (fx.tape !== was.tape || fx.grit !== was.grit) to(b.air.frequency, 18000 * (1 - 0.5 * fx.grit) * (1 - 0.6 * fx.tape));
  if (fx.tone !== was.tone) {
    to(b.low.gain, -fx.tone * 5);
    to(b.high.gain, fx.tone * 9);
  }
  if (fx.glue !== was.glue) {
    to(b.comp.threshold, -6 - fx.glue * 26);
    to(b.comp.ratio, 1.5 + fx.glue * 6.5);
    to(b.comp.attack, 0.02 - fx.glue * 0.012);
  }
  if (fx.level !== was.level || fx.glue !== was.glue || fx.tone !== was.tone || fx.grit !== was.grit) to(b.makeup.gain, (fx.level / 0.8) * OUT * trim(fx), 0.02);
  applied = { ...fx, bpm };
}

/** Bring the desk in line with a beat: effects, and each drum's level, pan and sends. */
export function syncDrums(beat: Beat, bpm: number) {
  setDrumFx(beat, bpm);
  const b = getBus();
  const t = audioContext().currentTime;
  for (const id of DRUM_IDS) {
    const p = soundOf(beat, id);
    const key = `${p.level}|${p.pan}|${p.space}|${p.echo}`;
    if (mixed.get(id) === key) continue;
    mixed.set(id, key);
    const ch = b.channels[id];
    ch.input.gain.setTargetAtTime(p.level / 0.8, t, 0.015);
    ch.pan.pan.setTargetAtTime(p.pan, t, 0.015);
    ch.space.gain.setTargetAtTime(p.space, t, 0.015);
    ch.echo.gain.setTargetAtTime(p.echo, t, 0.015);
  }
}

function drumBuffer(c: AudioContext, kit: KitId, id: DrumId, p: DrumParams): AudioBuffer {
  const key = `${kit}|${id}|${SHAPE_KEYS.map((k) => p[k].toFixed(2)).join("|")}`;
  let buf = drumBuffers.get(key);
  if (!buf) {
    const data = renderDrum(c.sampleRate, kit, id, p);
    buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.getChannelData(0).set(data);
    if (drumBuffers.size > 200) drumBuffers.clear();
    drumBuffers.set(key, buf);
  }
  return buf;
}

function damp(r: Ringing, at: number) {
  try {
    r.gain.gain.cancelScheduledValues(at);
    r.gain.gain.setTargetAtTime(0, at, 0.025);
    r.src.stop(at + 0.2);
  } catch {
    /* already stopped */
  }
}

/**
 * Play one hit of a beat's drum. Softer hits are also a little duller, as on a real drum, and
 * a closed or open hat cuts off a ringing open hat. `human` adds small differences between hits.
 */
export function playDrum(beat: Beat, id: DrumId, when?: number, velocity = 0.8, human = 0) {
  const c = audioContext();
  const b = getBus();
  const t = when ?? c.currentTime + 0.01;
  const src = c.createBufferSource();
  src.buffer = drumBuffer(c, voiceOf(beat, id), id, soundOf(beat, id));
  if (human) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.014 * human;
  const g = c.createGain();
  g.gain.value = velocity * velocity * 1.1;
  let tail: AudioNode = src.connect(g);
  if (velocity < 0.7 && id !== "kick") {
    const soft = c.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 5000 + 30000 * velocity * velocity;
    soft.Q.value = 0.5;
    tail = g.connect(soft);
  }
  tail.connect(b.channels[id].input);
  const r: Ringing = { src, gain: g };
  if (id === "hat" || id === "open") {
    if (openHat) damp(openHat, t);
    openHat = id === "open" ? r : null;
  }
  live.add(r);
  src.onended = () => live.delete(r);
  src.start(t);
}

/** Play one step of the grid for a drum, respecting mute, solo and the "human" setting. */
export function playStep(beat: Beat, id: DrumId, level: number, when: number) {
  if (solo ? solo !== id : beat.mutes?.includes(id)) return;
  const human = beat.human ?? 0;
  if (!human) return playDrum(beat, id, when, STEP_VELOCITY[level]);
  // a player is never exactly on the grid, and never hits twice the same; the kick stays tightest
  const late = (Math.random() - 0.35) * 0.02 * human * (id === "kick" ? 0.35 : 1);
  const touch = 1 + (Math.random() - 0.5) * 0.3 * human;
  playDrum(beat, id, when + Math.max(0, late), Math.min(1, STEP_VELOCITY[level] * touch), human);
}

/** Render a beat's sounds ahead of time so the first bar plays without a hiccup. */
export function prepareBeat(beat: Beat) {
  const c = audioContext();
  for (const id of DRUM_IDS) if (/[123]/.test(beat.rows[id] ?? "")) drumBuffer(c, voiceOf(beat, id), id, soundOf(beat, id));
}

export function stopDrums() {
  const c = audioIfStarted();
  if (!c) return;
  for (const r of live) damp(r, c.currentTime);
  live.clear();
  openHat = null;
}

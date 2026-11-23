/**
 * The live half of the drum machine: a small mixing desk built from Web Audio nodes.
 *
 *   each drum ─ level ─ pan ─┬────────► saturation ─┐
 *                            ├─ reverb send ─► room ─┤
 *                            └─ echo send ──► echo ──┤
 *                                                    ▼
 *                    noise bed ─────────────────────────┤
 *                     tape wobble ─ tone ─ glue ─ volume ─ soft ceiling ─ out
 *
 * Every sound is rendered in three slightly different takes that are played in turn
 * (round robin), so repeated hits never sound machine-gunned.
 *
 * Every drums track has a desk of its own (its own effects, noise bed, hat choke, pump and drum
 * solo), going out through its own fader: Drums 2 drenched in reverb leaves Drums 1 dry, and
 * soloing or muting one never touches the other. The first drums track's desk is "drums".
 *
 * A desk that is making no sound rests: a while after its last hit has rung out (its room and its
 * echoes too) it is let go of its fader, so the audio thread works none of it out; its next hit puts
 * it back first. A desk still ringing only with an echo's last repeats would otherwise keep its
 * whole chain, room and all, running for good: an echo that feeds itself never quite reaches
 * silence. And its room is only fed while the Reverb is up (see gate.ts): a room is the costliest
 * thing a desk has. An offline render keeps everything it uses connected from start to end.
 *
 * The sound of each hit is rendered by `renderDrum`; this file only plays and mixes it.
 */
import { ECHO_TIMES, STEP_VELOCITY, fxOf, soundOf, voiceOf, type Beat, type BeatFx, type NoiseBed, type VerbId } from "./beats";
import { atRenderTime, audioContext, audioIfStarted, isRendering, loopLag, soonest } from "./context";
import { gate, type Gate } from "./gate";
import { lateCount, pastEnd, startRecorded } from "./late";
import { listening, pulse } from "./pulse";
import { describe, type Sound } from "./describe";
import { tapStem, untapStem } from "./stems";
import { fader, levelOf } from "./mix";

/** A drum sound, measured (once for each recording). */
const measured = new WeakMap<AudioBuffer, Sound>();
function measure(buf: AudioBuffer): Sound {
  let s = measured.get(buf);
  if (!s) {
    s = describe(buf.getChannelData(0), buf.sampleRate);
    measured.set(buf, s);
  }
  return s;
}
import { createSaturator, type SatType, type Saturator } from "./saturation";
import { DRUM_IDS, SHAPE_KEYS, VARIANTS, drumRng, renderDrum, renderNoiseBed, renderSpace, type DrumId, type DrumParams, type SamplerId, type VoiceId } from "./drums";

interface Channel {
  input: GainNode;
  pan: StereoPannerNode;
  space: GainNode;
  echo: GainNode;
}

interface Bus {
  dry: GainNode;
  sat: Saturator;
  /** two rooms: the one fed now, and the one a new size or kind is loaded into (see swapRoom); each fed through a gain of its own, and heard through another */
  verbs: [ConvolverNode, ConvolverNode];
  verbIns: [GainNode, GainNode];
  verbOuts: [GainNode, GainNode];
  verbIn: GainNode;
  verbWet: GainNode;
  echo: DelayNode;
  echoFb: GainNode;
  echoWet: GainNode;
  wow: GainNode;
  flutter: GainNode;
  tape: DelayNode;
  /** the echo's way in (and round, and on to the room), let go while Echo is at 0 (see gate.ts) */
  echoFeed: Gate;
  /** the room's way in (every drum's send, and the echo's), let go while Reverb is at 0: nothing of the room is heard then */
  roomFeed: Gate;
  /** the tape's wobble, let go while Tape is at 0 */
  tapeFeed: Gate;
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  air: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  bed: GainNode;
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
/** per colour of saturation, at 0, ¼, ½, ¾ and 1 */
export const SAT_DB: Record<SatType, number[]> = { tape: [0, -0.3, -0.5, -1.4, -2.9], tube: [0, -0.1, 0, 0, -1.6], console: [0, 0, 0.8, 2.1, 1.9], crunch: [0, 0.2, 0.2, -0.1, -1.3], fuzz: [0, 0.4, -1.1, -3.3, -4.9], clip: [0, 0.5, -0.1, -1.8, -3.2] };
const quarter = (t: number[], x: number) => {
  const g = Math.min(0.9999, Math.max(0, x)) * 4;
  return t[Math.floor(g)] + (t[Math.floor(g) + 1] - t[Math.floor(g)]) * (g % 1);
};
function trim(fx: BeatFx): number {
  const db = quarter(GLUE_DB, fx.glue) + (fx.tone < 0 ? 3 * fx.tone : fx.tone);
  return Math.pow(10, db / 20);
}

/** Level going into the effects (it sets how hard grit and glue bite) and coming out of them (it sets the balance with the guitar). */
const IN = 0.44;
const OUT = 1.7;

/** The first drums track (its desk is the one the canvas listens to by name). */
export const FIRST_DRUMS = "drums";

/**
 * One desk per drums track and audio context: the one you hear, and one made for each offline
 * render of the song. Everything that belongs to one track's sound lives on its desk.
 */
interface Desk {
  bus: Bus;
  /** after the soft ceiling: fades out a removed track without a click */
  tail: GainNode;
  /** the tape's wobble oscillators, stopped when the desk goes */
  lfos: OscillatorNode[];
  applied: Partial<BeatFx> & { bpm?: number };
  mixed: Map<DrumId, string>;
  openHat: Ringing | null;
  /** how much the other tracks duck under its kick: as set now, and from when (a section's own kit starts where the section does) */
  pump: number;
  pumps: { at: number; pump: number }[];
  sizeTimer?: number;
  /** its saturation's change, waiting for the moment its section starts (live) */
  satTimer?: number;
  /** which of the two rooms is fed, and until when each rings on with what it was fed (it may be loaded again after that) */
  verbOn: 0 | 1;
  verbRings: [number, number];
  bedSrc: AudioBufferSourceNode | null;
  /** the playing bed's own level, faded out when it stops */
  bedFade: GainNode | null;
  bedType: NoiseBed;
  bedOn: boolean;
  /** the track's fader: where the desk's sound goes */
  out: AudioNode;
  /** live: silent, and let go of its fader until its next sound (see `sounding`) */
  resting: boolean;
  /** when everything booked on it so far has died away, its room and its echoes too (seconds on the audio clock) */
  quietAt: number;
  restTimer?: ReturnType<typeof setTimeout>;
  /** its track is gone: it is never put back on its fader */
  gone?: boolean;
}
const desks = new WeakMap<BaseAudioContext, Map<string, Desk>>();
const deskOf = (track = FIRST_DRUMS): Desk => {
  getBus(track);
  return desks.get(audioContext())!.get(track)!;
};
const drumBuffers = new Map<string, AudioBuffer>();
const live = new Set<Ringing>();
/** each track's drum heard on its own (none = all of them): set on the Drums page, never saved */
const solos = new Map<string, DrumId>();

/** Hear one drum of a track on its own (null = all of them). Not saved with the beat. */
export function setDrumSolo(id: DrumId | null, track = FIRST_DRUMS) {
  if (id) solos.set(track, id);
  else solos.delete(track);
}

/** The level a typical drum arrives at: what the saturation is told to expect. */
const GRIT_REF = 0.25;

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

function impulse(c: AudioContext, size: number, type: VerbId): AudioBuffer {
  const sides = renderSpace(c.sampleRate, size, drumRng(7), type);
  const buf = c.createBuffer(2, sides[0].length, c.sampleRate);
  sides.forEach((d, ch) => buf.getChannelData(ch).set(d));
  return buf;
}

// ── a desk at rest ──
/** (an offline render never rests: every render of a song is the same) */
const isLive = (c: BaseAudioContext) => !("startRendering" in c);
/** How far under a hit an echo's repeat must be before the desk may rest (dB). */
const ECHO_GONE_DB = 100;
/** Added on top of what a desk's effects ring for (seconds): its compressor has let go, the short delays of its saturation and tape have passed. */
const DESK_REST = 0.5;

/**
 * How long a desk goes on sounding after a sound that went into it has ended (seconds): its
 * room's whole echo (its Reverb may be at 0 now and up a moment later), and with Echo on, the
 * repeats until they are far under hearing (each one quieter than the last by what the Echo knob
 * feeds back; the filters round the loop only make them quieter still), each with the room after it.
 */
export function deskTail(fx: Partial<BeatFx> & { bpm?: number }, roomSeconds: number, echoFed = false): number {
  const echo = fx.echo ?? 0;
  const beats = ECHO_TIMES.find((e) => e.id === (fx.echoTime ?? "1/8."))?.beats ?? 0.75;
  const gap = Math.min(1.9, (beats * 60) / (fx.bpm ?? 100));
  // (an echo just turned to 0 still holds one pass of what was in it)
  const repeats = echo > 0 ? Math.ceil(ECHO_GONE_DB / (-20 * Math.log10(0.25 + 0.4 * echo))) : echoFed ? 1 : 0;
  return repeats * gap + roomSeconds + DESK_REST;
}
const tailOf = (d: Desk) => deskTail(d.applied, Math.max(0, ...d.bus.verbs.map((v) => v.buffer?.duration ?? 0)), d.bus.echoFeed.open);

/**
 * Live: a sound is booked on a desk and is over at `end` (seconds on the audio clock). A desk at
 * rest is put back on its fader first (it was silent, so nothing is heard of that), and it rests
 * again once everything booked on it has died away. Its noise bed, while it runs, keeps it awake.
 */
function sounding(d: Desk, c: BaseAudioContext, end: number) {
  if (!isLive(c) || d.gone) return;
  if (d.resting) {
    d.resting = false;
    d.tail.connect(d.out);
  }
  d.quietAt = Math.max(d.quietAt, end + tailOf(d));
  if (d.restTimer !== undefined) return;
  const wait = () => {
    d.restTimer = setTimeout(
      () => {
        d.restTimer = undefined;
        // (its noise bed runs on: the bed's own stop looks again)
        if (d.gone || d.resting || d.bedSrc) return;
        // more was booked meanwhile: it waits for that to be over too
        if (c.currentTime < d.quietAt) return wait();
        d.resting = true;
        d.tail.disconnect();
      },
      Math.max(0, d.quietAt - c.currentTime) * 1000 + 20,
    );
  };
  wait();
}

/** Is a track's desk at rest (let go of its fader until its next sound)? For the tests. */
export const deskResting = (track = FIRST_DRUMS): boolean => !!desks.get(audioContext())?.get(track)?.resting;

function getBus(track = FIRST_DRUMS): Bus {
  const c = audioContext();
  let set = desks.get(c);
  if (!set) desks.set(c, (set = new Map()));
  const had = set.get(track);
  if (had) return had.bus;
  const dry = c.createGain();
  dry.gain.value = IN;
  const sat = createSaturator(c, GRIT_REF);
  const mix = c.createGain();
  dry.connect(sat.input);
  sat.output.connect(mix);

  // reverb
  const verbIn = c.createGain();
  verbIn.gain.value = IN;
  const verbWet = c.createGain();
  const room = () => {
    const v = c.createConvolver();
    v.normalize = false; // the room is already scaled so that it returns exactly the energy it is sent
    return v;
  };
  const verbs: [ConvolverNode, ConvolverNode] = [room(), room()];
  const verbIns: [GainNode, GainNode] = [c.createGain(), c.createGain()];
  const verbOuts: [GainNode, GainNode] = [c.createGain(), c.createGain()];
  verbs.forEach((v, i) => verbIns[i].connect(v).connect(verbOuts[i]).connect(verbWet));
  // (only the room fed is connected: the other costs nothing until a new one is loaded into it)
  verbIn.connect(verbIns[0]);
  verbWet.connect(mix);

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
  echo.connect(echoLp).connect(echoHp);
  echoHp.connect(echoFb);
  echoHp.connect(echoWet).connect(mix);
  // The loop comes round a block later than its delay says (see context.ts loopLag). In blocks longer than 128 frames
  // the delay is made that much shorter, so the repeats stay as far apart as they always were, and what goes in for the
  // first time waits that much on its way in, so the first repeat stays where it was too.
  const lag = loopLag(c);
  let echoWay: AudioNode = echo;
  if (lag > 0) {
    const wait = c.createDelay(0.1);
    wait.delayTime.value = lag;
    wait.connect(echo);
    echoWay = wait;
  }
  // (at 0 the echo rests once its repeats have died away, and so does the room it fed)
  const echoFeed = gate(c, [[echoIn, echoWay], [echoFb, echo], [echoWet, echoToVerb]], 2.2);

  // tape: a very short delay whose length drifts (slow "wow") and shivers (fast "flutter")
  const tape = c.createDelay(0.05);
  tape.delayTime.value = 0;
  const lfos: OscillatorNode[] = [];
  const lfo = (freq: number) => {
    const osc = c.createOscillator();
    lfos.push(osc);
    osc.frequency.value = freq;
    const depth = c.createGain();
    depth.gain.value = 0;
    osc.connect(depth);
    osc.start();
    return depth;
  };
  const wow = lfo(0.55);
  const flutter = lfo(6.3);
  // (at 0 the tape's length is left steady, which the browser works out far more cheaply)
  const tapeFeed = gate(c, [[wow, tape.delayTime], [flutter, tape.delayTime]], 0.5);

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
  const bed = c.createGain();
  bed.gain.value = 0;
  bed.connect(mix);
  // each track goes out through its own fader (volume, mute and solo for the whole song)
  const out = fader(track, c);
  const tail = c.createGain();
  mix.connect(tape).connect(low).connect(high).connect(air).connect(comp).connect(makeup).connect(limiter).connect(tail).connect(out);
  // the canvas hears every drums track here, after everything that is done to it (the fader too);
  // only the live desk: a render's desk would take the track's tap away from the one that is heard
  if (!isRendering()) tapStem("drums", out, track);

  const channels = {} as Record<DrumId, Channel>;
  const roomEdges: [AudioNode, AudioNode][] = [[echoToVerb, verbIn]];
  for (const id of DRUM_IDS) {
    const input = c.createGain();
    const pan = c.createStereoPanner();
    const space = c.createGain();
    const send = c.createGain();
    input.connect(pan);
    pan.connect(dry);
    pan.connect(space);
    roomEdges.push([space, verbIn]);
    pan.connect(send).connect(echoIn);
    channels[id] = { input, pan, space, echo: send };
  }
  // (with Reverb at 0 nothing of the room is heard: it is not fed, and once it has rung out it costs nothing.
  // Let go only after the knob has glided down to nothing, τ 30 ms; fed again before it glides back up)
  const roomFeed = gate(c, roomEdges, 0.3);
  const bus: Bus = { dry, sat, verbs, verbIns, verbOuts, verbIn, verbWet, echo, echoFb, echoWet, wow, flutter, tape, echoFeed, roomFeed, tapeFeed, low, high, air, comp, makeup, bed, channels };
  const desk: Desk = { bus, tail, lfos, applied: {}, mixed: new Map(), openHat: null, pump: 0, pumps: [], bedSrc: null, bedFade: null, bedType: "off", bedOn: false, verbOn: 0, verbRings: [0, 0], out, resting: false, quietAt: 0 };
  set.set(track, desk);
  // (a desk made and not played rests after a moment)
  sounding(desk, c, c.currentTime);
  return bus;
}

/**
 * Let go of the desks of drums tracks that are no longer in the song (live only). Each fades out
 * over a few hundredths of a second first, so a track removed while it plays does not click.
 */
export function keepDrums(tracks: string[]) {
  const c = audioIfStarted();
  const set = c && desks.get(c);
  if (!c || !set) return;
  for (const [track, d] of set) {
    if (track === FIRST_DRUMS || tracks.includes(track)) continue;
    set.delete(track);
    solos.delete(track);
    untapStem(track);
    stopBed(d);
    // (nothing puts it back on its fader any more)
    clearTimeout(d.restTimer);
    d.gone = true;
    d.tail.gain.setTargetAtTime(0, c.currentTime, 0.015);
    window.setTimeout(() => {
      for (const o of d.lfos) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
        o.disconnect();
      }
      d.tail.disconnect();
    }, 150);
  }
}

/**
 * Set the effects for a track's whole kit: now, or from `at` (seconds on the audio clock) where a
 * song section with a drum sound of its own starts. Only what changed is touched, so it is cheap
 * to call often.
 */
export function setDrumFx(settings: Partial<BeatFx>, bpm = 100, track = FIRST_DRUMS, at?: number) {
  const b = getBus(track);
  const c = audioContext();
  const t = Math.max(at ?? 0, c.currentTime);
  const later = t - c.currentTime;
  const fx = fxOf(settings);
  const desk = deskOf(track);
  const was = desk.applied;
  const rang = tailOf(desk);
  // (a change booked for later that never came, because playing stopped or jumped, is let go)
  // A new desk (a render makes its own) starts on these settings: its first hit must not glide in from the defaults
  const fresh = was.bpm === undefined;
  const to = (param: AudioParam, value: number, tc = 0.03) => (fresh ? (param.value = value) : param.cancelScheduledValues(t).setTargetAtTime(value, t, tc));
  if (fx.space !== was.space) {
    if (fx.space > 0) b.roomFeed.on();
    else b.roomFeed.off(t);
    to(b.verbWet.gain, Math.pow(fx.space, 1.2) * 2.2);
  }
  if (fx.size !== was.size || fx.verb !== was.verb) {
    // building a room takes a moment: wait until the knob stops moving (a section's own room: until its moment)
    window.clearTimeout(desk.sizeTimer);
    const room = () => swapRoom(c, desk, impulse(c, fx.size, fx.verb));
    if (!b.verbs[desk.verbOn].buffer) room();
    else if (isRendering()) {
      // in a render the room changes exactly where the section starts (see atRenderTime)
      if (later <= 0.001) room();
      else atRenderTime(c, t, room);
    } else desk.sizeTimer = window.setTimeout(room, later > 0.001 ? later * 1000 : 140);
  }
  if (fx.noise !== was.noise || fx.noiseAmt !== was.noiseAmt) {
    // −66 dB at the bottom of the knob, about −30 dB at the top
    to(b.bed.gain, fx.noise === "off" ? 0 : Math.pow(10, (-66 + 36 * fx.noiseAmt) / 20) * BED_LEVEL[fx.noise], 0.05);
    if (fx.noise !== was.noise && desk.bedOn) startBed(desk, fx.noise, t);
  }
  // the pump a kick gives is the one set where that kick is (an earlier section's last kicks keep theirs)
  desk.pump = fx.pump;
  desk.pumps = [...desk.pumps.filter((x) => x.at < t && x.at > c.currentTime - 2), { at: t, pump: fx.pump }];
  if (fx.echo !== was.echo) {
    if (fx.echo > 0) b.echoFeed.on();
    else b.echoFeed.off(t);
    to(b.echoWet.gain, fx.echo * 1.8);
    to(b.echoFb.gain, fx.echo > 0 ? 0.25 + 0.4 * fx.echo : 0);
  }
  if (fx.echoTime !== was.echoTime || bpm !== was.bpm) {
    const beats = ECHO_TIMES.find((e) => e.id === fx.echoTime)?.beats ?? 0.75;
    to(b.echo.delayTime, Math.min(1.9, (beats * 60) / bpm) - loopLag(c), 0.05);
  }
  if (fx.grit !== was.grit || fx.color !== was.color || fx.blend !== was.blend) {
    // (its curve cannot be booked ahead: it changes exactly where the section starts, as the room does)
    const sat = () => b.sat.set(fx.color, fx.grit, fx.blend, quarter(SAT_DB[fx.color], fx.grit));
    window.clearTimeout(desk.satTimer);
    if (later <= 0.001) sat();
    else if (isRendering()) {
      if (!atRenderTime(c, t, sat)) sat();
    } else desk.satTimer = window.setTimeout(sat, later * 1000);
  }
  if (fx.tape !== was.tape) {
    if (fx.tape > 0) b.tapeFeed.on();
    else b.tapeFeed.off(t);
    // at full, the pitch drifts by about a quarter of a semitone and shivers a little on top
    const depth = fx.tape * fx.tape * 0.004;
    to(b.tape.delayTime, depth + fx.tape * 0.0001, 0.05);
    to(b.wow.gain, depth, 0.05);
    to(b.flutter.gain, fx.tape * 0.0001, 0.05);
  }
  if (fx.tape !== was.tape) to(b.air.frequency, 18000 * (1 - 0.6 * fx.tape));
  if (fx.tone !== was.tone) {
    to(b.low.gain, -fx.tone * 5);
    to(b.high.gain, fx.tone * 9);
  }
  if (fx.glue !== was.glue) {
    to(b.comp.threshold, -6 - fx.glue * 26);
    to(b.comp.ratio, 1.5 + fx.glue * 6.5);
    to(b.comp.attack, 0.02 - fx.glue * 0.012);
  }
  if (fx.level !== was.level || fx.glue !== was.glue || fx.tone !== was.tone) to(b.makeup.gain, (fx.level / 0.8) * OUT * trim(fx), 0.02);
  desk.applied = { ...fx, bpm };
  // (what is sounding now rings for as long as the desk's effects now say: a longer echo is waited for)
  if (!desk.resting && tailOf(desk) > rang) sounding(desk, c, t);
}

/** Bring a track's desk in line with a beat (now, or from `at`): effects, and each drum's level, pan and sends. */
export function syncDrums(beat: Beat, bpm: number, track = FIRST_DRUMS, at?: number) {
  setDrumFx(beat, bpm, track, at);
  const b = getBus(track);
  const t = Math.max(at ?? 0, audioContext().currentTime);
  const mixed = deskOf(track).mixed;
  for (const id of DRUM_IDS) {
    const p = soundOf(beat, id);
    const key = `${p.level}|${p.pan}|${p.space}|${p.echo}`;
    if (mixed.get(id) === key) continue;
    // (a new desk's drums start where they are set, as its effects do)
    const to = mixed.has(id) ? (param: AudioParam, v: number) => param.cancelScheduledValues(t).setTargetAtTime(v, t, 0.015) : (param: AudioParam, v: number) => (param.value = v);
    mixed.set(id, key);
    const ch = b.channels[id];
    to(ch.input.gain, p.level / 0.8);
    to(ch.pan.pan, p.pan);
    to(ch.space.gain, p.space);
    to(ch.echo.gain, p.echo);
  }
}

const keyOf = (voice: VoiceId, id: DrumId, p: DrumParams, sampler: SamplerId, variant: number) =>
  `${voice}|${id}|${SHAPE_KEYS.map((k) => p[k].toFixed(2)).join("|")}|${sampler}|${variant}`;

function drumBuffer(c: AudioContext, voice: VoiceId, id: DrumId, p: DrumParams, sampler: SamplerId, variant = 0): AudioBuffer {
  const key = keyOf(voice, id, p, sampler, variant);
  let buf = drumBuffers.get(key);
  if (!buf) {
    const data = renderDrum(c.sampleRate, voice, id, p, { variant, sampler });
    buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.getChannelData(0).set(data);
    if (drumBuffers.size > 400) drumBuffers.clear();
    drumBuffers.set(key, buf);
  }
  return buf;
}

/** The other takes are rendered a little later, a few at a time, so playback never waits for them. */
const later: (() => void)[] = [];
let laterTimer: number | undefined;
function renderLater(job: () => void) {
  later.push(job);
  if (laterTimer !== undefined) return;
  const run = () => {
    const until = performance.now() + 12;
    while (later.length && performance.now() < until) later.shift()!();
    laterTimer = later.length ? window.setTimeout(run, 30) : undefined;
  };
  laterTimer = window.setTimeout(run, 60);
}

/** Pick the next take of a sound: never the same one twice in a row, and only takes that are ready. */
const lastTake = new Map<DrumId, number>();
function takeFor(c: AudioContext, beat: Beat, id: DrumId): AudioBuffer {
  const voice = voiceOf(beat, id);
  const p = soundOf(beat, id);
  const sampler = fxOf(beat).sampler;
  const first = drumBuffer(c, voice, id, p, sampler, 0);
  const ready = [0];
  for (let v = 1; v < VARIANTS; v++) {
    if (drumBuffers.has(keyOf(voice, id, p, sampler, v))) ready.push(v);
    else renderLater(() => drumBuffer(c, voice, id, p, sampler, v));
  }
  const prev = lastTake.get(id) ?? -1;
  const choices = ready.length > 1 ? ready.filter((v) => v !== prev) : ready;
  const v = choices[Math.floor(Math.random() * choices.length)];
  lastTake.set(id, v);
  return v === 0 ? first : drumBuffer(c, voice, id, p, sampler, v);
}

// ── noise bed ──
const BED_LEVEL: Record<NoiseBed, number> = { off: 0, vinyl: 1, tape: 1, room: 1.4, hum: 0.8 };
const beds = new Map<NoiseBed, AudioBuffer>();
/** (`at`: from when, on the audio clock; a render's beds change where their sections start) */
function stopBed(d: Desk, at = 0) {
  if (d.bedSrc) {
    // faded out over 20 ms rather than cut off where it is (from the soonest moment it can be: see soonest)
    const t = Math.max(at, soonest(d.bedSrc.context));
    if (d.bedFade) {
      const g = d.bedFade.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(1, t);
      g.linearRampToValueAtTime(0, t + BED_FADE);
    }
    try {
      d.bedSrc.stop(d.bedFade ? t + BED_FADE + 0.001 : t);
    } catch {
      /* stopped */
    }
    const c = d.bedSrc.context;
    d.bedSrc = null;
    d.bedFade = null;
    // (the bed kept the desk awake: it may rest once the bed has faded and the desk has rung out)
    sounding(d, c, t + BED_FADE);
  }
  d.bedType = "off";
}
/** how a desk's feed crosses over to its other room (time constant, seconds), and how long a room still ringing takes to fade out when it must be loaded again */
const ROOM_TAU = 0.01;
const ROOM_FADE = 0.06;
/**
 * A new room for a desk, from now (a section's own room: the render or the timer brings this to
 * its moment). Setting a ringing room's impulse would cut what it is ringing with to silence, a
 * click; instead the new impulse goes into the desk's other room, which is quiet, the drums are
 * sent to it from now on, and the room they leave rings out what it was sent. (Should the other
 * room still be ringing, from a change a moment ago, it is faded out over 60 ms first.)
 */
function swapRoom(c: AudioContext, d: Desk, buf: AudioBuffer) {
  const b = d.bus;
  const i = d.verbOn;
  if (!b.verbs[i].buffer) {
    b.verbs[i].buffer = buf;
    return;
  }
  const offline = "startRendering" in c;
  const later = (t: number, f: () => void) => {
    if (offline) atRenderTime(c, t, f);
    else window.setTimeout(f, Math.max(0, t - c.currentTime) * 1000 + 5);
  };
  const now = c.currentTime;
  const j = i ? 0 : 1;
  const out = b.verbOuts[j].gain;
  if (now < d.verbRings[j]) {
    // the other room still rings: faded out first, then loaded
    if (d.verbRings[j] < Infinity) {
      out.cancelScheduledValues(now);
      out.setValueAtTime(out.value, now);
      out.linearRampToValueAtTime(0, now + ROOM_FADE);
      d.verbRings[j] = Infinity;
      later(now + ROOM_FADE, () => {
        d.verbRings[j] = 0;
        swapRoom(c, d, buf);
      });
    } else later(now + ROOM_FADE, () => swapRoom(c, d, buf));
    return;
  }
  b.verbs[j].buffer = buf;
  out.cancelScheduledValues(now);
  out.setValueAtTime(1, now);
  const [from, into] = [b.verbIns[i].gain, b.verbIns[j].gain];
  into.cancelScheduledValues(now);
  into.setValueAtTime(0, now);
  into.setTargetAtTime(1, now, ROOM_TAU);
  b.verbIn.connect(b.verbIns[j]);
  from.cancelScheduledValues(now);
  from.setTargetAtTime(0, now, ROOM_TAU);
  d.verbOn = j;
  const rings = now + (b.verbs[i].buffer?.duration ?? 0) + 0.2;
  d.verbRings[i] = rings;
  // the room left is let go of once it has rung out (a render keeps it: every export the same)
  if (!offline)
    later(rings, () => {
      if (d.verbOn !== i)
        try {
          b.verbIn.disconnect(b.verbIns[i]);
        } catch {
          /* not connected */
        }
    });
}
/** how long a noise bed takes to fade out when it stops (seconds) */
const BED_FADE = 0.02;
function startBed(d: Desk, type: NoiseBed, at = 0) {
  const c = audioContext();
  stopBed(d, at);
  d.bedType = type;
  if (type === "off") return;
  let buf = beds.get(type);
  if (!buf) {
    const [l, r] = renderNoiseBed(c.sampleRate, type);
    buf = c.createBuffer(2, l.length, c.sampleRate);
    buf.getChannelData(0).set(l);
    buf.getChannelData(1).set(r);
    beds.set(type, buf);
  }
  d.bedSrc = c.createBufferSource();
  d.bedSrc.buffer = buf;
  d.bedSrc.loop = true;
  d.bedFade = c.createGain();
  d.bedSrc.connect(d.bedFade).connect(d.bus.bed);
  d.bedSrc.start(at);
  // (a desk at rest is put back on its fader: the bed keeps it there while it runs)
  sounding(d, c, at);
}
/**
 * A track's noise bed runs while its drums are playing: a track whose drums stop (switched off, or
 * a section without them) goes quiet too. With no track and no beat, every track's stops. `at`:
 * from when (a render's sections each start the bed they have where they start).
 */
export function setBedPlaying(on: boolean, beat: Beat | null, track?: string, at?: number) {
  if (!beat) {
    const set = desks.get(audioContext());
    for (const [id, d] of set ?? []) {
      if (track !== undefined && id !== track) continue;
      d.bedOn = false;
      stopBed(d, at);
    }
    return;
  }
  const d = deskOf(track ?? FIRST_DRUMS);
  d.bedOn = on && !!beat.on;
  const want = d.bedOn ? fxOf(beat).noise : "off";
  if (want === "off") stopBed(d, at);
  else if (!d.bedSrc || d.bedType !== want) startBed(d, want, at);
}

// ── pump: other instruments duck under the kick ──
let onKick: ((when: number, depth: number) => void) | null = null;
/** The guitar registers here to duck under the kick when Pump is turned up. */
export function onKickHit(fn: ((when: number, depth: number) => void) | null) {
  onKick = fn;
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
export function playDrum(beat: Beat, id: DrumId, when?: number, velocity = 0.8, human = 0, track = FIRST_DRUMS) {
  const c = audioContext();
  const b = getBus(track);
  const desk = deskOf(track);
  const t = when ?? c.currentTime + 0.01;
  const buffer = takeFor(c, beat, id);
  const speed = human ? 1 + (Math.random() - 0.5) * 0.014 * human : 1;
  // booked late (the page was held up) and already over by now: left out (see late.ts)
  if (pastEnd(c, t, buffer, speed) > 0) {
    lateCount.over++;
    // (a hat that came and went still closed the open one: it is let go now, with its fade)
    if ((id === "hat" || id === "open") && desk.openHat) damp(desk.openHat, soonest(c));
    if (id === "hat" || id === "open") desk.openHat = null;
    return;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  // for the canvas: what this hit is made of, measured from the hit itself
  if (listening() && !isRendering()) pulse({ kind: "drum", track: track === FIRST_DRUMS ? undefined : track, time: t, drum: id, velocity, gain: soundOf(beat, id).level / 0.8, sound: measure(src.buffer) });
  if (human) src.playbackRate.value = speed;
  const g = c.createGain();
  g.gain.value = velocity * velocity * 1.1;
  let tail: AudioNode = g;
  if (velocity < 0.7 && id !== "kick") {
    const soft = c.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 5000 + 30000 * velocity * velocity;
    soft.Q.value = 0.5;
    tail = g.connect(soft);
  }
  tail.connect(b.channels[id].input);
  const r: Ringing = { src, gain: g };
  // booked late: it starts in a moment, as far into the hit as it is late, faded in (see late.ts); `at` is when it really starts
  const at = startRecorded(c, src, t, g, 0, "drums");
  // a desk at rest is back on its fader before the hit sounds, and stays until the hit has rung out
  sounding(desk, c, at + buffer.duration / speed);
  // (an offline render plays every hit as written: no choking hats, no pumping harps)
  if (isRendering()) return;
  if (id === "hat" || id === "open") {
    if (desk.openHat) damp(desk.openHat, at);
    desk.openHat = id === "open" ? r : null;
  }
  live.add(r);
  src.onended = () => live.delete(r);
  // (a kick that cannot be heard, muted or soloed out, pumps nothing; nor does one whose thump has passed, started late)
  const pump = [...desk.pumps].reverse().find((x) => x.at <= t + 1e-6)?.pump ?? desk.pump;
  if (id === "kick" && at === t && pump > 0 && onKick && levelOf(track) > 0) onKick(t, pump * velocity);
}

/** Play one step of a track's grid for a drum, respecting mute, solo and the "human" setting. */
export function playStep(beat: Beat, id: DrumId, level: number, when: number, track = FIRST_DRUMS) {
  const solo = solos.get(track);
  if (solo ? solo !== id : beat.mutes?.includes(id)) return;
  const human = beat.human ?? 0;
  if (!human) return playDrum(beat, id, when, STEP_VELOCITY[level], 0, track);
  // a player is never exactly on the grid, and never hits twice the same; the kick stays tightest
  const late = (Math.random() - 0.35) * 0.02 * human * (id === "kick" ? 0.35 : 1);
  const touch = 1 + (Math.random() - 0.5) * 0.3 * human;
  playDrum(beat, id, when + Math.max(0, late), Math.min(1, STEP_VELOCITY[level] * touch), human, track);
}

/** Render a beat's sounds ahead of time so the first bar plays without a hiccup. */
export function prepareBeat(beat: Beat) {
  const c = audioContext();
  const sampler = fxOf(beat).sampler;
  for (const id of DRUM_IDS) {
    if (!/[123]/.test(beat.rows[id] ?? "")) continue;
    const voice = voiceOf(beat, id);
    const p = soundOf(beat, id);
    drumBuffer(c, voice, id, p, sampler, 0);
    for (let v = 1; v < VARIANTS; v++) renderLater(() => drumBuffer(c, voice, id, p, sampler, v));
  }
}

export function stopDrums() {
  const c = audioIfStarted();
  if (!c) return;
  for (const r of live) damp(r, c.currentTime);
  live.clear();
  for (const d of desks.get(c)?.values() ?? []) d.openHat = null;
}

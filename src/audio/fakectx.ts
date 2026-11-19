/**
 * A pretend audio context for the tests of a track's whole chain (node has no Web Audio): every
 * node the effects, the drum desks and the instruments make, wired up as they would be, so a test
 * can follow a note from its source to the fader it reaches, read what a knob was set to and when,
 * and pause an "offline render" at a moment as a real one would.
 */
import { FakeBuffer, FakeContext, FakeNode, FakeParam, FakeSource } from "../keys/fakeaudio";

/** Every node: the params any Web Audio node of that kind has, and whatever else is set on it. */
export class FakeAny extends FakeNode {
  gain = new FakeParam(1);
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  detune = new FakeParam(0);
  delayTime = new FakeParam(0);
  threshold = new FakeParam(-24);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
  knee = new FakeParam(30);
  pan = new FakeParam(0);
  buffer: unknown = null;
  normalize = true;
  curve: unknown = null;
  oversample = "none";
  type = "";
  channelCount = 2;
  channelCountMode = "max";
  channelInterpretation = "speakers";
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  minDecibels = -100;
  /** an oscillator: started, and stopped */
  started?: number;
  stopped = false;
  start(t = 0) {
    this.started = t;
  }
  stop() {
    this.stopped = true;
  }
  getFloatFrequencyData() {}
}

export class FakeAudio extends FakeContext {
  /** every node made, in order */
  nodes: FakeNode[] = [];
  private add<T extends FakeNode>(n: T): T {
    this.nodes.push(n);
    // a node knows its context (the canvas's taps make their analysers there)
    (n as unknown as { context: FakeAudio }).context = this;
    return n;
  }
  private out = new FakeAny();
  override get destination() {
    return this.out;
  }
  override createGain() {
    return this.add(new FakeAny()) as never;
  }
  override createBiquadFilter() {
    return this.add(new FakeAny()) as never;
  }
  override createStereoPanner() {
    return this.add(new FakeAny()) as never;
  }
  override createOscillator() {
    return this.add(new FakeAny()) as never;
  }
  override createChannelMerger() {
    return this.add(new FakeAny());
  }
  override createChannelSplitter() {
    return this.add(new FakeAny());
  }
  override createBufferSource() {
    const s = super.createBufferSource();
    // the strings' octave and shimmer copies are pitched up
    (s as unknown as { detune: FakeParam }).detune = new FakeParam(0);
    return this.add(s);
  }
  createDelay() {
    return this.add(new FakeAny());
  }
  createDynamicsCompressor() {
    return this.add(new FakeAny());
  }
  createWaveShaper() {
    return this.add(new FakeAny());
  }
  createConvolver() {
    return this.add(new FakeAny());
  }
  createAnalyser() {
    return this.add(new FakeAny());
  }
  /** Is `to` reached from `from`, following the wiring (params included)? */
  reaches(from: object, to: object): boolean {
    const seen = new Set<object>();
    const walk = (n: object): boolean => {
      if (n === to) return true;
      if (seen.has(n)) return false;
      seen.add(n);
      return ((n as FakeNode).outputs ?? []).some(walk);
    };
    return walk(from);
  }
  /** The sources started so far. */
  get started(): FakeSource[] {
    return this.sources.filter((s) => s.started);
  }
}

/**
 * An offline render that has not started: `suspend(t)` books a pause (as a real one does, before
 * rendering), and `reach(t)` plays the render up to `t`, running what was booked on the way.
 */
export class FakeOffline extends FakeAudio {
  pauses: { t: number; go: () => void }[] = [];
  resumed = 0;
  constructor(
    sampleRate = 48000,
    readonly length = 48000 * 30,
  ) {
    super(sampleRate);
  }
  suspend(t: number): Promise<void> {
    return new Promise((go) => this.pauses.push({ t, go }));
  }
  resume(): Promise<void> {
    this.resumed++;
    return Promise.resolve();
  }
  startRendering(): Promise<FakeBuffer> {
    return Promise.resolve(new FakeBuffer(2, this.length / this.sampleRate, this.sampleRate));
  }
  /** Render up to `t`: every pause on the way is reached (and its jobs run). */
  async reach(t: number) {
    for (const p of this.pauses.filter((p) => p.t <= t).sort((a, b) => a.t - b.t)) {
      this.currentTime = p.t;
      p.go();
      await Promise.resolve();
    }
    this.pauses = this.pauses.filter((p) => p.t > t);
    this.currentTime = t;
    await Promise.resolve();
  }
}

export const asAudio = (c: FakeAudio) => c as unknown as AudioContext;

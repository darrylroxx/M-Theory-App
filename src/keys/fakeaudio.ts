/**
 * A pretend audio context for the tests (node has no Web Audio): it records what an instrument
 * books (starts, stops, gain automation) and can say what a gain will be at any time.
 */

type Ev = { kind: "set"; t: number; v: number } | { kind: "target"; t: number; v: number; tau: number } | { kind: "ramp"; t: number; v: number };

export class FakeParam {
  events: Ev[] = [];
  constructor(public value = 1) {}
  setValueAtTime(v: number, t: number) {
    this.add({ kind: "set", t, v });
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    this.add({ kind: "target", t, v, tau });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.add({ kind: "ramp", t, v });
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  private add(e: Ev) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
  }
  /** The value at time t, following the Web Audio rules for these two kinds of event. */
  at(t: number): number {
    let v = this.value;
    let vt = 0;
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      // a ramp under way: a straight line from the value before it
      if (e.t > t) return e.kind === "ramp" && e.t > vt ? v + ((e.v - v) * (t - vt)) / (e.t - vt) : v;
      vt = e.t;
      if (e.kind === "set" || e.kind === "ramp") v = e.v;
      else {
        const next = this.events[i + 1];
        const until = next && next.t <= t ? next.t : t;
        v = e.v + (v - e.v) * Math.exp(-(until - e.t) / e.tau);
      }
    }
    return v;
  }
}

export class FakeNode {
  outputs: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    this.outputs.push(n);
    return n;
  }
  /** Let go of every connection, or only the ones to `to` (a node or a param), as Web Audio does. */
  disconnect(to?: unknown) {
    this.outputs = to === undefined ? [] : this.outputs.filter((n) => n !== to);
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeBuffer {
  readonly length: number;
  private data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly duration: number,
    readonly sampleRate: number,
    readonly name = "",
  ) {
    this.length = Math.round(duration * sampleRate);
    // decoded files hold only their first second (the tests never read further); made buffers hold everything
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(name ? Math.min(this.length, 48000) : this.length));
  }
  getChannelData(c: number) {
    return this.data[c];
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam(1);
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started?: { when: number; offset: number };
  stops: number[] = [];
  onended: (() => void) | null = null;
  start(when = 0, offset = 0) {
    if (this.started) throw new Error("started twice");
    this.started = { when, offset };
  }
  stop(when = 0) {
    this.stops.push(when);
  }
  /** When it really stops: the last stop() call, or the end of its buffer (never, if it loops). */
  get stopsAt(): number {
    const natural =
      this.started && this.buffer && !this.loop ? this.started.when + (this.buffer.duration - this.started.offset) / this.playbackRate.value : Infinity;
    return this.stops.length ? Math.min(natural, this.stops[this.stops.length - 1]) : natural;
  }
  /** Does it make sound at t (started, not stopped, and the gain after it is up)? */
  audibleAt(t: number): boolean {
    if (!this.started || t < this.started.when || t >= this.stopsAt) return false;
    let g = this.outputs[0] as FakeNode | undefined;
    while (g && !(g instanceof FakeGain)) g = g.outputs[0];
    return !g || (g as FakeGain).gain.at(t) > 1e-4;
  }
}

export class FakePanner extends FakeNode {
  pan = new FakeParam(0);
}

export class FakeFilter extends FakeNode {
  constructor(
    readonly feedforward: number[] = [],
    readonly feedback: number[] = [],
  ) {
    super();
  }
}

export class FakeBiquad extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

export class FakeOscillator extends FakeNode {
  frequency = new FakeParam(440);
  type = "sine";
  started?: number;
  start(t = 0) {
    this.started = t;
  }
  stop() {}
}

export class FakeContext {
  currentTime = 0;
  sources: FakeSource[] = [];
  panners: FakePanner[] = [];
  filters: FakeFilter[] = [];
  constructor(readonly sampleRate = 48000) {}
  createGain() {
    return new FakeGain();
  }
  createStereoPanner() {
    const p = new FakePanner();
    this.panners.push(p);
    return p;
  }
  createIIRFilter(ff: number[], fb: number[]) {
    const f = new FakeFilter(ff, fb);
    this.filters.push(f);
    return f;
  }
  createChannelSplitter() {
    return new FakeNode();
  }
  createChannelMerger() {
    return new FakeNode();
  }
  biquads: FakeBiquad[] = [];
  createBiquadFilter() {
    const b = new FakeBiquad();
    this.biquads.push(b);
    return b;
  }
  createOscillator() {
    return new FakeOscillator();
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length / sampleRate, sampleRate);
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  get destination() {
    return new FakeNode();
  }
  /** Sources playing this file. */
  playing(name: string) {
    return this.sources.filter((s) => s.buffer?.name === name);
  }
}

/** The fake as the type the instruments expect. */
export const asContext = (c: FakeContext) => c as unknown as BaseAudioContext;

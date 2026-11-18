import { beforeAll, describe, expect, it } from "vitest";
import { fadeSeconds } from "./damper";
import { EP_VOLUME, EPiano } from "./epiano";
import { FakeContext, asContext, type FakeGain, type FakeSource } from "./fakeaudio";
import { KEY_GROUPS, TABLE_LENGTH, TINE_RATE, decayTau, groupOf, levelOf, panOf, rateOf, releaseTau, ringSeconds } from "./tines";

const BASE = "https://test.local/keys/epiano/";
const table = new Int16Array(TABLE_LENGTH + 4).map((_, i) => (i % 2000) - 1000);
const manifest = { files: [{ file: "tines.bin", sha: "abc" }] };
let fetched: string[] = [];
const fetch = async (url: string) => {
  fetched.push(url.slice(BASE.length));
  if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer;
  return table.buffer.slice(0) as ArrayBuffer;
};

async function setup(opts: ConstructorParameters<typeof EPiano>[2] = {}) {
  const ctx = new FakeContext(48000);
  const ep = new EPiano(asContext(ctx), BASE, { fetch, ...opts });
  await ep.load();
  return { ctx, ep };
}
const gainOf = (s: FakeSource) => (s.outputs[0] as FakeGain).gain;

beforeAll(() => {
  fetched = [];
});

describe("loading", () => {
  it("fetches the manifest and the table once (by its version), then cuts the 33 recordings", async () => {
    const { ctx, ep } = await setup();
    expect(ep.ready()).toBe(true);
    expect(fetched).toEqual(["manifest.json", "tines.bin?v=abc"]);
    await setup(); // a second instrument shares the table
    expect(fetched.length).toBe(2);
    ep.play(60, 0, 0.5, 1);
    const s = ctx.sources[0];
    const g = KEY_GROUPS[groupOf(60, 0.5)];
    expect(s.buffer!.sampleRate).toBe(TINE_RATE);
    expect(s.buffer!.length).toBe(g.end - g.pos + 1);
    expect(s.loop).toBe(true);
    expect(s.loopEnd - s.loopStart).toBeCloseTo(g.loop / TINE_RATE, 9);
  });

  it("is silent before it is loaded", () => {
    const ctx = new FakeContext();
    const ep = new EPiano(asContext(ctx), BASE, { fetch });
    expect(ep.ready()).toBe(false);
    ep.play(60, 0, 0.5, 1);
    expect(ctx.sources.length).toBe(0);
  });
});

describe("playing", () => {
  it("plays the right recording at the right pitch, fading as mda's envelope does", async () => {
    const { ctx, ep } = await setup();
    ep.play(64, 1, 0.7, Infinity);
    const s = ctx.sources[0];
    const k = groupOf(64, 0.7);
    expect(s.playbackRate.value).toBeCloseTo(rateOf(64, k), 12);
    const g = gainOf(s);
    const l0 = levelOf(64, 0.7) * panOf(64).gain * EP_VOLUME;
    expect(g.at(1)).toBeCloseTo(l0, 9);
    expect(g.at(0.999)).toBe(0);
    expect(g.at(1 + decayTau(64))).toBeCloseTo(l0 / Math.E, 9);
    // held for ever, it stops once it has faded to mda's silence
    expect(s.stopsAt).toBeCloseTo(1 + ringSeconds(64, 0.7), 9);
    // panned by key
    expect(ctx.panners[0].pan.value).toBeCloseTo(panOf(64).pan, 12);
  });

  it("puts middle C in the centre at mda's level, with no panner", async () => {
    const { ctx, ep } = await setup();
    ep.play(60, 0, 0.5, 1);
    expect(ctx.panners.length).toBe(0);
    expect(gainOf(ctx.sources[0]).at(0)).toBeCloseTo(levelOf(60, 0.5) * EP_VOLUME, 9);
  });

  it("stops quickly when the key is let go, from wherever the fade had got to", async () => {
    const { ctx, ep } = await setup();
    ep.play(60, 0, 0.7, 2);
    const s = ctx.sources[0];
    const g = gainOf(s);
    const atUp = g.at(2);
    expect(atUp).toBeCloseTo(levelOf(60, 0.7) * EP_VOLUME * Math.exp(-2 / decayTau(60)), 9);
    expect(g.at(2 + releaseTau(60))).toBeCloseTo(atUp / Math.E, 9);
    expect(s.stopsAt).toBeCloseTo(2 + fadeSeconds(releaseTau(60)), 9);
  });

  it("holds let-go notes on the pedal, still fading as a held tine does", async () => {
    const { ctx, ep } = await setup();
    ep.pedal(true, 0);
    ep.play(60, 0.5, 0.7, 0.5);
    ep.pedal(false, 3);
    const s = ctx.sources[0];
    const g = gainOf(s);
    const l0 = g.at(0.5);
    expect(g.at(2.5)).toBeCloseTo(l0 * Math.exp(-2 / decayTau(60)), 9); // not damped at the key-up
    expect(s.stopsAt).toBeCloseTo(3 + fadeSeconds(releaseTau(60)), 9);
    // a pedal pressed after the note was booked keeps it ringing to its natural end
    ep.play(62, 4, 0.7, 0.5);
    ep.pedal(true, 4.2);
    const b = ctx.sources[1];
    expect(b.stopsAt).toBeCloseTo(4 + ringSeconds(62, 0.7), 9);
    expect(gainOf(b).at(5)).toBeCloseTo(gainOf(b).at(4) * Math.exp(-1 / decayTau(62)), 9);
  });

  it("chokes a re-struck key, lets a lane's last note go, and keeps to its polyphony", async () => {
    const { ctx, ep } = await setup({ polyphony: 3 });
    ep.play(60, 0, 0.7, Infinity);
    ep.play(60, 1, 0.7, Infinity);
    expect(ctx.sources[0].stopsAt).toBeLessThan(1.6);
    expect(gainOf(ctx.sources[0]).at(1)).toBeGreaterThan(0);
    ep.play(64, 2, 0.7, Infinity, 5);
    ep.play(67, 3, 0.7, Infinity, 5);
    expect(ctx.sources[2].stopsAt).toBeCloseTo(3 + fadeSeconds(releaseTau(64)), 9);
    ep.play(72, 3.5, 0.7, Infinity);
    ep.play(76, 3.6, 0.7, Infinity); // over three: the oldest goes
    expect(ep.sounding(3.8)).toBeLessThanOrEqual(3);
  });

  it("changes tone and movement smoothly, and frees everything on dispose", async () => {
    const { ctx, ep } = await setup();
    ep.set({ treble: 1, mod: 0.75 });
    expect(ep.params().treble).toBe(1);
    expect(ctx.filters.length).toBe(2);
    ep.play(60, 0, 0.7, Infinity);
    ep.stopAll(1);
    expect(ctx.sources[0].stopsAt).toBeCloseTo(1 + fadeSeconds(releaseTau(60)), 9);
    ep.dispose();
    expect(ep.ready()).toBe(false);
    ep.play(60, 2, 0.7, 1);
    expect(ctx.sources.length).toBe(1);
  });
});

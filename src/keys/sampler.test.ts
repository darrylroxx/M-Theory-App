import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pack from "../../public/keys/piano/manifest.json";
import { Bank, measureLead } from "./bank";
import { damperTau, fadeSeconds } from "./damper";
import { FakeBuffer, FakeContext, asContext, type FakeGain, type FakeSource } from "./fakeaudio";
import { layerOf, layerSamples, loadOrder, pick, releaseFor, type PackManifest } from "./pack";
import { Sampler } from "./sampler";

const m = pack as unknown as PackManifest;
const BASE = "https://test.local/keys/piano/";
const enc = new TextEncoder();
const dec = new TextDecoder();
const byFile = new Map([...m.samples, ...m.releases].map((s) => [s.file, s]));

/** A pretend network: the manifest, and each file as its own name (the decoder turns it into a buffer). */
function setup(opts: { lead?: number; fail?: Set<string>; rate?: number; budget?: number; offline?: boolean; onFetch?: () => void } = {}) {
  const fetched: string[] = [];
  const decodedAt: number[] = [];
  const fetch = async (url: string) => {
    const file = url.slice(BASE.length).split("?")[0];
    fetched.push(file);
    opts.onFetch?.();
    if (opts.fail?.has(file)) throw new Error("offline");
    return enc.encode(file === "manifest.json" ? JSON.stringify(m) : file).buffer as ArrayBuffer;
  };
  const decoded: string[] = [];
  const decode = async (data: ArrayBuffer, rate: number) => {
    const file = dec.decode(data);
    decodedAt.push(rate);
    decoded.push(file);
    if (file === m.probe.file) {
      const b = new FakeBuffer(2, 0.3, rate, file);
      const i = Math.round((m.probe.at + (opts.lead ?? 0)) * rate);
      b.getChannelData(0).fill(0.8, i, i + 400);
      return b as unknown as AudioBuffer;
    }
    return new FakeBuffer(2, byFile.get(file)!.dur, rate, file) as unknown as AudioBuffer;
  };
  const ctx = new FakeContext(opts.rate ?? 48000);
  const sampler = new Sampler(asContext(ctx), BASE, { fetch, decode, budget: opts.budget ?? Infinity, offline: opts.offline });
  return { ctx, sampler, fetched, decodedAt, decoded };
}

/** Let every queued download finish. */
async function settle(bank: Bank) {
  for (let i = 0; i < 2000 && bank.pending().length; i++) await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

/** The sources started for one key (the note itself, not damper sounds). */
const notesOf = (ctx: FakeContext) => ctx.sources.filter((s) => s.buffer?.name.startsWith("n"));
const releasesOf = (ctx: FakeContext) => ctx.sources.filter((s) => s.buffer?.name.startsWith("r"));
/** The note's own gain (after the darkening filter, when it has one). */
const gainOf = (s: FakeSource) => {
  let n = s.outputs[0];
  while (!("gain" in n)) n = n.outputs[0];
  return (n as FakeGain).gain;
};

beforeEach(() => Bank.reset());
afterEach(() => Bank.reset());

describe("loading", () => {
  it("is ready once one layer is in, fetched middle keys first, and reports progress", async () => {
    const { sampler, fetched } = setup();
    const seen: number[] = [];
    sampler.onProgress((p) => seen.push(p.loaded));
    expect(sampler.ready()).toBe(false);
    await sampler.load();
    expect(sampler.ready()).toBe(true);
    const core = loadOrder(m)[0];
    // the first files fetched (after the manifest and the decoder probe) are the first tier, middle out
    const files = fetched.filter((f) => f !== "manifest.json" && f !== m.probe.file);
    expect(files.slice(0, core.length)).toEqual(core);
    const p = sampler.progress();
    expect(p.loaded).toBe(p.total);
    expect(p.total).toBeGreaterThan(2e6);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(seen[0]);
    expect(p.memory).toBeGreaterThan(0);
  });

  it("decodes at the context's sample rate, sharing buffers between contexts at the same rate", async () => {
    const a = setup({ rate: 44100 });
    await a.sampler.load();
    expect(new Set(a.decodedAt)).toEqual(new Set([44100]));
    // a second instrument at the same rate (an offline bounce of the live song) needs no new files
    const s2 = new Sampler(asContext(new FakeContext(44100)), BASE, {});
    expect(s2.ready()).toBe(true);
    await s2.load();
    const files = a.fetched.filter((f) => f !== "manifest.json");
    expect(new Set(files).size).toBe(files.length); // nothing fetched twice
    // a render at another rate gets its own buffers, decoded for it
    const s3 = new Sampler(asContext(new FakeContext(48000)), BASE, {});
    expect(s3.ready()).toBe(false);
  });

  it("measures the decoder's lead-in from the probe and skips it in every note", async () => {
    expect(measureLead(new Float32Array(100).fill(0.5, 60), 1000, 0.05)).toBeCloseTo(0.01, 9);
    expect(measureLead(new Float32Array(100), 1000, 0.05)).toBe(0);
    const { ctx, sampler } = setup({ lead: 0.023 });
    await sampler.load();
    sampler.play(60, 1, 0.7, 1);
    expect(notesOf(ctx)[0].started!.offset).toBeCloseTo(0.023, 3);
  });

  it("loads what a song needs before an offline render", async () => {
    const { sampler } = setup();
    const notes = [
      { midi: 30, velocity: 0.1 },
      { midi: 90, velocity: 1 },
    ];
    await sampler.prepare(notes);
    const bank = Bank.for(BASE, 48000);
    for (const n of notes) expect(bank.has(pick(m, n.midi, n.velocity)!.sample.file)).toBe(true);
    expect(bank.has(releaseFor(m, 30, 0.1)!.file)).toBe(true);
  });

  it("plays a neighbouring layer while the right one loads, and fetches it for next time", async () => {
    const { ctx, sampler } = setup();
    await sampler.load();
    const bank = Bank.for(BASE, 48000);
    const want = pick(m, 60, 0.05)!.sample.file; // the softest layer
    const had = bank.has(want);
    sampler.play(60, 1, 0.05, 1);
    const n = notesOf(ctx)[0];
    expect(n).toBeTruthy();
    if (!had) {
      expect(n.buffer!.name).not.toBe(want);
      expect(bank.pending().concat([...ctx.sources.map((s) => s.buffer!.name)])).toContain(want);
    }
  });

  it("keeps to its memory budget, downloading the rest without decoding it so it plays offline", async () => {
    const core = loadOrder(m)[0];
    const coreBytes = core.reduce((n, f) => n + Math.ceil(byFile.get(f)!.dur * 48000) * 8, 0);
    const budget = coreBytes * 1.5;
    const { sampler, fetched, decoded } = setup({ budget, offline: true });
    await sampler.load();
    const bank = Bank.for(BASE, 48000);
    await settle(bank);
    expect(sampler.memory()).toBeLessThanOrEqual(budget);
    const all = [...m.samples, ...m.releases].map((s) => s.file);
    for (const f of all) expect(fetched).toContain(f); // every file is in the browser's cache
    const stashed = bank.stashedFiles();
    expect(stashed.length).toBeGreaterThan(0);
    for (const f of stashed) expect(decoded).not.toContain(f);
    // a note that needs a stashed file still gets it (from the cache, decoded now)
    const want = stashed.find((f) => f.startsWith("n"))!;
    const s = byFile.get(want) as (typeof m.samples)[number];
    await sampler.prepare([{ midi: s.note, velocity: m.layers[s.layer].center }]);
    expect(bank.has(want)).toBe(true);
  });

  it("keeps what a bounce prepared even when memory runs short and downloads are slow", async () => {
    const core = loadOrder(m)[0];
    const coreBytes = core.reduce((n, f) => n + Math.ceil(byFile.get(f)!.dur * 48000) * 8, 0);
    // every download takes a second, so files loaded early are no longer "just played"
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const { sampler } = setup({ budget: coreBytes * 1.05, offline: false, onFetch: () => (clock += 1000) });
      await sampler.load();
      // every take of the top layer and of the softest: far more than the budget allows
      const notes = [...layerSamples(m, 4), ...layerSamples(m, 0)].map((s) => ({ midi: s.note, velocity: m.layers[s.layer].center }));
      await sampler.prepare(notes);
      const bank = Bank.for(BASE, 48000);
      for (const s of [...layerSamples(m, 4), ...layerSamples(m, 0)]) expect(bank.has(s.file)).toBe(true);
      expect(sampler.memory()).toBeGreaterThan(coreBytes * 2);
    } finally {
      spy.mockRestore();
    }
  });

  it("downloads nothing past the budget when offline use is off", async () => {
    const core = loadOrder(m)[0];
    const coreBytes = core.reduce((n, f) => n + Math.ceil(byFile.get(f)!.dur * 48000) * 8, 0);
    const { sampler, fetched } = setup({ budget: coreBytes * 1.2, offline: false });
    await sampler.load();
    const bank = Bank.for(BASE, 48000);
    await settle(bank);
    expect(bank.stashedFiles()).toEqual([]);
    expect(fetched.length).toBeLessThan(m.samples.length + m.releases.length);
  });

  it("is silent rather than failing when nothing could be fetched", async () => {
    const fail = new Set(loadOrder(m)[0]);
    const { ctx, sampler } = setup({ fail });
    await expect(sampler.load()).rejects.toThrow();
    expect(sampler.ready()).toBe(false);
    sampler.play(60, 0, 0.7, 1);
    expect(ctx.sources.length).toBe(0);
  });
});

describe("playing", () => {
  async function ready(opts?: Parameters<typeof setup>[0]) {
    const s = setup(opts);
    await s.sampler.prepare([60, 61, 62, 64, 67, 72, 95].flatMap((midi) => [0.05, 0.4, 0.7, 0.9].map((velocity) => ({ midi, velocity }))));
    return s;
  }

  it("starts the right recording at the right rate and level", async () => {
    const { ctx, sampler } = await ready();
    sampler.play(61, 2, 0.7, 1);
    const n = notesOf(ctx)[0];
    const p = pick(m, 61, 0.7)!;
    expect(n.buffer!.name).toBe(p.sample.file);
    expect(n.playbackRate.value).toBeCloseTo(p.rate, 12);
    expect(n.started!.when).toBe(2);
    expect(gainOf(n).at(2)).toBeCloseTo(10 ** (p.db / 20), 9);
    expect(gainOf(n).at(1.999)).toBe(0); // silent until it starts
    expect(layerOf(m, 0.7)).toBe(p.sample.layer);
  });

  it("darkens a note played softer than its take was recorded, through a gentle lowpass", async () => {
    const { ctx, sampler } = await ready();
    const L = m.layers[layerOf(m, 0.7)];
    const soft = L.vel[0] + 0.02; // low in the band: darkened
    await sampler.prepare([{ midi: 64, velocity: soft }]);
    sampler.play(64, 1, soft, 1);
    const p = pick(m, 64, soft)!;
    expect(ctx.biquads.length).toBe(1);
    expect(ctx.biquads[0].type).toBe("lowpass");
    expect(ctx.biquads[0].frequency.value).toBeCloseTo(p.cutoff!, 6);
    expect(ctx.biquads[0].Q.value).toBeCloseTo(-3.0103, 4); // Butterworth: no bump at the cutoff
    sampler.play(67, 1, L.center, 1); // at its own velocity: no filter
    expect(ctx.biquads.length).toBe(1);
  });

  it("drops the damper when the key is let go: a quick fade and the felt's own sound", async () => {
    const { ctx, sampler } = await ready();
    sampler.play(60, 1, 0.7, 0.5);
    const n = notesOf(ctx)[0];
    const g = gainOf(n);
    const level = g.at(1.2);
    expect(g.at(1.49)).toBeCloseTo(level, 9); // held
    const tau = damperTau(60);
    expect(g.at(1.5 + tau)).toBeCloseTo(level / Math.E, 6); // fading from the release
    expect(n.stopsAt).toBeCloseTo(1.5 + fadeSeconds(tau), 6);
    const r = releasesOf(ctx);
    expect(r.length).toBe(1);
    expect(r[0].buffer!.name).toBe(releaseFor(m, 60, 0.7)!.file);
    expect(r[0].started!.when).toBe(1.5);
  });

  it("lets the top keys ring on slowly (they have no dampers) with no damper sound", async () => {
    const { ctx, sampler } = await ready();
    sampler.play(95, 0, 0.7, 0.2);
    const g = gainOf(notesOf(ctx)[0]);
    expect(g.at(0.2 + 0.3)).toBeGreaterThan(g.at(0.1) * 0.5);
    expect(releasesOf(ctx).length).toBe(0);
  });

  it("holds let-go notes while the pedal is down and drops them when it comes up", async () => {
    const { ctx, sampler } = await ready();
    sampler.pedal(true, 0.5);
    sampler.play(60, 1, 0.7, 0.5); // key up at 1.5, pedal still down
    sampler.play(64, 2.5, 0.7, 1); // key up at 3.5, after the pedal lifts at 3
    sampler.pedal(false, 3);
    const [a, b] = notesOf(ctx);
    expect(gainOf(a).at(2.9)).toBeCloseTo(gainOf(a).at(1.2), 9); // still ringing at full level
    expect(gainOf(a).at(3 + damperTau(60))).toBeCloseTo(gainOf(a).at(1.2) / Math.E, 6);
    expect(a.stopsAt).toBeCloseTo(3 + fadeSeconds(damperTau(60)), 6);
    // the second key was still held when the pedal lifted: it stops at its own key-up
    expect(gainOf(b).at(3.4)).toBeCloseTo(gainOf(b).at(2.6), 9);
    expect(b.stopsAt).toBeCloseTo(3.5 + fadeSeconds(damperTau(64)), 6);
    // one damper sound each, at the moment its damper fell, quieter after the longer hold
    const r = releasesOf(ctx).filter((s) => s.audibleAt(s.started!.when + 0.01));
    expect(r.map((s) => s.started!.when).sort()).toEqual([3, 3.5]);
    const lv = (s: FakeSource) => gainOf(s).at(s.started!.when + 0.01);
    expect(lv(r.find((s) => s.started!.when === 3)!) / lv(r.find((s) => s.started!.when === 3.5)!)).toBeLessThan(0.5);
  });

  it("works whatever order the pedal and the notes are booked in", async () => {
    const { ctx, sampler } = await ready();
    sampler.play(60, 1, 0.7, 0.5); // booked first: releases at 1.5
    sampler.pedal(false, 2.5); // the lift is booked before the press
    sampler.pedal(true, 1.2);
    const a = notesOf(ctx)[0];
    expect(a.stopsAt).toBeCloseTo(2.5 + fadeSeconds(damperTau(60)), 6);
    const live = releasesOf(ctx).filter((s) => s.audibleAt(s.started!.when + 0.01));
    expect(live.map((s) => s.started!.when)).toEqual([2.5]);
    // a press with no lift booked yet: the note rings until its recording ends
    sampler.pedal(true, 5);
    sampler.play(62, 6, 0.7, 0.2);
    const b = notesOf(ctx)[1];
    expect(b.stopsAt).toBeCloseTo(b.started!.when + (b.buffer!.duration - b.started!.offset) / b.playbackRate.value, 6);
    sampler.pedal(false, 7);
    expect(b.stopsAt).toBeCloseTo(7 + fadeSeconds(damperTau(62)), 6);
  });

  it("keeps a note ringing when the pedal goes down after its release was booked", async () => {
    const { ctx, sampler } = await ready();
    sampler.play(60, 1, 0.7, 0.5); // booked to stop just after 1.5
    sampler.pedal(true, 1.2); // no lift booked: the damper never falls
    const a = notesOf(ctx)[0];
    expect(a.stopsAt).toBeCloseTo(a.started!.when + (a.buffer!.duration - a.started!.offset) / a.playbackRate.value, 6);
    expect(gainOf(a).at(3)).toBeCloseTo(gainOf(a).at(1.1), 9);
    expect(releasesOf(ctx).filter((s) => s.audibleAt(s.started!.when + 0.01)).length).toBe(0);
  });

  it("chokes a key's previous sound when it is struck again, pedal or not", async () => {
    const { ctx, sampler } = await ready();
    sampler.pedal(true, 0);
    sampler.play(60, 1, 0.7, Infinity);
    sampler.play(60, 2, 0.7, Infinity);
    const [a, b] = notesOf(ctx);
    expect(a.stopsAt).toBeLessThan(2.6);
    expect(a.stopsAt).toBeGreaterThan(2);
    expect(gainOf(a).at(2.3)).toBeLessThan(gainOf(a).at(1.5) * 0.01); // 40 dB down within 0.3 s
    expect(gainOf(a).at(2.0)).toBeGreaterThan(0); // no click: it fades, not cuts
    expect(b.audibleAt(3)).toBe(true);
  });

  it("lets a slot's previous note go when a new note takes the slot", async () => {
    const { ctx, sampler } = await ready();
    sampler.play(60, 1, 0.7, Infinity, 3);
    sampler.play(64, 2, 0.7, Infinity, 3);
    sampler.play(67, 2, 0.7, Infinity, 4);
    const [a, b, c] = notesOf(ctx);
    expect(a.stopsAt).toBeCloseTo(2 + fadeSeconds(damperTau(60)), 6);
    expect(b.audibleAt(4)).toBe(true);
    expect(c.audibleAt(4)).toBe(true);
    // with the pedal down the slot's old note rings on
    sampler.pedal(true, 5);
    sampler.play(60, 6, 0.7, Infinity, 7);
    sampler.play(64, 7, 0.7, Infinity, 7);
    const d = notesOf(ctx)[3];
    expect(d.audibleAt(7.5)).toBe(true);
  });

  it("keeps to its polyphony, letting released then oldest notes go, without clicks", async () => {
    const s = setup();
    const ctx = new FakeContext(48000);
    await s.sampler.prepare([60, 61, 62, 64, 67, 72].map((midi) => ({ midi, velocity: 0.7 })));
    const sampler = new Sampler(asContext(ctx), BASE, { polyphony: 4, releases: false });
    await sampler.load();
    sampler.play(60, 0, 0.7, 0.3); // let go at 0.3, still fading when the limit is reached
    sampler.play(61, 0.1, 0.7, Infinity);
    sampler.play(62, 0.2, 0.7, Infinity);
    sampler.play(64, 0.4, 0.7, Infinity); // four sounding: within the limit
    const n = notesOf(ctx);
    expect(n[0].audibleAt(0.45)).toBe(true);
    sampler.play(67, 0.5, 0.7, Infinity); // over: the released note goes first, not the oldest held one
    expect(n[0].stopsAt).toBeLessThan(0.6);
    expect(n[1].audibleAt(0.7)).toBe(true);
    expect(sampler.sounding(0.7)).toBeLessThanOrEqual(4);
    sampler.play(72, 1, 0.7, Infinity); // over again: the oldest held (61) goes
    expect(n[1].stopsAt).toBeLessThan(1.1);
    expect(gainOf(n[1]).at(1)).toBeGreaterThan(0); // faded, not cut
    expect(sampler.sounding(1.2)).toBeLessThanOrEqual(4);
  });

  it("stops everything on stopAll: sounding notes are let go, booked ones never start", async () => {
    const { ctx, sampler } = await ready();
    sampler.pedal(true, 0);
    sampler.play(60, 0.5, 0.7, Infinity);
    sampler.play(64, 3, 0.7, 1); // booked after the stop
    sampler.stopAll(2);
    const [a, b] = notesOf(ctx);
    expect(a.stopsAt).toBeCloseTo(2 + fadeSeconds(damperTau(60)), 6);
    expect(b.stopsAt).toBeLessThanOrEqual(b.started!.when);
    expect(sampler.pedalDown(2.5)).toBe(false);
    // no damper sounds for a stop
    expect(releasesOf(ctx).filter((s) => s.audibleAt(s.started!.when + 0.01)).length).toBe(0);
  });

  it("frees everything on dispose", async () => {
    const { ctx, sampler } = await ready();
    sampler.play(60, 0, 0.7, Infinity);
    sampler.dispose();
    expect(notesOf(ctx)[0].stops.length).toBeGreaterThan(0);
    expect(sampler.ready()).toBe(false);
    sampler.play(60, 1, 0.7, 1);
    expect(notesOf(ctx).length).toBe(1);
  });
});

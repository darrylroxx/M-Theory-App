import { describe, expect, it } from "vitest";
import { EarBank } from "./bank";
import { Ear } from "./ear";

const SR = 48000;
const TAU = Math.PI * 2;
const block = (fill: (i: number) => number, n = 128) => Float32Array.from({ length: n }, (_, i) => fill(i));

describe("a bank of ears on the audio thread", () => {
  it("ears take turns: their work is spread over the hundredth of a second instead of all landing in one block of sound", () => {
    const inputs = Array.from({ length: 7 }, (_, i) => ({ key: i ? `t${i}` : "mix", light: i > 2 }));
    const bank = new EarBank(SR, inputs);
    const silence = block(() => 0);
    const worst = { staggered: 0, together: 0 };
    // the same ears, all started together with nothing to stagger them
    const together = inputs.map(() => new Ear(SR));
    for (let b = 0; b < 400; b++) {
      const out = bank.process(inputs.map(() => [silence]), 0);
      worst.staggered = Math.max(worst.staggered, out.length);
      worst.together = Math.max(worst.together, together.filter((e) => e.push(silence).length > 0).length);
    }
    // a hop is 3.75 blocks at 48 kHz: seven ears spread over it are never more than two to a block
    expect(worst.together).toBe(7);
    expect(worst.staggered).toBeLessThanOrEqual(2);
  });

  it("every ear hears a frame every hundredth of a second (one that gives only a texture, every other), stamped on the audio clock", () => {
    const bank = new EarBank(SR, [{ key: "mix", light: false }, { key: "drums", light: true }, { key: "v1", light: false }]);
    const count = new Map<string, number>();
    let last = -1;
    for (let b = 0; b < 375 * 2; b++) {
      for (const o of bank.process([[block(() => 0)], [block(() => 0)], []], 10)) {
        count.set(o.key, (count.get(o.key) ?? 0) + o.frames.length);
        for (const f of o.frames) {
          expect(f.t).toBeGreaterThan(10);
          if (o.key === "mix") {
            if (last >= 0) expect(f.t - last).toBeCloseTo(0.01, 6);
            last = f.t;
          }
        }
      }
    }
    // two seconds of sound: about two hundred frames each (less the first look's worth), a hundred for the light ear
    for (const k of ["mix", "v1"]) expect(count.get(k)).toBeGreaterThan(190);
    expect(count.get("drums")).toBeGreaterThan(95);
  });

  it("a track is heard against the loudness of the whole mix: a quiet part of a loud song is quiet", () => {
    const run = (mixLoud: boolean) => {
      const bank = new EarBank(SR, [{ key: "mix", light: false }, { key: "part", light: false }]);
      let amp = 0;
      let n = 0;
      for (let b = 0; b < 375 * 2; b++) {
        const t0 = b * 128;
        const part = block((i) => 0.02 * Math.sin((TAU * 440 * (t0 + i)) / SR));
        const mix = block((i) => part[i] + (mixLoud ? 0.5 * Math.sin((TAU * 220 * (t0 + i)) / SR) : 0));
        for (const o of bank.process([[mix], [part]], 0))
          if (o.key === "part" && b > 375)
            for (const f of o.frames) for (const v of f.voices) if (Math.abs(v.hz - 440) < 10) {
              amp += v.amp;
              n++;
            }
      }
      return amp / Math.max(1, n);
    };
    expect(run(true)).toBeLessThan(run(false) * 0.6);
  });

  it("an ear on a track whose notes are known listens only for its texture: no tones, but its level, brightness and hits", () => {
    const bank = new EarBank(SR, [{ key: "mix", light: false }, { key: "drums", light: true }]);
    let voices = 0;
    let hits = 0;
    let loud = -200;
    for (let b = 0; b < 375; b++) {
      const t0 = b * 128;
      const x = block((i) => ((t0 + i) % 12000 < 400 ? (Math.random() * 2 - 1) * 0.5 : 0) + 0.2 * Math.sin((TAU * 330 * (t0 + i)) / SR));
      for (const o of bank.process([[x], [x]], 0))
        if (o.key === "drums")
          for (const f of o.frames) {
            voices += f.voices.length;
            hits += f.hits.length;
            loud = Math.max(loud, f.db);
            expect(f.shape).toBeUndefined();
          }
    }
    expect(voices).toBe(0);
    expect(hits).toBeGreaterThan(2);
    expect(loud).toBeGreaterThan(-30);
  });
});

describe("what the ears heard, on its way to the page", () => {
  it("goes every 50 ms of sound as one message (not one a frame), every frame in it, its arrays moved rather than copied", async () => {
    const { EarBank, EarPost } = await import("./bank");
    const sr = 48000;
    const bank = new EarBank(sr, [{ key: "mix", light: false }, { key: "a", light: true }, { key: "b", light: true }]);
    const post = new EarPost(sr);
    const block = new Float32Array(128).map((_, i) => Math.sin(i * 0.3) * 0.3);
    let sent = 0;
    let frames = 0;
    let made = 0;
    let moved = 0;
    for (let b = 0; b < Math.round(sr / 128); b++) {
      const out = bank.process([[block], [block], [block]], 0);
      for (const o of out) made += o.frames.length;
      const m = post.add(out, 128);
      if (m) {
        sent++;
        for (const o of m.list) frames += o.frames.length;
        moved += m.transfer.length;
      }
    }
    // a second of sound: about 20 messages instead of one per frame
    expect(sent).toBeGreaterThanOrEqual(19);
    expect(sent).toBeLessThanOrEqual(20);
    expect(made).toBeGreaterThan(150);
    // every frame made before the last message is in a message
    expect(frames).toBeGreaterThan(made - 15);
    expect(moved).toBeGreaterThan(frames);
  });
});

import { describe, expect, it } from "vitest";
import { BEAT_GROUPS, BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, barBeats, beatHits, clearBeat, levelAt, reviveBeat, setStep, stepBeat, varyBeat } from "./beats";
import { DRUM_IDS, KITS, drumRng, renderDrum } from "./drums";
import { GM_DRUM, progressionToMidi } from "./midi";

const SR = 44100;
const rms = (d: Float32Array, from = 0, to = d.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
/** rough pitch: zero crossings per second / 2 */
const pitch = (d: Float32Array, from: number, to: number) => {
  let z = 0;
  for (let i = from + 1; i < to; i++) if (d[i - 1] < 0 !== d[i] < 0) z++;
  return (z / 2 / (to - from)) * SR;
};

describe("drum sounds", () => {
  it("every kit renders every drum: audible, finite, never clipping", () => {
    for (const kit of KITS)
      for (const id of DRUM_IDS) {
        const d = renderDrum(SR, kit.id, id);
        expect(d.length, `${kit.id} ${id}`).toBeGreaterThan(SR * 0.02);
        let peak = 0;
        for (const x of d) {
          expect(Number.isFinite(x)).toBe(true);
          peak = Math.max(peak, Math.abs(x));
        }
        expect(peak, `${kit.id} ${id}`).toBeGreaterThan(0.5);
        expect(peak).toBeLessThanOrEqual(1);
        expect(Math.abs(d[d.length - 1])).toBeLessThan(0.01); // ends in silence (no click)
      }
  });

  it("is deterministic", () => {
    expect(Array.from(renderDrum(SR, "808", "snare").slice(0, 500))).toEqual(Array.from(renderDrum(SR, "808", "snare").slice(0, 500)));
    const a = drumRng(5), b = drumRng(5);
    expect(a()).toBe(b());
  });

  it("kicks are low, hats are high", () => {
    for (const kit of KITS) {
      const k = renderDrum(SR, kit.id, "kick", { tone: 0 });
      expect(pitch(k, Math.floor(SR * 0.05), Math.floor(SR * 0.11)), `${kit.id} kick`).toBeLessThan(160);
      const h = renderDrum(SR, kit.id, "hat");
      expect(pitch(h, 0, Math.floor(SR * 0.02)), `${kit.id} hat`).toBeGreaterThan(3000);
    }
  });

  it("the 808 kick booms longer than the vintage box thud", () => {
    expect(renderDrum(SR, "808", "kick").length).toBeGreaterThan(renderDrum(SR, "box", "kick").length * 2);
  });

  it("decay makes a sound longer, tune makes it higher", () => {
    for (const id of DRUM_IDS) expect(renderDrum(SR, "808", id, { decay: 1 }).length, id).toBeGreaterThan(renderDrum(SR, "808", id, { decay: 0 }).length);
    const win = [Math.floor(SR * 0.06), Math.floor(SR * 0.14)] as const;
    const lo = pitch(renderDrum(SR, "808", "tom", { tune: -7, tone: 0 }), ...win);
    const hi = pitch(renderDrum(SR, "808", "tom", { tune: 7, tone: 0 }), ...win);
    expect(hi / lo).toBeGreaterThan(1.8);
    expect(hi / lo).toBeLessThan(2.7);
  });

  it("open hat rings on after the closed hat has gone", () => {
    const at = Math.floor(SR * 0.2);
    expect(rms(renderDrum(SR, "808", "open"), at, at + 2000)).toBeGreaterThan(0.01);
    expect(renderDrum(SR, "808", "hat").length).toBeLessThan(at);
  });

  it("the lo-fi kit is 8-bit", () => {
    const d = renderDrum(SR, "lofi", "snare");
    const levels = new Set(Array.from(d.slice(0, Math.floor(d.length * 0.8)), (x) => Math.round(x * 1e4)));
    expect(levels.size).toBeLessThanOrEqual(260);
  });
});

describe("rhythm library", () => {
  it("has a big, well-formed library", () => {
    expect(BEAT_LIBRARY.length).toBeGreaterThanOrEqual(80);
    expect(new Set(BEAT_LIBRARY.map((p) => p.id)).size).toBe(BEAT_LIBRARY.length);
    for (const g of BEAT_GROUPS) expect(BEAT_LIBRARY.filter((p) => p.group === g.id).length, g.name).toBeGreaterThanOrEqual(8);
    for (const p of BEAT_LIBRARY) {
      expect(Number.isInteger(barBeats(p)), p.name).toBe(true);
      expect(p.bpm).toBeGreaterThanOrEqual(40);
      expect(p.bpm).toBeLessThanOrEqual(200);
      let hits = 0;
      for (const id of DRUM_IDS) {
        expect(p.rows[id], `${p.name} ${id}`).toMatch(new RegExp(`^[0-3]{${p.steps}}$`));
        hits += p.rows[id].replace(/0/g, "").length;
      }
      expect(hits, p.name).toBeGreaterThanOrEqual(3);
    }
  });

  it("no two rhythms in a style are identical", () => {
    for (const g of BEAT_GROUPS) {
      const sigs = BEAT_LIBRARY.filter((p) => p.group === g.id).map((p) => JSON.stringify([p.steps, p.div, p.swing, p.rows]));
      expect(new Set(sigs).size, g.name).toBe(sigs.length);
    }
  });

  it("editing steps", () => {
    let b = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Motorik")!);
    expect(b.on).toBe(true);
    expect(b.edited).toBe(false);
    expect(levelAt(b.rows, "kick", 0)).toBe(2);
    b = setStep(b, "kick", 0, 0);
    expect(levelAt(b.rows, "kick", 0)).toBe(0);
    expect(b.edited).toBe(true);
    b = setStep(b, "bell", 3, 3);
    expect(b.rows.bell).toBe("0003000000000000");
    expect(setStep(b, "bell", 3, 3)).toBe(b); // no change, same object
    expect(setStep(b, "bell", 99, 2)).toBe(b);
    expect(Object.values(clearBeat(b).rows).join("")).toMatch(/^0+$/);
    expect(BEAT_LIBRARY.find((p) => p.name === "Motorik")!.rows.kick[0]).toBe("2"); // library untouched
  });

  it("vary changes a little, not everything", () => {
    const base = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    for (let seed = 1; seed < 30; seed++) {
      const v = varyBeat(base, drumRng(seed));
      let diff = 0;
      for (const id of DRUM_IDS) for (let i = 0; i < base.steps; i++) if (v.rows[id][i] !== base.rows[id][i]) diff++;
      expect(diff).toBeGreaterThanOrEqual(1);
      expect(diff).toBeLessThanOrEqual(6);
      expect(levelAt(v.rows, "kick", 0)).toBe(2); // the downbeat survives
    }
  });

  it("swing delays every second 16th, up to a triplet", () => {
    expect(stepBeat(1, 4, 0)).toBeCloseTo(0.25);
    expect(stepBeat(1, 4, 1)).toBeCloseTo(1 / 3);
    expect(stepBeat(2, 4, 1)).toBeCloseTo(0.5);
    expect(stepBeat(1, 3, 1)).toBeCloseTo(1 / 3); // triplet grids are not swung
  });

  it("lists hits across bars", () => {
    const b = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    const hits = beatHits(b, 8);
    expect(hits.filter((h) => h.id === "kick").map((h) => h.beat)).toEqual([0, 2, 4, 6]);
    expect(hits.filter((h) => h.id === "snare").map((h) => h.beat)).toEqual([1, 3, 5, 7]);
    expect(beatHits({ ...b, mutes: ["kick"] }, 8).some((h) => h.id === "kick")).toBe(false);
    const waltz = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Waltz")!);
    expect(barBeats(waltz)).toBe(3);
    expect(beatHits(waltz, 6).filter((h) => h.id === "kick").map((h) => h.beat)).toEqual([0, 3]);
  });

  it("revives stored beats safely", () => {
    expect(reviveBeat(undefined)).toBeUndefined();
    expect(reviveBeat({ steps: 16 })).toBeUndefined();
    const r = reviveBeat({ steps: 16, div: 4, rows: { kick: "2xx2" }, on: true })!;
    expect(r.rows.kick).toBe("2002000000000000");
    expect(r.rows.snare).toHaveLength(16);
    expect(r.kit).toBe("box");
  });
});

describe("MIDI with drums", () => {
  const items = [{ midi: [40, 47, 52, 56, 59, 64], beats: 4 }, { midi: [45, 52, 57, 61, 64, null], beats: 4 }];
  const count = (bytes: Uint8Array, status: number, note: number) => {
    let n = 0;
    for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === status && bytes[i + 1] === note && bytes[i + 2] > 0 && bytes[i + 2] < 128) n++;
    return n;
  };

  it("adds a drum track on channel 10", () => {
    const beat = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    const plain = progressionToMidi(items, 100, "ring", "t");
    const withDrums = progressionToMidi(items, 100, "ring", "t", beat);
    expect(plain[9]).toBe(0); // format 0, one track
    expect([withDrums[9], withDrums[11]]).toEqual([1, 2]); // format 1, two tracks
    expect(count(withDrums, 0x99, GM_DRUM.kick)).toBe(4);
    expect(count(withDrums, 0x99, GM_DRUM.snare)).toBe(4);
    expect(count(withDrums, 0x99, GM_DRUM.hat)).toBe(16);
    // a beat that is switched off is left out
    expect(progressionToMidi(items, 100, "ring", "t", { ...beat, on: false })).toEqual(plain);
  });

  it("exports four bars of the beat when there are no chords", () => {
    const beat = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    expect(count(progressionToMidi([], 100, "ring", "t", beat), 0x99, GM_DRUM.kick)).toBe(8);
  });
});

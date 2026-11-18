import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT } from "./beats";
import { STYLES, STYLE_GROUPS, getStyle, hasStyle, itemNotes, meterOf, styleBar, styleNotes } from "./patterns";

// C major as a guitarist holds it: x32010, and the strings it uses
const C = [null, 48, 52, 55, 60, 64];
const G = [43, 47, 50, 55, 59, 67];
const D = [null, null, 50, 57, 62, 66];
const at = (ev: ReturnType<typeof styleNotes>, beat: number) => ev.filter((e) => Math.abs(e.beat - beat) < 1e-6);
const midis = (ev: ReturnType<typeof styleNotes>) => ev.map((e) => e.midi);

describe("the style library", () => {
  it("is large, grouped, and every style is well formed", () => {
    expect(STYLES.length).toBeGreaterThanOrEqual(95);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    expect(new Set(STYLES.map((s) => s.name)).size).toBe(STYLES.length);
    for (const g of STYLE_GROUPS) expect(STYLES.filter((s) => s.group === g.id).length, g.id).toBeGreaterThanOrEqual(5);
    for (const s of STYLES) {
      expect(STYLE_GROUPS.some((g) => g.id === s.group), s.id).toBe(true);
      expect(s.hint.length, s.id).toBeGreaterThan(10);
      expect(s.four || s.three, s.id).toBeTruthy();
      // every bar is exactly as many steps long as its metre says, and uses only known symbols
      for (const [bars, beats] of [[s.four, 4], [s.three, 3]] as const)
        for (const bar of bars ?? []) {
          const steps = bar.trim().split(/\s+/);
          expect(steps.length, `${s.id}: ${bar}`).toBe(beats * s.div);
          for (const t of steps) expect(t, `${s.id}: ${t}`).toMatch(/^(\.|[DUXSsHhKRLTGgpqrima1-9]+[<>]?)$/);
        }
    }
  });
  it("names nothing after a player or a song", () => {
    const text = STYLES.map((s) => `${s.name} ${s.hint}`).join(" ");
    expect(text).not.toMatch(/travis|carter|alberti|giuliani|radiohead|beach house|florence/i);
  });
  it("keeps the five styles older ideas were saved with", () => {
    for (const id of ["ring", "strum", "pulse", "arpeggio", "travis"]) expect(hasStyle(id), id).toBe(true);
    expect(hasStyle("nonsense")).toBe(false);
    expect(getStyle("nonsense").id).toBe("ring");
  });
  it("knows which styles are waltzes", () => {
    expect(styleBar("strum")).toBe(4);
    expect(styleBar("waltz")).toBe(3);
  });
});

describe("playing a style", () => {
  it("the island strum is down, down-up, up-down-up", () => {
    const ev = styleNotes(C, 4, "strum");
    const starts = [...new Set(ev.map((e) => e.beat))];
    expect(starts).toEqual([0, 1, 1.5, 2.5, 3, 3.5]);
    // a down-strum runs low to high across every string; an up-strum comes back down the top four
    expect(midis(at(ev, 0))).toEqual([48, 52, 55, 60, 64]);
    expect(midis(at(ev, 1.5))).toEqual([64, 60, 55, 52]);
    // strings sound one after another, the first one loudest, and ups are softer than downs
    const down = at(ev, 0);
    expect(down[1].delay).toBeGreaterThan(0);
    expect(down[4].delay).toBeLessThan(0.05);
    expect(down[0].velocity).toBeGreaterThan(down[4].velocity);
    expect(at(ev, 1.5)[0].velocity).toBeLessThan(down[0].velocity);
  });

  it("the alternating thumb keeps the beat on the two bass strings", () => {
    // root on the 5th string: thumb on 5 and 4, fingers on 3, 2 and 1
    const ev = styleNotes(C, 4, "travis");
    expect(ev.map((e) => [e.beat, e.midi])).toEqual([[0, 48], [1, 52], [1.5, 60], [2, 48], [2.5, 55], [3, 52]]);
    // root on the 6th string: thumb on 6 and 4
    expect(midis(styleNotes(G, 4, "travis")).filter((_, i) => [0, 1, 3, 5].includes(i))).toEqual([43, 50, 43, 50]);
    // a four-string chord: thumb on 4 and 3, so the fingers move up to 2 and 1
    expect(midis(styleNotes(D, 4, "travis"))).toEqual([50, 57, 66, 50, 62, 57]);
  });

  it("a pinch is two notes at the same instant", () => {
    const first = at(styleNotes(C, 4, "pinch"), 0);
    expect(midis(first)).toEqual([48, 60]);
    expect(first.every((e) => e.delay === 0)).toBe(true);
  });

  it("a harpist's rolled chord climbs slowly and swells to the top", () => {
    const ev = styleNotes(C, 4, "ring");
    expect(midis(ev)).toEqual([48, 52, 55, 60, 64]);
    expect(ev[4].delay).toBeGreaterThan(0.1);
    expect(ev[4].velocity).toBeGreaterThan(ev[0].velocity);
    expect(styleNotes(C, 4, "slowroll")[4].delay).toBeGreaterThan(ev[4].delay * 2);
    expect(midis(styleNotes(C, 4, "rolldown"))).toEqual([64, 60, 55, 52, 48]);
  });

  it("a cascade and a glissando carry on past the top string into the next octave", () => {
    const up = midis(styleNotes(C, 4, "cascade"));
    expect(up.slice(0, 9)).toEqual([48, 52, 55, 60, 64, 60, 64, 67, 72]);
    expect(midis(styleNotes(C, 4, "gliss")).at(-1)).toBe(48 + 24);
  });

  it("muted strums and stabs are cut short; everything else rings", () => {
    const chuck = at(styleNotes(C, 4, "chuck"), 1);
    expect(chuck.length).toBeGreaterThan(0);
    expect(chuck.every((e) => e.cut !== undefined && e.cut < 0.08)).toBe(true);
    expect(styleNotes(C, 4, "skank").every((e) => e.cut !== undefined)).toBe(true);
    expect(styleNotes(C, 4, "strum").every((e) => e.length === Infinity && e.cut === undefined)).toBe(true);
  });

  it("accents are louder, soft strokes quieter", () => {
    const ev = styleNotes(C, 4, "drive");
    expect(at(ev, 1)[0].velocity).toBeGreaterThan(at(ev, 0.5)[0].velocity * 1.5);
  });
});

describe("styles follow the bar, not the chord", () => {
  it("two chords sharing a bar share one pass of the pattern", () => {
    // D . D U | . U D U, with the chord changing at beat 3
    const first = styleNotes(C, 2, "strum", 0, { bar: 4 });
    const second = styleNotes(G, 2, "strum", 2, { bar: 4 });
    expect([...new Set(first.map((e) => e.beat))]).toEqual([0, 1, 1.5]);
    // the hand would rest on beat 3: the new chord is strummed there anyway, so the change is heard
    expect([...new Set(second.map((e) => e.beat))]).toEqual([0, 0.5, 1, 1.5]);
    expect(midis(at(second, 0))).toEqual(G);
  });
  it("a chord that arrives mid-pattern in a picked style starts on its bass note", () => {
    // p . q m | p i q . : the second chord lands on a "q" step
    const ev = styleNotes(G, 3, "travis", 1, { bar: 4 });
    expect(ev[0]).toMatchObject({ beat: 0, midi: 43 });
  });
  it("styles made of off-beats stay silent on the beat, even when a chord starts there", () => {
    expect(styleNotes(C, 2, "chops", 2, { bar: 4 }).every((e) => e.beat % 1 === 0.5)).toBe(true);
  });
  it("a chord that starts between two steps is still heard at once", () => {
    const ev = styleNotes(C, 1.5, "pima", 0.125, { bar: 4 });
    expect(ev[0].beat).toBe(0);
  });
  it("half-beat chords and long chords both work", () => {
    expect(styleNotes(C, 0.5, "strum", 3.5, { bar: 4 }).length).toBeGreaterThan(0);
    const long = styleNotes(C, 16, "strum");
    expect(Math.max(...long.map((e) => e.beat))).toBe(15.5);
    // every bar of a long chord is the same pattern
    expect(at(long, 13.5).length).toBe(at(long, 1.5).length);
  });
  it("two-bar styles alternate their bars", () => {
    const ev = styleNotes(C, 8, "bossa");
    const bar1 = [...new Set(ev.filter((e) => e.beat < 4).map((e) => e.beat))];
    const bar2 = [...new Set(ev.filter((e) => e.beat >= 4).map((e) => e.beat - 4))];
    expect(bar1).toEqual([0, 1.5, 2, 3]);
    expect(bar2).toEqual([0, 1, 2, 2.5]);
  });
  it("in a bar of three a style uses its waltz form", () => {
    const ev = styleNotes(C, 6, "boomchick", 0, { bar: 3 });
    // bass, chick, chick; then the other bass note in the next bar
    expect(at(ev, 0).map((e) => e.midi)).toEqual([48]);
    expect(at(ev, 3).map((e) => e.midi)).toEqual([52]);
    expect(at(ev, 1).length).toBeGreaterThan(2);
  });
  it("in 6/8 and 12/8 straight eighths bend into the triplet feel", () => {
    const ev = styleNotes(C, 2, "eighths", 0, { bar: 2, triplet: true });
    expect([...new Set(ev.map((e) => +e.beat.toFixed(3)))]).toEqual([0, 0.667, 1, 1.667]);
  });
  it("sixteenth-note styles follow the drums' swing; eighth-note styles stay put", () => {
    const straight = styleNotes(C, 1, "pima", 0, { bar: 4 });
    const swung = styleNotes(C, 1, "pima", 0, { bar: 4, swing: 1 });
    expect(straight.map((e) => e.beat)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(swung[1].beat).toBeCloseTo(1 / 3);
    expect(swung[2].beat).toBe(0.5);
    expect(styleNotes(C, 1, "eighths", 0, { bar: 4, swing: 1 }).some((e) => e.beat === 0.5)).toBe(true);
  });
  it("the shuffle leans back by itself", () => {
    expect([...new Set(styleNotes(C, 1, "lightswing").map((e) => +e.beat.toFixed(2)))]).toEqual([0]);
    expect([...new Set(styleNotes(C, 2, "lightswing").map((e) => +e.beat.toFixed(2)))]).toEqual([0, 1, 1.6]);
  });
  it("takes its bar from the song's time signature; the drums add their swing and their shuffle", () => {
    // on its own (no song around it), a style falls back on its own bar, or the drums' when they are on
    expect(meterOf(null)).toMatchObject({ bar: 0, triplet: false });
    expect(meterOf({ ...DEFAULT_BEAT, on: false })).toMatchObject({ bar: 0 });
    expect(meterOf({ ...DEFAULT_BEAT, on: true, steps: 12, div: 4, swing: 0.5 })).toEqual({ bar: 3, triplet: false, swing: 0.5 });
    expect(meterOf({ ...DEFAULT_BEAT, on: true, steps: 6, div: 3 })).toMatchObject({ bar: 2, triplet: true });
    // in a song, the time signature decides, drums on or off
    expect(meterOf({ ...DEFAULT_BEAT, on: false }, { bar: 3 })).toMatchObject({ bar: 3, triplet: false });
    expect(meterOf(null, { bar: 2, triplet: true })).toMatchObject({ bar: 2, triplet: true });
    // a triplet drum grid in 4/4 is a shuffle: the styles lean with it
    expect(meterOf({ ...DEFAULT_BEAT, on: true, steps: 12, div: 3 }, { bar: 4 })).toMatchObject({ bar: 4, triplet: true });
    // a style restarts on the song's bar lines even with the drums off (a 4-beat pattern in 3/4)
    const three = itemNotes([{ midi: C, beats: 6, meter: { bar: 3 } }], "strum");
    const starts = (from: number) => three.filter((n) => n.e.beat >= from && n.e.beat < from + 3).map((n) => +(n.e.beat - from).toFixed(3));
    expect(starts(0)).toEqual(starts(3));
  });
  it("a song gives each section its own style, and each section starts its pattern afresh", () => {
    const items = [
      { midi: C, beats: 4, style: "ring", section: true },
      { midi: G, beats: 2, style: "pima", section: true },
      { midi: C, beats: 2, style: "pima" },
    ];
    const all = itemNotes(items, "strum");
    expect(all.filter((n) => n.item === 0).length).toBe(5);
    expect(all.filter((n) => n.item === 1).length).toBe(8);
    // the third chord carries on the second's pattern (it starts 2 beats into that section)
    expect(all.filter((n) => n.item === 2)[0]).toMatchObject({ at: 6 });
    expect(itemNotes([{ midi: C, beats: 4 }], "strum").length).toBe(styleNotes(C, 4, "strum").length);
  });
  it("is the same every time", () => {
    for (const s of STYLES) expect(styleNotes(C, 8, s.id, 0, { bar: 4 })).toEqual(styleNotes(C, 8, s.id, 0, { bar: 4 }));
  });
  it("copes with any chord: one string, two, three, six", () => {
    for (const s of STYLES)
      for (const chord of [[null, null, null, null, 60, null], [null, null, null, 55, 60, null], [null, null, 52, 55, 60, null], G]) {
        const ev = styleNotes(chord, 4, s.id, 0, { bar: s.four ? 4 : 3 });
        expect(ev.every((e) => Number.isFinite(e.midi) && e.midi >= 36 && e.midi <= 100 && e.velocity > 0 && e.velocity <= 1 && e.delay >= 0), s.id).toBe(true);
      }
    expect(styleNotes([null, null, null, null, null, null], 4, "strum")).toEqual([]);
  });
});

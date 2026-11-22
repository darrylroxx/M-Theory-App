import { describe, expect, it } from "vitest";
import type { Key } from "../theory/keys";
import { GRID_HIGH, GRID_LOW, gridRows, melodyBase, melodyRows } from "./melody";

const KEYS: Key[] = [
  { tonic: "C", scaleId: "ionian" },
  { tonic: "B", scaleId: "ionian" },
  { tonic: "F#", scaleId: "aeolian" },
  { tonic: "A", scaleId: "dorian" },
];

describe("gridRows", () => {
  it("two octaves from the home note are the rows the melody grid always had", () => {
    for (const key of KEYS) {
      expect(gridRows(key, melodyBase(key), 2)).toEqual(melodyRows(key));
      expect(gridRows(key, melodyBase(key), 2, true)).toEqual(melodyRows(key, true));
    }
  });
  it("a bass grid starts two octaves lower, on the same home note", () => {
    for (const key of KEYS) {
      const rows = gridRows(key, melodyBase(key) - 24, 2);
      expect(rows.length).toBe(25);
      expect(rows[rows.length - 1].midi).toBe(melodyBase(key) - 24);
      expect(rows[0].midi).toBe(melodyBase(key));
      expect(rows[rows.length - 1].home).toBe(true);
      // the same names and marks as the melody's rows, two octaves down
      expect(rows.map((r) => ({ ...r, midi: r.midi + 24 }))).toEqual(melodyRows(key));
    }
  });
  it("key only hides the same rows", () => {
    for (const key of KEYS) {
      const all = gridRows(key, melodyBase(key) - 24, 2);
      const only = gridRows(key, melodyBase(key) - 24, 2, true);
      expect(only).toEqual(all.filter((r) => r.inKey));
      expect(only.map((r) => r.midi + 24)).toEqual(melodyRows(key, true).map((r) => r.midi));
    }
  });
  it("the rows are highest first, and stay inside what a stored melody may hold", () => {
    const key = KEYS[0];
    const rows = gridRows(key, GRID_LOW, 7);
    expect(rows[0].midi).toBe(GRID_HIGH);
    expect(rows[rows.length - 1].midi).toBe(GRID_LOW);
    expect(rows.length).toBe(GRID_HIGH - GRID_LOW + 1);
    expect(gridRows(key, 12, 1)[0].midi).toBe(24);
    expect(gridRows(key, 100, 3)[0].midi).toBe(GRID_HIGH);
  });
});

describe("gridRows over seven octaves (the grid of the Melody and Bass composer)", () => {
  it("has every note from C1 to C8, highest first, in any key", () => {
    for (const key of KEYS) {
      const rows = gridRows(key, GRID_LOW, 7);
      expect(rows.length).toBe(85);
      expect(rows.map((r) => r.midi)).toEqual(Array.from({ length: 85 }, (_, i) => 108 - i));
      expect([GRID_LOW, GRID_HIGH]).toEqual([24, 108]);
      // more octaves than there are change nothing
      expect(gridRows(key, GRID_LOW, 9)).toEqual(rows);
    }
  });
  it("the two octaves the melody grid always had are in it, the same rows", () => {
    for (const key of KEYS) {
      const rows = gridRows(key, GRID_LOW, 7);
      const base = melodyBase(key);
      expect(rows.filter((r) => r.midi >= base && r.midi <= base + 24)).toEqual(melodyRows(key));
      // and the two octaves a bass was given under them
      expect(rows.filter((r) => r.midi >= base - 24 && r.midi <= base)).toEqual(gridRows(key, base - 24, 2));
    }
  });
  it("key only hides the rows outside the scale in every octave", () => {
    for (const key of KEYS) {
      const all = gridRows(key, GRID_LOW, 7);
      const only = gridRows(key, GRID_LOW, 7, true);
      expect(only).toEqual(all.filter((r) => r.inKey));
      // seven notes to the octave, in each of the seven octaves (and the notes of the scale that fall on the last row or under the first home note)
      for (let low = GRID_LOW; low < GRID_HIGH; low += 12) expect(only.filter((r) => r.midi >= low && r.midi < low + 12).length, `${key.tonic} from ${low}`).toBe(7);
      // the same notes of the scale in every octave
      const pcs = (low: number) => only.filter((r) => r.midi >= low && r.midi < low + 12).map((r) => r.midi % 12).sort((a, b) => a - b);
      for (let low = GRID_LOW + 12; low < GRID_HIGH; low += 12) expect(pcs(low)).toEqual(pcs(GRID_LOW));
    }
  });
  it("the home note's rows are flagged, one in every octave, so the octaves can be told apart", () => {
    for (const key of KEYS) {
      const homes = gridRows(key, GRID_LOW, 7).filter((r) => r.home).map((r) => r.midi);
      // (C has eight: the lowest and the highest row are both a C)
      expect(homes.length).toBe(key.tonic === "C" ? 8 : 7);
      expect(homes.every((m) => (m - melodyBase(key)) % 12 === 0)).toBe(true);
      for (let i = 1; i < homes.length; i++) expect(homes[i - 1] - homes[i]).toBe(12);
      // the home rows stay when only the key's rows are shown
      expect(gridRows(key, GRID_LOW, 7, true).filter((r) => r.home).map((r) => r.midi)).toEqual(homes);
    }
  });
});

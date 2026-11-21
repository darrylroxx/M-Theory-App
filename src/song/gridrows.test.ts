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

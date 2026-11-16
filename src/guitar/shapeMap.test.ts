import { describe, expect, it } from "vitest";
import { getChordType } from "../theory/chords";
import { POSITIONS, buildShapeMap, positionOf } from "./shapeMap";
import { getTuning } from "./tunings";
import { generateVoicings, voicingText } from "./voicings";

const std = getTuning("standard");
const C = getChordType("maj");
const all = generateVoicings(0, C, { tuning: std });
const any = { strings: "any" as const, noBarre: false, open: false };
const texts = (cell: { frets: (number | null)[] }[]) => cell.map(voicingText);

describe("shape map", () => {
  it("rows are the bass notes in chord order: root, 3rd, 5th", () => {
    expect(buildShapeMap(all, C, any).map((r) => r.token)).toEqual(["1", "3", "5"]);
    expect(buildShapeMap(generateVoicings(0, getChordType("7"), { tuning: std }), getChordType("7"), any).map((r) => r.token)).toEqual(["1", "3", "5", "b7"]);
  });
  it("columns run up the neck", () => {
    const rows = buildShapeMap(all, C, any);
    expect(rows[0].cells.length).toBe(POSITIONS.length);
    expect(texts(rows[0].cells[0])[0]).toBe("x32010"); // open C is the first thing you see
    expect(texts(rows[0].cells[1])).toContain("x35553"); // A-shape barre at fret 3
    expect(texts(rows[0].cells[3])).toContain("8-10-10-9-8-8"); // E-shape barre at fret 8
    for (const row of rows) row.cells.forEach((cell, ci) => cell.forEach((v) => expect(positionOf(v)).toBe(ci)));
    // every shape in a row really has that note in the bass
    for (const row of rows) for (const cell of row.cells) for (const v of cell) expect(v.bassToken).toBe(row.token);
  });
  it("shows each grip once unless a size is chosen", () => {
    const openRoot = texts(buildShapeMap(all, C, any)[0].cells[0]);
    expect(openRoot).toContain("x32010");
    expect(openRoot).not.toContain("x3201x"); // same grip, one string left out
    expect(openRoot).not.toContain("x320xx");
    const three = texts(buildShapeMap(all, C, { ...any, strings: 3 })[0].cells[0]);
    expect(three).toContain("x320xx");
    const total = (rows: ReturnType<typeof buildShapeMap>) => rows.reduce((n, r) => n + r.cells.reduce((m, c) => m + c.length, 0), 0);
    expect(total(buildShapeMap(all, C, any))).toBeLessThan(all.length / 2);
  });
  it("filters: no barre, open strings, and the shape in use is never hidden", () => {
    const noBarre = buildShapeMap(all, C, { ...any, noBarre: true });
    for (const row of noBarre) for (const cell of row.cells) for (const v of cell) expect(v.barreKind).not.toBe("full");
    const kept = buildShapeMap(all, C, { ...any, noBarre: true }, "x,3,5,5,5,3");
    expect(texts(kept[0].cells[1])).toContain("x35553");
    const open = buildShapeMap(all, C, { ...any, open: true });
    for (const row of open) for (const cell of row.cells) for (const v of cell) expect(v.openStrings).toBeGreaterThan(0);
  });
});

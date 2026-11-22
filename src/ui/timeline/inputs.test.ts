import { describe, expect, it } from "vitest";
import { engineInputs, hasInput, inputCount, inputLines, inputName, metersOf, sameInput } from "./inputs";

describe("how many inputs a track's input is chosen from", () => {
  it("the open interface's count; else the chosen interface's from the list; else what was remembered; else two", () => {
    expect(inputCount({ opened: 8, device: 18, remembered: 2 })).toBe(8);
    expect(inputCount({ opened: null, device: 18, remembered: 2 })).toBe(18);
    expect(inputCount({ device: undefined, remembered: 4 })).toBe(4);
    expect(inputCount({})).toBe(2);
    // (a count that says nothing is passed over)
    expect(inputCount({ opened: 0, device: NaN, remembered: 6 })).toBe(6);
  });
});

describe("the list of inputs", () => {
  const labels = (count: number, now?: Parameters<typeof inputLines>[1]) => {
    const l = inputLines(count, now);
    return { singles: l.singles.map((x) => x.label + (x.missing ? " (not there)" : "") + (x.on ? " ✓" : "")), pairs: l.pairs.map((x) => x.label + (x.missing ? " (not there)" : "") + (x.on ? " ✓" : "")) };
  };

  it("offers every input, and every pair of neighbours: 1+2, 3+4 …", () => {
    expect(labels(8)).toEqual({
      singles: ["In 1 ✓", "In 2", "In 3", "In 4", "In 5", "In 6", "In 7", "In 8"],
      pairs: ["In 1+2", "In 3+4", "In 5+6", "In 7+8"],
    });
    expect(inputLines(8, undefined).pairs.map((p) => p.input)).toEqual([{ ch: 0, pair: true }, { ch: 2, pair: true }, { ch: 4, pair: true }, { ch: 6, pair: true }]);
    // two inputs: both, and the one pair
    expect(labels(2, { ch: 1 })).toEqual({ singles: ["In 1", "In 2 ✓"], pairs: ["In 1+2"] });
    // an odd last input has no pair; one input has none at all
    expect(labels(3).pairs).toEqual(["In 1+2"]);
    expect(labels(1)).toEqual({ singles: ["In 1 ✓"], pairs: [] });
    // many inputs: all of them
    expect(inputLines(18, undefined).singles).toHaveLength(18);
    expect(inputLines(18, undefined).pairs).toHaveLength(9);
  });

  it("marks the track's choice, a pair as a pair", () => {
    expect(labels(8, { ch: 4 }).singles[4]).toBe("In 5 ✓");
    const paired = labels(8, { ch: 2, pair: true });
    expect(paired.pairs).toEqual(["In 1+2", "In 3+4 ✓", "In 5+6", "In 7+8"]);
    // (input 3 on its own is not the pair 3+4)
    expect(paired.singles.some((s) => s.includes("✓"))).toBe(false);
  });

  it("a saved choice beyond the count is listed and marked not there, never changed", () => {
    expect(labels(2, { ch: 4 }).singles).toEqual(["In 1", "In 2", "In 5 (not there) ✓"]);
    const l = inputLines(2, { ch: 4 });
    expect(l.singles[2]).toEqual({ input: { ch: 4 }, label: "In 5", on: true, missing: true });
    // a pair the interface does not have, or has only half of
    expect(labels(2, { ch: 2, pair: true }).pairs).toEqual(["In 1+2", "In 3+4 (not there) ✓"]);
    expect(labels(3, { ch: 2, pair: true }).pairs).toEqual(["In 1+2", "In 3+4 (not there) ✓"]);
    // a pair that does not start on an odd input (it cannot be picked here, but a stored idea may have it): listed as it is
    expect(labels(8, { ch: 1, pair: true }).pairs).toEqual(["In 1+2", "In 3+4", "In 5+6", "In 7+8", "In 2+3 ✓"]);
  });

  it("says which inputs an interface has", () => {
    expect(hasInput({ ch: 7 }, 8)).toBe(true);
    expect(hasInput({ ch: 8 }, 8)).toBe(false);
    expect(hasInput({ ch: 6, pair: true }, 8)).toBe(true);
    expect(hasInput({ ch: 7, pair: true }, 8)).toBe(false);
    expect(hasInput(undefined, 1)).toBe(true);
  });
});

describe("a choice of input", () => {
  it("is named as the list names it", () => {
    expect(inputName(undefined)).toBe("In 1");
    expect(inputName({ ch: 4 })).toBe("In 5");
    expect(inputName({ ch: 2, pair: true })).toBe("In 3+4");
  });

  it("is the same as another when it is the same input, or the same pair", () => {
    expect(sameInput(undefined, { ch: 0 })).toBe(true);
    expect(sameInput({ ch: 2 }, { ch: 2, pair: true })).toBe(false);
    expect(sameInput({ ch: 2, pair: true }, { ch: 2, pair: true })).toBe(true);
  });

  it("is told to the engine as one input, or as the left and right of a pair, counted from 0", () => {
    // (one input: nothing is said of a second, exactly as before)
    expect(engineInputs(undefined)).toEqual({ input: 0 });
    expect(engineInputs({ ch: 4 })).toEqual({ input: 4 });
    expect("inputB" in engineInputs({ ch: 4 })).toBe(false);
    expect(engineInputs({ ch: 2, pair: true })).toEqual({ input: 2, inputB: 3 });
  });

  it("shows the level of its input, or of both inputs of a pair", () => {
    expect(metersOf({ ch: 4 })).toEqual([4]);
    expect(metersOf({ ch: 2, pair: true })).toEqual([2, 3]);
  });
});

import { describe, expect, it } from "vitest";
import { dbOf, haloOf, meterPos } from "./levels";

describe("input levels", () => {
  it("read in dB below full scale", () => {
    expect(dbOf(1)).toBe(0);
    expect(dbOf(0.5)).toBeCloseTo(-6.02, 2);
    expect(dbOf(0)).toBe(-Infinity);
  });
  it("coloured like the interface's halos: green from −24, amber from −6, red at full scale", () => {
    expect(haloOf(-40)).toBe("off");
    expect(haloOf(-24)).toBe("green");
    expect(haloOf(-12)).toBe("green");
    expect(haloOf(-6)).toBe("amber");
    expect(haloOf(-0.1)).toBe("red");
  });
  it("placed on a −60 to 0 dB meter, with the −24 and −6 marks where the page draws them", () => {
    expect(meterPos(-Infinity)).toBe(0);
    expect(meterPos(-24)).toBeCloseTo(0.6);
    expect(meterPos(-6)).toBeCloseTo(0.9);
    expect(meterPos(3)).toBe(1);
  });
});

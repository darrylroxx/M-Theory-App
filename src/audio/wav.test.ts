import { describe, expect, it } from "vitest";
import { encodeWav, safeGain, trimEnd } from "./wav";

describe("song as WAV", () => {
  it("writes a 24-bit stereo WAV that reads back to the same samples", () => {
    const l = new Float32Array([0, 0.5, -0.5, 1]);
    const r = new Float32Array([0.25, -1, 0, 0]);
    const b = encodeWav([l, r], 48000);
    const v = new DataView(b.buffer);
    expect(String.fromCharCode(...b.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...b.slice(8, 12))).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 3);
    expect(b.length).toBe(44 + 24);
    const at = (i: number) => {
      const o = 44 + i * 3;
      const x = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      return (x & 0x800000 ? x - 0x1000000 : x) / 0x800000;
    };
    expect(at(2)).toBeCloseTo(0.5, 5); // L, frame 1
    expect(at(3)).toBeCloseTo(-1, 5); // R, frame 1
    expect(at(6)).toBeCloseTo(1, 4); // L, frame 3: full scale, no wrap-around
  });

  it("cuts the silence at the end but keeps the reverb tail", () => {
    const d = new Float32Array(48000 * 3);
    d[1000] = 0.5;
    d[48000] = 0.001; // a quiet tail at one second
    const [t] = trimEnd([d], 48000);
    expect(t.length).toBe(48001 + 12000);
    // the song's own quiet bars at the end are kept
    expect(trimEnd([d], 48000, 48000 * 2)[0].length).toBe(96000);
  });

  it("turns a mix that would clip down to just under full scale, and leaves the rest alone", () => {
    expect(safeGain([new Float32Array([0.5, -0.9])])).toBe(1);
    const g = safeGain([new Float32Array([0.2, -1.6])]);
    expect(1.6 * g).toBeCloseTo(0.966, 5);
  });
});

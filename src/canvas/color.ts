/** Colour arithmetic for paint: hex in, small natural variations out. */
import type { Rng } from "./rand";

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

/** Hue 0..360, saturation and lightness 0..1. */
export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, Math.min(1, s), l];
}
export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** How light a colour looks, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** How far apart two colours are in lightness: 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const css = ([r, g, b]: RGB, a = 1) => (a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);

/**
 * The same paint, never quite the same twice: a little warmer or cooler, a little lighter or
 * darker, as pigment is from one brush-load to the next.
 */
export function vary(hex: string, r: Rng, amount = 1): RGB {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const dh = (r() - 0.5) * 9 * amount;
  const ds = (r() - 0.5) * 0.12 * amount;
  const dl = (r() - 0.5) * 0.1 * amount;
  return hslToRgb(h + dh, Math.max(0, Math.min(1, s + ds)), Math.max(0.02, Math.min(0.98, l + dl)));
}

/** Lighter (amount > 0) or darker (amount < 0), keeping the hue. */
export function shade([r, g, b]: RGB, amount: number): RGB {
  const [h, s, l] = rgbToHsl([r, g, b]);
  return hslToRgb(h, s, Math.max(0, Math.min(1, l + amount)));
}

/** Part-way from one colour to another. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

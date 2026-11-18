/**
 * Each section has its own colour, the same everywhere it appears and wherever it is moved. It
 * is kept with the section as a number (0–7); a name is never read for it, so any name works.
 * (Given a name instead of a number, the colour comes from the whole name, the same every time.)
 */
export const letterClass = (color: number | string): string => {
  let n = 0;
  if (typeof color === "number") n = Math.floor(color);
  else for (const ch of color) n = (n * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return `L${((n % 8) + 8) % 8}`;
};

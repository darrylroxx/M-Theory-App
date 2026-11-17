/**
 * The frame of a section: how long it lasts.
 *
 * A section is as long as it is set to be, in bars. Whatever is shorter than the section comes
 * round again until the section is over; whatever is longer is cut off where the section ends.
 * A section that has not been given a length is as long as what is in it.
 */

export const MAX_SECTION_BARS = 32;
/** The lengths offered at a tap. */
export const QUICK_BARS = [1, 2, 4, 8, 12, 16, 24, 32];

/** A length someone asked for, made safe: whole bars, 1 to 32. Anything else means "not set". */
export function fitBars(n: unknown): number | undefined {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(MAX_SECTION_BARS, v) : undefined;
}

/**
 * How long a section with no set length lasts, in beats: its chords, played again until the
 * drum rhythm and the melody have both finished. With no chords, the longer of the two
 * (the melody rounded up to whole rounds of the rhythm).
 */
export function autoBeats(chordBeats: number, drumBeats: number, tuneBeats: number): number {
  if (chordBeats > 0) return Math.max(1, Math.ceil(Math.max(drumBeats, tuneBeats) / chordBeats - 1e-6)) * chordBeats;
  return tuneBeats && drumBeats ? Math.ceil(tuneBeats / drumBeats - 1e-6) * drumBeats : Math.max(drumBeats, tuneBeats);
}

/** How long a section lasts, in beats: what it is set to, or what is in it. */
export function frameBeats(bars: number | undefined, bar: number, chordBeats: number, drumBeats: number, tuneBeats: number): number {
  const set = fitBars(bars);
  return set ? set * bar : autoBeats(chordBeats, drumBeats, tuneBeats);
}

/**
 * Fill a section with its chords: they come round again until the section is over, and the one
 * sounding when it ends is cut short. `index` is the chord's place in the list given.
 */
export function frameItems<T extends { beats: number }>(once: T[], length: number): { item: T; index: number }[] {
  const out: { item: T; index: number }[] = [];
  if (!once.length || !(once.reduce((a, x) => a + x.beats, 0) > 0)) return out;
  let at = 0;
  for (let i = 0; at < length - 1e-6 && out.length < 4096; i++) {
    const item = once[i % once.length];
    const left = length - at;
    out.push({ item: left < item.beats - 1e-6 ? { ...item, beats: left } : item, index: i % once.length });
    at += item.beats;
  }
  return out;
}

/** "4", "2½", "1.3": a length in bars, as short as it can be written. */
export function barsText(beats: number, bar: number): string {
  const n = bar > 0 ? beats / bar : 0;
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  if (Math.abs((r % 1) - 0.5) < 1e-6) return `${Math.floor(r) || ""}½`;
  return r.toFixed(1);
}

/** One step shorter or longer than a length in beats, in whole bars. */
export function stepBars(beats: number, bar: number, dir: -1 | 1): number {
  const n = bar > 0 ? beats / bar : 1;
  const next = dir < 0 ? Math.ceil(n - 1e-6) - 1 : Math.floor(n + 1e-6) + 1;
  return Math.max(1, Math.min(MAX_SECTION_BARS, next));
}

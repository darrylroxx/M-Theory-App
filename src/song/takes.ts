/**
 * Takes. A recording is one continuous file from the first click of the count-in until Stop.
 * It is cut into takes, one per time round the loop (a pass), after moving it earlier by the
 * time the sound took to go out to the headphones and come back in through the mic. The loop
 * goes round for as long as the singer wants: passes marked ★ while singing are the keepers.
 */
export interface Take {
  id: string;
  /** "Take 3" */
  n: number;
  /** the recording it was cut from (takes of one recording are alternatives to each other) */
  group: string;
  /** the recording as sung, and the version with the vocal chain on it */
  dry: string;
  wet: string;
  rate: number;
  /** where the take starts in the file, and how long it is (frames). A first take can start a
   * moment before the file does (read as silence), so that every pass after it keeps its time. */
  start: number;
  frames: number;
  /** where it plays in the song: the section and the bar it starts on */
  at: { block: string; bar: number };
  /** a last pass stopped before half-way: kept, but not offered unless asked for */
  short?: boolean;
  /** the vocal chain settings the wet file was made with (`soundTag`; "" when it has none) */
  sound?: string;
  /** the tempo and key the song was in when it was sung (a recording does not follow later changes) */
  bpm?: number;
  key?: string;
  /** "4/4": the time signature of the section it was sung in */
  sig?: string;
  /** marked ★ while it was sung (or afterwards): a keeper */
  keep?: boolean;
}

/** What the engine reports when a recording stops. */
export interface Recorded {
  dry: string;
  wet: string;
  rate: number;
  frames: number;
  /** where the count-in's first frame lies in the file (the round trip, from the driver) */
  offset: number;
  count_in: number;
  loop_frames: number;
  dropped: number;
  /** samples of silence the file holds where voice was lost, so later passes keep their time */
  padded?: number;
  /** why the recording stopped taking sound early, or why it has no vocal sound on it */
  note?: string | null;
}

/**
 * Cut a recording into takes. `nudge` (frames) moves them further, for converters the driver
 * does not count. A last pass shorter than half the loop is marked short. Passes in `kept`
 * (numbered from 1, as they were sung) are marked as keepers.
 */
export function cutTakes(r: Recorded, o: { group: string; at: { block: string; bar: number }; nudge?: number; id: () => string; kept?: Iterable<number> }): Take[] {
  const loop = Math.max(1, r.loop_frames);
  // never moved up to the file's start: that would move every pass after it too
  const first = r.offset + (o.nudge ?? 0) + r.count_in;
  const kept = new Set(o.kept ?? []);
  const out: Take[] = [];
  for (let k = 0, start = first; start < r.frames; k++, start += loop) {
    const frames = Math.min(loop, r.frames - start);
    if (frames < r.rate * 0.05) break;
    out.push({ id: o.id(), n: k + 1, group: o.group, dry: r.dry, wet: r.wet, rate: r.rate, start, frames, at: o.at, ...(frames < loop / 2 ? { short: true } : {}), ...(kept.has(k + 1) ? { keep: true } : {}) });
  }
  return out;
}

/** The take that plays from a recording: the one chosen, else the last one marked ★, else the last full one. */
export function activeTake(takes: Take[], group: string, chosen?: string): Take | undefined {
  const mine = takes.filter((t) => t.group === group);
  const last = (ok: (t: Take) => boolean) => [...mine].reverse().find(ok);
  return mine.find((t) => t.id === chosen) ?? last((t) => !!t.keep) ?? last((t) => !t.short) ?? mine[mine.length - 1];
}

/** Where a recording is while it runs: in the count-in (null), or which pass is being sung (from 1) and how far into it (0..1). */
export function passAt(pos: number, countIn: number, length: number): { n: number; frac: number } | null {
  if (!(length > 0) || pos < countIn) return null;
  const into = pos - countIn;
  return { n: Math.floor(into / length) + 1, frac: (into % length) / length };
}

/**
 * The pass a key press marks: the one being sung, or, in the first moments of a pass, the one
 * that has just ended (a pass is known to be the one only once it is over). `grace` is that
 * moment, as a part of the pass.
 */
export function passToMark(at: { n: number; frac: number }, grace: number): number {
  return at.n > 1 && at.frac < grace ? at.n - 1 : at.n;
}

/** A set of passes with one of them marked or unmarked. */
export function toggled(marks: ReadonlySet<number>, n: number): Set<number> {
  const out = new Set(marks);
  if (out.has(n)) out.delete(n);
  else out.add(n);
  return out;
}

/**
 * The takes of one recording to list. A long session can leave hundreds, so only these show:
 * the keepers (★), the one that plays, and the newest few; the rest wait behind "+N". Short
 * last passes are left out unless asked for (or marked, or playing).
 */
export function shownTakes(takes: Take[], group: string, o: { active?: string; newest?: number; shorts?: boolean; all?: boolean } = {}): { shown: Take[]; more: number } {
  const mine = takes.filter((t) => t.group === group && (o.shorts || !t.short || t.keep || t.id === o.active));
  if (o.all) return { shown: mine, more: 0 };
  const newest = o.newest ?? 8;
  const shown = mine.filter((t, i) => t.keep || t.id === o.active || i >= mine.length - newest);
  return { shown, more: mine.length - shown.length };
}

/**
 * The click under a recording: how many beats each bar of the loop has (whole beats, at least
 * one, as the time signatures give them), and a count-in of `countIn` bars in the meter of the
 * loop's first bar, the one that comes straight after it. A loop that crosses from a 4/4
 * section into a 3/4 one clicks 4 then 3. `fallback`: the beats to a bar when the bars are not known.
 */
export function clickPlan(bars: readonly { beats: number }[] | undefined, fallback: number, countIn: number): { beatsPerBar: number; countInBeats: number; bars: number[] } {
  const whole = (b: number) => Math.max(1, Math.round(b) || 1);
  const list = (bars ?? []).map((b) => whole(b.beats));
  const beatsPerBar = list[0] ?? whole(fallback);
  return { beatsPerBar, countInBeats: Math.max(0, Math.round(countIn) || 0) * beatsPerBar, bars: list };
}

/**
 * How many bars `beats` beats reach, counted from bar `from` of a run of bars that can differ in
 * length: after a 4/4 bar and into a 3/4 one, 6 beats is 1⅔ bars, not 1½. The Vocals lane draws
 * every bar the same width, so a moment of the loop, or a take's length, is turned into bars
 * this way. Never past the last bar.
 */
export function barsInto(bars: readonly { beats: number }[], beats: number, from = 0): number {
  let left = Number.isFinite(beats) ? Math.max(0, beats) : 0;
  for (let k = Math.max(0, from); k < bars.length; k++) {
    const len = bars[k].beats > 0 ? bars[k].beats : 1;
    if (left < len) return k - from + left / len;
    left -= len;
  }
  return Math.max(0, bars.length - from);
}

/** How many bars a take lasts at a tempo (the Track page and the Vocals lane draw it this long). */
export const takeBars = (t: Take, bpm: number, beatsPerBar: number): number => t.frames / t.rate / (60 / bpm) / Math.max(1, beatsPerBar);

/**
 * A short name for a vocal sound, kept on each take to tell whether its file was made with the
 * sound now set. A long session leaves hundreds of takes and the song is saved whole on every
 * change, so not the whole sound on each. (Takes saved before held the whole sound; `sameSound`
 * knows them too.)
 */
export function soundTag(fx: unknown): string {
  const s = JSON.stringify(fx);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `#${(h >>> 0).toString(36)}${s.length.toString(36)}`;
}
/** Was this take's file made with the sound `fx`? */
export const sameSound = (t: Take, fx: unknown): boolean => t.sound === soundTag(fx) || t.sound === JSON.stringify(fx);

/** Every recording on a track, newest last. */
export const groupsOf = (takes: Take[] | undefined): string[] => [...new Set((takes ?? []).map((t) => t.group))];

/** Takes loaded from storage, made safe. */
export function reviveTakes(raw: unknown): Take[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ok = (t: Partial<Take>): t is Take =>
    !!t && typeof t.id === "string" && typeof t.group === "string" && typeof t.dry === "string" && typeof t.wet === "string" && Number.isFinite(t.rate) && Number.isFinite(t.start) && Number.isFinite(t.frames) && !!t.at && typeof t.at.block === "string" && Number.isFinite(t.at.bar);
  // a ★ is kept only as a plain yes (anything else stored there is let go)
  const out = (raw as Partial<Take>[]).filter(ok).map(({ keep, ...t }) => ({ ...t, n: Number(t.n) || 1, ...(keep === true ? { keep: true } : {}) }));
  return out.length ? out : undefined;
}

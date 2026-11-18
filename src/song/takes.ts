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
  /** where the take starts in the file, and how long it is (frames) */
  start: number;
  frames: number;
  /** where it plays in the song: the section and the bar it starts on */
  at: { block: string; bar: number };
  /** a last pass stopped before half-way: kept, but not offered unless asked for */
  short?: boolean;
  /** the vocal chain settings the wet file was made with */
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
  const first = Math.max(0, r.offset + (o.nudge ?? 0) + r.count_in);
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

/** How many bars a take lasts at a tempo (the Track page and the Vocals lane draw it this long). */
export const takeBars = (t: Take, bpm: number, beatsPerBar: number): number => t.frames / t.rate / (60 / bpm) / Math.max(1, beatsPerBar);

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

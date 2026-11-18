/**
 * Takes. A recording is one continuous file from the first click of the count-in until Stop.
 * It is cut into takes, one per time round the loop, after moving it earlier by the time the
 * sound took to go out to the headphones and come back in through the mic.
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
  /** "4/4" */
  sig?: string;
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
}

/**
 * Cut a recording into takes. `nudge` (frames) moves them further, for converters the driver
 * does not count. A last pass shorter than half the loop is marked short.
 */
export function cutTakes(r: Recorded, o: { group: string; at: { block: string; bar: number }; nudge?: number; id: () => string }): Take[] {
  const loop = Math.max(1, r.loop_frames);
  const first = Math.max(0, r.offset + (o.nudge ?? 0) + r.count_in);
  const out: Take[] = [];
  for (let k = 0, start = first; start < r.frames; k++, start += loop) {
    const frames = Math.min(loop, r.frames - start);
    if (frames < r.rate * 0.05) break;
    out.push({ id: o.id(), n: k + 1, group: o.group, dry: r.dry, wet: r.wet, rate: r.rate, start, frames, at: o.at, ...(frames < loop / 2 ? { short: true } : {}) });
  }
  return out;
}

/** The take that plays from a recording: the one chosen, or else the last full one. */
export function activeTake(takes: Take[], group: string, chosen?: string): Take | undefined {
  const mine = takes.filter((t) => t.group === group);
  return mine.find((t) => t.id === chosen) ?? [...mine].reverse().find((t) => !t.short) ?? mine[mine.length - 1];
}

/** Every recording on a track, newest last. */
export const groupsOf = (takes: Take[] | undefined): string[] => [...new Set((takes ?? []).map((t) => t.group))];

/** Takes loaded from storage, made safe. */
export function reviveTakes(raw: unknown): Take[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ok = (t: Partial<Take>): t is Take =>
    !!t && typeof t.id === "string" && typeof t.group === "string" && typeof t.dry === "string" && typeof t.wet === "string" && Number.isFinite(t.rate) && Number.isFinite(t.start) && Number.isFinite(t.frames) && !!t.at && typeof t.at.block === "string" && Number.isFinite(t.at.bar);
  const out = (raw as Partial<Take>[]).filter(ok).map((t) => ({ ...t, n: Number(t.n) || 1 }));
  return out.length ? out : undefined;
}

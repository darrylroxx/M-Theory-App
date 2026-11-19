/**
 * Which parts of the app's own song the canvas listens to, and how.
 *
 * Every track is heard on its own, through its fader (so a muted track is not painted), by an
 * ear of its own (`listen/bank.ts`), and painted by a hand of its own: two melody tracks are two
 * lines, not one line jumping between them. The app also knows every note and hit it plays
 * (`audio/pulse.ts`), exactly and a little ahead; for those tracks the ear only listens for the
 * texture (how loud, how bright, how noisy), which costs half as much. Vocal takes are only
 * heard.
 *
 * Every drums track has a desk of its own that goes out through its own fader, so each is heard
 * on its own, like any other track, and painted by a hand of its own in the drums layer.
 *
 * A track that is not heard (muted, another track soloed, or its fader all the way down) gets no
 * ear and no hand: nothing of it is painted (not even notes it was told of just before), and the ears go to the tracks that are heard. Ears cost time on the audio thread, so
 * there are never more than six: beyond that, tracks painted in the same layer share an ear (and
 * a hand).
 */
import { allTracks, insteadTarget, type Track } from "../song/tracks";
import type { Progression } from "../ui/state";
import { gainOf } from "../audio/mix";
import { layerOfTrack, type LayerKind } from "./layers";

export const MAX_TAPS = 6;
/** Which layers' tracks share an ear first, when there are too many. */
const SHARE_FIRST: LayerKind[] = ["drums", "other", "chords", "vocals", "bass", "harmony", "melody"];

export interface TapPlan {
  /** the ear's and the hand's name */
  key: string;
  layer: LayerKind;
  /** the faders whose sound this ear hears */
  faders: string[];
  /** the tracks this hand paints (their notes, when the app knows them) */
  members: string[];
  /** the notes are known: the ear listens only for the texture */
  light: boolean;
}

/** The ears for a song's tracks. */
export function planTaps(p: Pick<Progression, "tracks" | "mix">): TapPlan[] {
  const plans: TapPlan[] = [];
  const tracks = allTracks(p);
  for (const t of tracks) {
    // (a fader all the way down is as silent as a mute)
    if (gainOf(p.mix, t.id) <= 0) continue;
    // a swap written "instead" of the chords (or chords fitted to the tune) is the chords now heard,
    // not a part beside them: it is painted as the chords, bass and all
    const layer = insteadTarget(t as Track, tracks as Track[]) ? "chords" : layerOfTrack(t as Track);
    plans.push({ key: t.id, layer, faders: [t.id], members: [t.id], light: t.kind !== "vocals" });
  }
  // too many ears: tracks of one layer share one. Drums first (two kits' hits on one hand are still hits), then washes
  // and fog, then the voices; two melodies sharing a hand would be one line jumping between them, so they share last.
  // Within that, the layer with the most tracks first.
  const rank = (l: LayerKind) => SHARE_FIRST.indexOf(l);
  while (plans.length > MAX_TAPS) {
    const count = new Map<LayerKind, TapPlan[]>();
    for (const pl of plans) count.set(pl.layer, [...(count.get(pl.layer) ?? []), pl]);
    const [, same] = [...count.entries()].filter(([, v]) => v.length > 1).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length)[0] ?? [];
    if (!same) break;
    const [a, b] = same.slice(-2);
    a.faders.push(...b.faders);
    a.members.push(...b.members);
    a.light &&= b.light;
    plans.splice(plans.indexOf(b), 1);
  }
  return plans;
}

/** Which hand paints a track's notes: the key of the ear that hears it. */
export function handOf(plans: TapPlan[]): (track: string) => string {
  const m = new Map<string, string>();
  for (const pl of plans) for (const id of pl.members) m.set(id, pl.key);
  return (track) => m.get(track) ?? track;
}

/** Is a track heard (and painted) at all? A note it was told of before it was muted is not painted. */
export function heardIn(plans: TapPlan[]): (track: string) => boolean {
  const m = new Set(plans.flatMap((pl) => pl.members));
  return (track) => m.has(track);
}

/** The layer each track is painted in. */
export function layerOf(plans: TapPlan[]): (track: string) => LayerKind {
  const m = new Map<string, LayerKind>();
  for (const pl of plans) for (const id of pl.members) m.set(id, pl.layer);
  return (track) => m.get(track) ?? (track === "drums" ? "drums" : track === "chords" ? "chords" : "melody");
}

/** A name for a plan, so the ears are rebuilt only when it changes. */
export const planKey = (plans: TapPlan[]) => plans.map((p) => `${p.key}=${p.layer}:${p.faders.join("+")}${p.light ? "" : "!"}`).join("|");

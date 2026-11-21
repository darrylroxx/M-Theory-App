/**
 * Which tracks of a song of tracks and clips the canvas listens to, and how: `planTaps` (see ./taps) for the track
 * view's song. Every track that is heard gets an ear and a hand of its own, painted in the layer of its kind; a
 * track that is not heard (muted, another one soloed, its fader all the way down) gets none. A chords track whose
 * clip plays instead of the chords where the music is, is the chords heard there: it is painted as chords.
 * Recorded tracks are only heard (the app does not know their notes). Never more than six ears: beyond that, tracks
 * painted in the same layer share one.
 */
import { gainOf } from "../audio/mix";
import type { TimelineSong } from "../timeline/model";
import { layerOfTrack5, type LayerKind } from "./layers";
import { MAX_TAPS, type TapPlan } from "./taps";

/** Which layers' tracks share an ear first, when there are too many (as in ./taps). */
const SHARE_FIRST: LayerKind[] = ["drums", "other", "chords", "vocals", "bass", "harmony", "melody"];

/** The ears for a song's tracks. `at`: the beat the music is on (where a clip may play instead of the chords). */
export function planTaps5(song: TimelineSong, at = 0): TapPlan[] {
  const plans: TapPlan[] = [];
  for (const t of song.tracks) {
    // (a fader all the way down is as silent as a mute)
    if (gainOf(song.mix, t.id) <= 0) continue;
    const swaps = t.kind === "chords" && song.clips.some((c) => c.kind === "chords" && c.track === t.id && !c.mute && !!c.instead && c.start <= at + 1e-6 && c.start + c.len > at + 1e-6 && song.tracks.some((x) => x.id === c.instead));
    const recorded = t.kind === "vocals" || t.kind === "audio";
    plans.push({ key: t.id, layer: swaps ? "chords" : layerOfTrack5(t), faders: [t.id], members: [t.id], light: !recorded });
  }
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

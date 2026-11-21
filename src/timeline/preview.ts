// Hearing what is being composed with the song, before it is on the timeline.
//
// A track's draft has no place of its own: it is treated as lying at an anchor (the bar line at or before the loop's
// start, else at or before the cursor: `draftAnchor`). `previewSong` gives the song with the draft laid in there, on
// its own track, as a clip one round of its content long. In that copy only, it covers what the track has there. The
// stored song is never changed by it.
import { contentHas } from "./content";
import { layDown } from "./edit";
import { CLIP_OF, contentBeats, type NoteClip, type TimelineSong } from "./model";

/** The id of the clip that stands for a track's draft in a preview (no clip of the song has one like it). */
export const draftClipId = (track: string): string => `draft~${track}`;

/** What was made last, for each song: asked again with the same track and anchor, the very same song comes back (so nothing that plays it starts over). */
const made = new WeakMap<TimelineSong, Map<string, TimelineSong>>();

/**
 * The song with a track's draft laid in at `anchor`, on its own track: in the copy only, the draft covers that
 * track's clips over its bars. The same song object comes back when the track has no draft, or a draft with nothing
 * in it yet (there is nothing to hear, and nothing is covered).
 */
export function previewSong(song: TimelineSong, track: string, anchor: number): TimelineSong {
  const t = song.tracks.find((x) => x.id === track);
  if (!t || "takes" in t || !t.draft || !Number.isFinite(anchor)) return song;
  const kind = CLIP_OF[t.kind] as NoteClip["kind"];
  if (!contentHas(kind, t.draft.content)) return song;
  const key = `${track}|${anchor}`;
  let per = made.get(song);
  const kept = per?.get(key);
  if (kept) return kept;
  const clip = { id: draftClipId(track), track, kind, start: Math.max(0, anchor), len: 1, off: 0, sig: t.draft.sig, content: t.draft.content } as NoteClip;
  const out = layDown(song, { ...clip, len: contentBeats(clip) });
  if (!per) made.set(song, (per = new Map()));
  per.set(key, out);
  return out;
}

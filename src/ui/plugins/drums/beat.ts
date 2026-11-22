// The drum machine edits a `Beat`: a rhythm and a kit as one thing. A song of tracks and clips keeps them apart: the
// rhythm is a clip's content (or its track's draft), the kit is the track's. These are the plain steps between the
// two: join them for the machine, and write back what it changed, each part to where it belongs.
import { applyPattern, barsOf, emptyRows, grooveOf, kitOfBeat, kitSig, onKit, sameGroove, spreadBeat, type Beat, type BeatPattern, type DrumKit, type Groove } from "../../../audio/beats";
import { openOf, writeOpen, type OpenTarget } from "../../../timeline/content";
import { setTrack } from "../../../timeline/edit";
import type { Clip, DrumsTrack, TimelineSong } from "../../../timeline/model";

/** A rhythm on a kit, as the machine takes it. `on`: is it heard (a placed clip's mute, the other way round; a draft is always on). */
export const beatOf = (content: Groove, kit: DrumKit, on = true): Beat => onKit({ ...content, on } as Beat, kit);

/** What the sound window's machine is given: the track's kit, with a rhythm that is never played or shown. */
const SILENT: Groove = { patternId: null, name: "", edited: false, steps: 16, div: 4, bars: 1, swing: 0, rows: emptyRows(16) };
export const soundBeat = (kit: DrumKit): Beat => beatOf(SILENT, kit);

/** A beat's rhythm as a clip keeps it (whether it is heard is the clip's own switch, not part of the rhythm). */
export function rhythmOf(b: Beat): Groove {
  const { on: _on, ...g } = grooveOf(b);
  return g;
}

/**
 * A library rhythm picked into what is open: it is written out over the bars that are open, so each bar can be
 * changed on its own and what is open stays as long as it was (a rhythm longer than that brings its own length).
 */
export function pickRhythm(b: Beat, p: BeatPattern): Beat {
  const next = applyPattern(b, p);
  return spreadBeat(next, barsOf(b));
}

/**
 * What the machine changed, written into the song: the rhythm into the open clip or the draft (fitted to its time
 * signature, as everywhere), the kit onto the track, and a clip switched on or off. The same song back when the two
 * beats say the same. `anchor`: where a draft is treated as lying.
 */
export function writeBeat(song: TimelineSong, target: OpenTarget, anchor: number, before: Beat, after: Beat): TimelineSong {
  const open = openOf(song, target, anchor);
  if (!open || open.kind !== "drums" || after === before) return song;
  let out = song;
  const kit = kitOfBeat(after);
  if (kitSig(kit) !== kitSig((open.track as DrumsTrack).kit)) out = setTrack<DrumsTrack>(out, open.track.id, { kit });
  if (!sameGroove({ ...grooveOf(before), on: true }, { ...grooveOf(after), on: true })) out = writeOpen(out, target, rhythmOf(after), anchor);
  if (open.clip && after.on !== before.on) {
    const id = open.clip.id;
    out = { ...out, clips: out.clips.map((c): Clip => {
      if (c.id !== id) return c;
      if (!after.on) return { ...c, mute: true };
      const { mute: _m, ...heard } = c;
      return heard as Clip;
    }) };
  }
  return out;
}

/** What only the kit's knobs changed between two beats: a name for it, so a knob being turned is one undo step. Otherwise nothing. */
export function controlOf(track: string, before: Beat, after: Beat): string | undefined {
  const same = sameGroove({ ...grooveOf(before), swing: 0, on: true }, { ...grooveOf(after), swing: 0, on: true });
  if (!same || before.on !== after.on) return undefined;
  if (before.swing !== after.swing) return `drums:${track}:swing`;
  return kitSig(kitOfBeat(before)) !== kitSig(kitOfBeat(after)) ? `drums:${track}:kit` : undefined;
}

// A track's instrument, and how it is changed from its sound window: Guitar, Piano or Synth, with that instrument's
// own settings. The song keeps the change at once; a piano or a synth starts loading then, and when it can sound it
// is heard. (The way the old pages did it for "the track on screen", for one track of the song.)
import { useCallback, useMemo, useRef, useState } from "react";
import type { HarpSound } from "../../../audio/rack";
import { warmSlot } from "../../../audio/synth";
import { synthOf, type Tone } from "../../../audio/tone";
import { setTrack } from "../../../timeline/edit";
import type { ChordsTrack, TimelineSong, TuneTrack } from "../../../timeline/model";
import type { ToneProps } from "../../components/HarpPanel";
import { lastOnly } from "../../latest";

/** The tone a patch makes of a tone: a track put on the synth for the first time starts on a pad (chords) or a lead (melody, bass). */
export function toneWith(tone: Tone, patch: Partial<Tone>, kind: "chords" | "melody"): Tone {
  const next: Tone = { ...tone, ...patch };
  if (next.inst === "synth" && !next.synth) next.synth = synthOf(next, kind);
  return next;
}

/** Does a patch change which instrument sounds (so its voice has to load before it is heard)? */
export const changesVoice = (patch: Partial<Tone>): boolean => patch.inst !== undefined || patch.keys !== undefined;

/** The song with a track's instrument changed. */
export const withTone = (song: TimelineSong, track: string, tone: Tone): TimelineSong => setTrack<ChordsTrack | TuneTrack>(song, track, { tone });

/**
 * What a sound window hands the instrument switch for a track. `sound`: the track's sound as it plays (its voice is
 * made with it). `edit`: one undo step of the song. `hear`: play something once the instrument can sound.
 */
export function useTone(o: {
  track: ChordsTrack | TuneTrack;
  sound: HarpSound;
  compound: boolean;
  edit(label: string, fn: (s: TimelineSong) => TimelineSong, control?: string): void;
  hear(): void;
}): ToneProps {
  const { track, compound } = o;
  const kind: "chords" | "melody" = track.kind === "chords" ? "chords" : "melody";
  const [loading, setLoading] = useState(false);
  const loads = useMemo(lastOnly, []);
  const live = useRef(o);
  live.current = o;
  const setTone = useCallback((patch: Partial<Tone>) => {
    const { track: t, sound, edit, hear } = live.current;
    const next = toneWith(t.tone, patch, kind);
    // (a knob of the instrument being turned is one undo step; another instrument chosen is a step of its own)
    edit("Instrument", (s) => withTone(s, t.id, next), changesVoice(patch) ? undefined : `tone:${t.id}:${Object.keys(patch).join()}`);
    if (!changesVoice(patch)) return;
    setLoading(true);
    const mine = loads.begin();
    void warmSlot({ track: t.id, kind: kind === "melody" ? "melody" : "chord", tone: next, sound }).then(
      () => {
        if (!mine()) return;
        setLoading(false);
        hear();
      },
      () => mine() && setLoading(false),
    );
  }, [kind, loads]);
  return useMemo(() => ({ tone: track.tone, kind, loading, compound, setTone }), [track.tone, kind, loading, compound, setTone]);
}

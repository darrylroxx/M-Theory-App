// The sound window of a Chords, Melody or Bass track: the plugin window its FX button opens (and the Sound button of
// its composer). Top to bottom: the instrument (Guitar, Piano or Synth), the ready-made sounds and the user's own,
// the strings or the keys or the synth, and the effects. All of it is the track's: it sounds this way on every clip.
//
// The knobs are drawn again only when this track itself changes (or the key, or whether the song plays): an edit of
// another track, a clip moved, the cursor placed, all leave them as they are (`useWinPart`).
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { reviveSound, type HarpSound } from "../../../audio/rack";
import { playNote, strum } from "../../../audio/synth";
import { TUNE_SLOT } from "../../../audio/trackplay";
import { keysVoicing, onKeys } from "../../../audio/tone";
import { melodyBase } from "../../../song/melody";
import type { Key } from "../../../theory/keys";
import { setTrack } from "../../../timeline/edit";
import type { ChordsTrack, TimelineSong, TuneTrack } from "../../../timeline/model";
import { useApp5Store, useWinPart, type Store5 } from "../../app5";
import { SoundControls } from "../../components/HarpPanel";
import { V4View } from "../../windows/ClipLens";
import { SoundFrame, type SoundProps } from "../SoundFrame";
import "./sound.css";
import { useTone } from "./useTone";

/** What is strummed to hear a chords track when it has no chord of its own to play. */
const OPEN_CHORD = [48, 55, 60, 64, 67, 72];

export const TrackSound = memo(function TrackSound(p: SoundProps) {
  const { track } = p;
  if (track.kind !== "chords" && track.kind !== "melody" && track.kind !== "bass") return null;
  return (
    <V4View>
      <SoundFrame p={p}>
        <Body id={track.id} keyOf={p.keyOf} playing={p.player.playing} compound={p.compound} />
      </SoundFrame>
    </V4View>
  );
});

/** The first chord a chords track plays, as its notes on the keys (the guitar's shapes are the host's to know: an open chord stands in). */
function firstChord(song: TimelineSong, track: ChordsTrack): number[] {
  const c = song.clips.filter((x) => x.track === track.id && x.kind === "chords").sort((a, b) => a.start - b.start).flatMap((x) => (x.kind === "chords" ? x.content.chords : [])).find((x) => !x.rest);
  return c && onKeys(track.tone) ? keysVoicing(c.ref, track.tone) : OPEN_CHORD;
}

const Body = memo(function Body({ id, keyOf, playing, compound }: { id: string; keyOf: Key; playing: boolean; compound: boolean }) {
  const app = useApp5Store();
  const own = useWinPart(id).track;
  if (!own || (own.kind !== "chords" && own.kind !== "melody" && own.kind !== "bass")) return null;
  return <Knobs app={app} track={own} keyOf={keyOf} playing={playing} compound={compound} />;
});

function Knobs({ app, track, keyOf, playing, compound }: { app: Store5; track: ChordsTrack | TuneTrack; keyOf: Key; playing: boolean; compound: boolean }) {
  const sound = useMemo(() => reviveSound(track.sound), [track.sound]);
  const live = useRef({ app, track, keyOf, playing });
  live.current = { app, track, keyOf, playing };
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  /** play something short on the track, a moment after the last change (not over the song while it plays) */
  const hear = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const { track: t, keyOf: k, playing: on, app: a } = live.current;
      if (on) return;
      if (t.kind === "chords") strum(firstChord(a.peek().song, t));
      // (a bass is heard where it plays: low)
      else playNote(melodyBase(k) + (t.kind === "bass" ? -12 : 12), undefined, 0.86, TUNE_SLOT);
    }, 240);
  }, []);
  const setSound = useCallback((patch: Partial<HarpSound>) => {
    const { app: a, track: t } = live.current;
    a.edit(`Sound of ${t.name}`, (s) => {
      const now = s.tracks.find((x) => x.id === t.id);
      if (!now || !("tone" in now)) return s;
      return setTrack<ChordsTrack | TuneTrack>(s, t.id, { sound: { ...reviveSound(now.sound), ...patch } });
    }, `sound:${t.id}:${Object.keys(patch).join()}`);
  }, []);
  const edit = useCallback((label: string, fn: (s: TimelineSong) => TimelineSong, control?: string) => live.current.app.edit(label, fn, control), []);
  const inst = useTone({ track, sound, compound, edit, hear });
  return (
    <section className="ts" aria-label={`Sound of ${track.name}`}>
      <SoundControls open sound={sound} setSound={setSound} onHear={hear} inst={inst} />
    </section>
  );
}

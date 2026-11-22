// The drum sound window: the plugin window a drums track's FX button opens (and the Sound button of its composer,
// and a tap on a drum's name there). Everything the drum page had for how the drums sound is here, top to bottom:
// the kit (the ready-made ones, the machines, the user's own, and "Save this kit"), the mixer (a fader, mute and
// solo for every drum, and the whole kit's level), the chosen drum's own sound, and the effects of the whole kit.
// All of it is the track's: it sounds this way on every clip.
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { Beat } from "../../../audio/beats";
import { setTrack } from "../../../timeline/edit";
import type { DrumsTrack } from "../../../timeline/model";
import { useApp5 } from "../../app5";
import { DrumMachine } from "../../components/DrumMachine";
import { V4View } from "../../windows/ClipLens";
import { SoundFrame, type SoundProps } from "../SoundFrame";
import { kitOfBeat, kitSig } from "../../../audio/beats";
import { soundBeat } from "./beat";
import { useDrumView } from "./store";
import "./drums.css";

const NOWHERE = () => null;
const NOTHING = () => {};

export const DrumSound = memo(function DrumSound(p: SoundProps) {
  const { track } = p;
  if (track.kind !== "drums") return null;
  return (
    <V4View>
      <SoundFrame p={p}>
        <Body track={track} bpm={p.song.bpm} playing={p.player.playing && !p.hidden} shown={!p.hidden} />
      </SoundFrame>
    </V4View>
  );
});

const Body = memo(function Body({ track, bpm, playing, shown }: { track: DrumsTrack; bpm: number; playing: boolean; shown: boolean }) {
  const app = useApp5();
  const live = useRef({ app, id: track.id });
  live.current = { app, id: track.id };
  const beat = useMemo(() => soundBeat(track.kit), [track.kit]);
  /** every change here is a change of the track's kit; a knob being turned is one undo step */
  const setBeat = useCallback((fn: (b: Beat) => Beat) => {
    const { app: a, id } = live.current;
    const t = a.peek().song.tracks.find((x) => x.id === id);
    if (!t || t.kind !== "drums") return;
    const kit = kitOfBeat(fn(soundBeat(t.kit)));
    if (kitSig(kit) === kitSig(t.kit)) return;
    a.edit(`Sound of ${t.name}`, (song) => setTrack<DrumsTrack>(song, id, { kit }), `drums:${id}:kit`);
  }, []);
  // a drum's name tapped in the composer: that drum's sound is brought into view
  const box = useRef<HTMLDivElement>(null);
  const { hit } = useDrumView(track.id);
  const seen = useRef(hit);
  useEffect(() => {
    if (seen.current === hit) return;
    seen.current = hit;
    box.current?.querySelector<HTMLElement>('[data-sec="sound"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hit]);
  return (
    <div ref={box}>
      <DrumMachine trackId={track.id} show="sound" bpm={bpm} beat={beat} setBeat={setBeat} onPick={NOTHING} playing={playing} frame={1} getPos={NOWHERE} shown={0} follow={false} active={shown} />
    </div>
  );
});

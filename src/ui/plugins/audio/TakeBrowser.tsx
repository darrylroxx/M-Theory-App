// The take browser of a track that records: the take list (TakeList5: every take of every recording, newest
// recording first, grouped by recording, with All / ★, hear, ★, Use, delete, remove a recording, short takes, and
// the shelf of removed recordings) joined to the song. Every change it makes is one step of the one undo; a take
// deleted, a recording removed and the shelf emptied each offer ↶ for a while instead of asking first; and no change
// here ever removes a recording's file.
import { useEffect, useMemo, useRef, useState } from "react";
import { freeInterface } from "../../../audio/handoff";
import { hearAlone, hearingAlone, onAlone as onAloneChange, stopAlone } from "../../../audio/takeplay";
import { dropTake5, emptyShelf5, keepTake5, removeRecording5, useShelved5, useTake5 } from "../../../timeline/audioclips";
import type { AudioClip, AudioTrack, Shelved, Take5 } from "../../../timeline/model";
import type { Ctx5 } from "../../app5";
import { newId } from "../../state";
import { TakeList5 } from "./TakeList5";

/** Ids for what one edit makes: the same ones however often the edit is worked out. */
export const idsFrom = (base: string) => {
  let n = 0;
  return () => `${base}-${++n}`;
};

/** What the take browser changes in the song of a track, each as one undo step. `app`: the app as it is this moment. */
export function takeEdits(app: () => Ctx5, track: () => string | null) {
  const withUndo = (msg: string) => {
    const after = app().peek().song;
    // (offered only while the song is as this left it: after another change, undo would take that one back)
    app().toast(msg, { label: "↶", aria: "Undo", run: () => app().undo(), when: (s) => s.song === after });
  };
  return {
    /** this take plays: in every clip of its spot, or laid as a clip at the cursor when nothing of its spot is on the lane */
    use(k: Take5) {
      const id = track();
      const base = `u${newId()}`;
      if (id) app().edit("Use take", (s) => useTake5(s, id, k.id, app().peek().session.cursor, idsFrom(base)));
    },
    keep(k: Take5, keep: boolean) {
      const id = track();
      if (id) app().edit(keep ? "Keep take" : "Let take go", (s) => keepTake5(s, id, k.id, keep));
    },
    /** delete a take from the song (its file stays on disk); whatever played it plays the next best take */
    drop(k: Take5) {
      const id = track();
      if (!id) return;
      const before = app().peek().song;
      app().edit("Delete take", (s) => dropTake5(s, id, k.id));
      if (app().peek().song !== before) withUndo(`Take ${k.n} deleted`);
    },
    remove(group: string) {
      const id = track();
      if (!id) return;
      const before = app().peek().song;
      app().edit("Remove recording", (s) => removeRecording5(s, id, group));
      if (app().peek().song !== before) withUndo("Recording removed");
    },
    /** a take from the shelf: its whole recording comes onto this track, laid at the cursor */
    shelfUse(k: Take5) {
      const id = track();
      const base = `u${newId()}`;
      if (id) app().edit("Use removed recording", (s) => useShelved5(s, id, k.id, app().peek().session.cursor, idsFrom(base)));
    },
    empty() {
      const before = app().peek().song;
      app().edit("Empty removed recordings", emptyShelf5);
      if (app().peek().song !== before) withUndo("Removed recordings emptied");
    },
  };
}

export interface TakeBrowserProps {
  track: AudioTrack;
  /** the song's recorded clips: those of this track say which takes play */
  clips: readonly AudioClip[];
  /** the takes of tracks that were removed */
  shelf: readonly Shelved[] | undefined;
  /** the clips selected on the lanes (the take of one on this track is the one selected in the list) */
  picked: readonly string[];
  /** can a take be heard here? (Only where the recordings are: in the desktop app.) */
  canHear: boolean;
  /** a recording or a rehearsal runs: nothing is heard alone, deleted or removed meanwhile */
  running: boolean;
  /** the app as it is this moment */
  app(): Ctx5;
  /** the song stops (a take is about to be heard alone) */
  stopSong(): void;
}

export function TakeBrowser(p: TakeBrowserProps) {
  const { track } = p;
  const live = useRef(p);
  live.current = p;
  // ── a take heard alone ──
  const [alone, setAlone] = useState<string | null>(null);
  const aloneRef = useRef(alone);
  aloneRef.current = alone;
  useEffect(() => onAloneChange((on) => !on && setAlone(null)), []);
  const does = useMemo(() => {
    const now = () => live.current;
    return {
      ...takeEdits(() => now().app(), () => now().track.id),
      hear: async (k: Take5) => {
        // (not over a song the interface is playing)
        if (now().running) return;
        if (aloneRef.current === k.id && hearingAlone()) return stopAlone();
        now().stopSong();
        // just this take is read from the recording; the interface's own engine closes first, so the two never play through it at once
        const ok = await hearAlone({ wet: k.wet, start: k.start, frames: k.frames, rate: k.rate }, now().track.id, undefined, freeInterface);
        if (ok) setAlone(k.id);
        else if (ok === false) now().app().toast("Could not read the recording");
      },
    };
  }, []);
  // the take of the clip selected on the lane (the one selected last, on this track)
  const pick = [...p.picked].reverse().map((id) => p.clips.find((c) => c.id === id && c.track === track.id)).find((c) => !!c)?.take ?? null;
  return (
    <TakeList5 key={track.id} track={track} clips={p.clips} shelf={p.shelf} alone={alone} canHear={p.canHear} running={p.running} pick={pick}
      onHear={(k) => void does.hear(k)} onKeep={does.keep} onUse={does.use} onDrop={does.drop} onRemove={does.remove} onShelfUse={does.shelfUse} onEmpty={does.empty} />
  );
}

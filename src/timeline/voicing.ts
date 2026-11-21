// The shapes a track's chords play on the guitar, worked out with no screen around.
// Copied from the big view (GuitarView.tsx:96-125, `optsOf` and `voicingsOf`): what it took from its hooks is the argument here.
import { arrangeProgression, type ArrangeOptions } from "../guitar/arrange";
import { fingerNotes } from "../guitar/finger";
import type { Tuning } from "../guitar/tunings";
import { voicingFromFrets, type Voicing } from "../guitar/voicings";
import { playedNotes } from "../song/chordnotes";
import { getChordType, type ChordRef } from "../theory/chords";
import { pc } from "../theory/notes";
import type { ArrangeSettings, ProgChord } from "../ui/state";

/** The guitar the shapes are for, and the shape each chord has on its own (its spot's shape, else the one chosen for it, else the easiest). */
export interface VoicingCtx { tuning: Tuning; capo: number; avoidBarre: boolean; shapeOf(ref: ChordRef, voicingId?: string): Voicing | undefined }

/** The shapes a track's chords play on the guitar, arranged as that track is in its section. */
export function voicingsFor(ctx: VoicingCtx): (chords: ProgChord[], arrange: ArrangeSettings | null | undefined) => (Voicing | undefined)[] {
  const { tuning, capo, avoidBarre } = ctx;
  const optsOf = (a: ArrangeSettings | null | undefined): ArrangeOptions => ({ tuning, capo, avoidBarre, preferOpen: a?.zone === 0, targetFret: null, allowInversions: a?.inversions ?? false, zone: a?.zone ?? null, strings: a?.strings ?? "any" });
  return (all: ProgChord[], a: ArrangeSettings | null | undefined): (Voicing | undefined)[] => {
    // a rest has no shape, and the chords either side of it are arranged as neighbours
    const chords = all.filter((c) => !c.rest);
    const own = chords.map((c) => ctx.shapeOf(c.ref, c.voicingId));
    // (a shape set by hand that no longer makes its chord, after the capo or tuning changed, is free to move like the rest)
    const vs = a ? arrangeProgression(chords.map((c) => c.ref), { ...optsOf(a), pinned: chords.map((c, i) => (c.voicingId && own[i]?.id === c.voicingId ? own[i] : undefined)) }) : own;
    let k = 0;
    return all.map((c) => {
      if (c.rest) return undefined;
      const v = vs[k++];
      // a chord Harmonize wrote as exact notes: the shape that plays just those, where a hand can
      const ns = playedNotes(c);
      const frets = ns && fingerNotes(ns, tuning, capo);
      return frets ? voicingFromFrets(frets, pc(c.ref.root), getChordType(c.ref.typeId), tuning, capo) : v;
    });
  };
}

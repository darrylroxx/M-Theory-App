/**
 * Short fingerprints of what a track holds in a section: what a harmony track remembers it wrote
 * there (see song/harmony), so a change by hand can be told from what was written.
 */
import type { ProgChord } from "../ui/state";
import { pc } from "../theory/notes";
import type { Melody } from "./melody";
import type { Layer } from "./tracks";

/** A number from a string, the same every time (FNV-1a), for seeds and fingerprints. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const chordPrint = (cs: ProgChord[] | undefined) => (cs ?? []).map((c) => (c.rest ? `-${c.beats}` : `${pc(c.ref.root)}${c.ref.typeId}/${c.ref.bass ? pc(c.ref.bass) : ""}:${c.beats}${c.voicingId ? `@${c.voicingId}` : ""}`)).join(" ");
export const tunePrint = (m: Melody | undefined) => (m ? `${m.div}${m.on === false ? "x" : ""}:${[...m.notes].sort((a, b) => a.at - b.at || a.midi - b.midi).map((n) => `${n.at}.${n.midi}`).join(" ")}` : "");
/** What a track holds in a section, as a short fingerprint. */
export const outPrint = (l: Layer | undefined): string => fnv(`${chordPrint(l?.chords)}|${tunePrint(l?.melody)}`).toString(36);

// The ways out of a song of tracks and clips: the chords as text with guitar tab, a MIDI file, and the song as sound.
// The MIDI and the sound are made from the same list the player plays (see flatten), so they are what is heard.
import { progressionToMidi } from "../audio/midi";
import { renderSong } from "../audio/synth";
import { keysVoicings, onKeys, type Tone } from "../audio/tone";
import { encodeWav, safeGain, trimEnd } from "../audio/wav";
import type { Tuning } from "../guitar/tunings";
import type { Voicing } from "../guitar/voicings";
import { inFrame } from "../song/frame";
import { sameSig, sigName } from "../song/meter";
import { chordSymbolAscii } from "../theory/chords";
import { analyzeChord, type Key } from "../theory/keys";
import { midiToName } from "../theory/notes";
import { getScale } from "../theory/scales";
import type { ProgChord } from "../ui/state";
import { barMap } from "./bars";
import { songEnd } from "./edit";
import type { Flat, FlattenCtx } from "./flatten";
import { contentBeats, cycles } from "./model";
import type { ChordsClip, ChordsTrack, Region, TimelineSong } from "./model";

const EPS = 1e-6;
const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** Chords as guitar tab: a line for each string, a column for each chord. */
function tabText(vs: (Voicing | undefined)[], names: string[], stringNames: string[]): string {
  const width = 8;
  const lines = stringNames.map((n) => `${n.padEnd(2)}|`).reverse();
  const header = "   " + names.map((n) => n.padEnd(width)).join("");
  vs.forEach((v) => {
    for (let s = 0; s < stringNames.length; s++) {
      const f = v?.frets[s];
      const cell = f === null || f === undefined ? "x" : String(f);
      lines[stringNames.length - 1 - s] += ("-" + cell).padEnd(width - 1, "-") + "|";
    }
  });
  return [header, ...lines].join("\n");
}

/** A chord as it lies in a stretch of the song: the chord, for how long, and how its track plays it there (its guitar shape, or its keys). */
interface Lying { at: number; chord: ProgChord; beats: number; shape?: Voicing; keys?: number[] }

/** Every chord a chords track plays in a stretch, in order: each round of each clip's content, cut at the clip's and the stretch's edges. */
function chordsIn(song: TimelineSong, t: ChordsTrack, span: Region, voicingsOf: FlattenCtx["voicingsOf"]): Lying[] {
  const out: Lying[] = [];
  const clips = song.clips.filter((c): c is ChordsClip => c.kind === "chords" && c.track === t.id && !c.mute && c.start < span.to - EPS && c.start + c.len > span.from + EPS);
  for (const c of clips) {
    const keys = onKeys(t.tone) ? keysVoicings(c.content.chords, t.tone) : null;
    const shapes = keys ? null : voicingsOf(c.content.chords, c.content.arrange);
    const inside: { a: number; b: number; i: number }[] = [];
    let x = 0;
    for (const { item, index } of inFrame(c.content.chords, contentBeats(c))) {
      inside.push({ a: x, b: x + item.beats, i: index });
      x += item.beats;
    }
    for (const cy of cycles(c)) {
      const base = c.start + cy.at - cy.from;
      for (const k of inside) {
        const a = Math.max(base + Math.max(k.a, cy.from), span.from);
        const b = Math.min(base + Math.min(k.b, cy.to), span.to);
        if (b - a > EPS) out.push({ at: a, chord: c.content.chords[k.i], beats: b - a, ...(keys ? { keys: keys[k.i] ?? [] } : { shape: shapes![k.i] }) });
      }
    }
  }
  return out.sort((p, q) => p.at - q.at);
}

/**
 * The chords of the song as text, with guitar tab (or, for a track on the keys, each chord's keys by name).
 * With markers: their names in running order, then each stretch from one marker to the next once (a stretch whose
 * chords equal an earlier one's, names and lengths on every chords track, is not printed again: three verses print
 * one). Tracks that came from one old track (the same `group`) are printed under one heading.
 */
export function chart5(song: TimelineSong, key: Key, ctx: { tuning: Tuning; capo: number; voicingsOf: FlattenCtx["voicingsOf"]; name?: string }): string {
  const map = barMap(song);
  const end = songEnd(song);
  const scale = getScale(key.scaleId);
  const stringNames = ctx.tuning.notes.map((m) => NOTE_NAMES[(m + ctx.capo) % 12]);
  /** the chords tracks, those from one old track together, in the order of the first of each */
  const groups: { name: string; tracks: ChordsTrack[] }[] = [];
  for (const t of song.tracks) {
    if (t.kind !== "chords") continue;
    const id = t.group ?? t.id;
    const g = groups.find((x) => (x.tracks[0].group ?? x.tracks[0].id) === id);
    if (g) g.tracks.push(t);
    else groups.push({ name: t.name, tracks: [t] });
  }
  // (a group is called by its first track: the one that kept the old track's name)
  const guitar = groups.some((g) => g.tracks.some((t) => !onKeys(t.tone)));
  const head = `${ctx.name || "Untitled"} | ${key.tonic} ${scale.name} | ${song.bpm} bpm${ctx.capo && guitar ? ` | Capo ${ctx.capo}` : ""}`;
  const block = (list: Lying[]): string[] => {
    const names = list.map((x) => (x.chord.rest ? "-" : chordSymbolAscii(x.chord.ref)));
    const real = list.map((x, i) => ({ x, name: names[i] })).filter((r) => !r.x.chord.rest);
    const onKeysHere = real.length > 0 && real.every((r) => r.x.keys !== undefined);
    const shapes = onKeysHere ? real.map((r) => `${r.name}: ${(r.x.keys ?? []).map((m) => midiToName(m)).join(" ")}`).join("\n") : tabText(real.map((r) => r.x.shape), real.map((r) => r.name), stringNames);
    return ["| " + names.join(" | ") + " |", "  " + list.map((x) => (x.chord.rest ? "-" : analyzeChord(x.chord.ref, key).roman)).join("  "), "", shapes];
  };
  /** one stretch: each group's chords under its name (no name when the song has one group only) */
  const stretch = (span: Region): { lines: string[]; print: string } => {
    const lines: string[] = [];
    const print: unknown[] = [];
    for (const g of groups) {
      const list = g.tracks.flatMap((t) => chordsIn(song, t, span, ctx.voicingsOf)).sort((p, q) => p.at - q.at);
      print.push(list.map((x) => [x.chord.rest ? "-" : chordSymbolAscii(x.chord.ref), x.beats]));
      if (!list.length) continue;
      if (groups.length > 1) lines.push(`${g.name}:`);
      lines.push(...block(list));
    }
    return { lines, print: JSON.stringify(print) };
  };
  const markers = [...(song.markers ?? [])].sort((a, b) => a.beat - b.beat).filter((m) => m.beat < end - EPS);
  if (!markers.length) return [head, "", ...stretch({ from: 0, to: end }).lines].join("\n");
  // the stretches: from one marker to the next (what lies before the first marker is a stretch too)
  const parts: { label: string; span: Region }[] = [];
  if (markers[0].beat > EPS) parts.push({ label: "Start", span: { from: 0, to: markers[0].beat } });
  markers.forEach((m, i) => parts.push({ label: m.name || `Marker ${i + 1}`, span: { from: m.beat, to: markers[i + 1]?.beat ?? end } }));
  const out = [head, "", parts.map((p) => p.label).join(" "), ""];
  const done = new Set<string>();
  for (const p of parts) {
    const s = stretch(p.span);
    const id = `${p.label}|${s.print}`;
    if (done.has(id)) continue;
    done.add(id);
    const bars = Math.max(1, Math.round(map.barAt(p.span.to - EPS).bar - map.barAt(p.span.from + EPS).bar + 1));
    const sig = map.sigAt(p.span.from + EPS);
    out.push(`[${p.label}] ${bars} bar${bars === 1 ? "" : "s"}${sameSig(sig, song.meter) ? "" : ` in ${sigName(sig)}`}`, ...(s.lines.length ? s.lines : ["(no chords)"]), "");
  }
  return out.join("\n");
}

/** Does the song have any chord to print? */
export const hasChords5 = (song: TimelineSong): boolean => song.clips.some((c) => c.kind === "chords" && !c.mute && c.content.chords.length > 0);

/** The song as a MIDI file: every track as notes on a MIDI track of its own, under its name, with its instrument. */
export function midi5(song: TimelineSong, flat: Flat, name: string): Uint8Array {
  const names = Object.fromEntries(song.tracks.map((t) => [t.id, t.name]));
  const tones: Record<string, Tone> = {};
  for (const t of song.tracks) if (t.kind === "chords" || t.kind === "melody" || t.kind === "bass") tones[t.id] = t.tone;
  return progressionToMidi(flat.items, song.bpm, "ring", name || "M-Theory idea", null, null, names, song.meter, tones);
}

/** The whole song as you hear it, every track and the recordings, through the mixer: a WAV file, as long as the song. */
export async function wav5(song: TimelineSong, flat: Flat, rate: number): Promise<Uint8Array> {
  const frames = Math.round((flat.items.reduce((a, x) => a + x.beats, 0) * 60 * rate) / song.bpm);
  const ch = trimEnd(await renderSong(flat.items, { bpm: song.bpm, pattern: "ring", beat: null, rate, tail: 6, fold: false }), rate, frames);
  return encodeWav(ch, rate, safeGain(ch));
}

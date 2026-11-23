/**
 * Standard MIDI File export. Drag the .mid into any recording app and your
 * progression shows up with the exact voicings and rhythm you heard in the app.
 */
import { barBeats, barsOf, beatHitsBetween, type Beat } from "./beats";
import { hasTune, melodyBeats } from "../song/melody";
import type { DrumId } from "./drums";
import { itemNotes, itemTune, meterOf, sectionStart, styleAt, type ExtraPlay, type PatternId, type PlayItem, type PlayTune } from "./patterns";
import { GUITAR, midiProgram, synthOf, type Tone, type Tones } from "./tone";
import { playNotes, type PlayNote } from "../synth/play";
import type { PlaySettings } from "../synth/params";

const TPQ = 480; // ticks per quarter note

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

const str = (s: string) => [...s].map((ch) => ch.charCodeAt(0) & 0x7f);
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** General MIDI drum notes (channel 10), so the beat lands on any DAW's drum kit. */
export const GM_DRUM: Record<DrumId, number> = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, tom: 45, rim: 37, shaker: 70, bell: 56 };

type Sig = { num: number; den: 4 | 8 };
const sameSig = (a: Sig, b: Sig) => a.num === b.num && a.den === b.den;
/** Ticks to the app's beat: in 6/8, 9/8 and 12/8 the beat is a dotted quarter, a beat and a half of the file's quarter notes. */
const ticksPerBeat = (s: Sig) => (s.den === 8 ? TPQ * 1.5 : TPQ);
/** The tempo as the file wants it: microseconds to a quarter note. */
const quarterMicros = (bpm: number, s: Sig) => Math.round(60_000_000 / (bpm * (ticksPerBeat(s) / TPQ)));
const tempoEvent = (bpm: number, s: Sig) => {
  const mpq = quarterMicros(bpm, s);
  return [0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255];
};
/** The time signature: numerator, denominator as a power of two, MIDI clocks per metronome click. */
const sigEvent = (s: Sig) => [0xff, 0x58, 4, s.num, s.den === 8 ? 3 : 2, s.den === 8 ? 36 : 24, 8];

/**
 * Where every beat of the song lands in the file. Each section is in its own time signature;
 * where one goes from simple to compound or back, a beat stops being a quarter note and starts
 * being a dotted one (the tempo still counts beats, as the app does), so the ticks are counted
 * piece by piece.
 */
interface Clock {
  /** the tick a beat falls on (not rounded) */
  at: (beat: number) => number;
  /** ticks to a beat there */
  tpb: (beat: number) => number;
  /** where the signature changes: from which beat and tick, and what to */
  segs: { beat: number; tick: number; sig: Sig }[];
}
function clockOf(items: PlayItem[], first: Sig): Clock {
  const segs: Clock["segs"] = [];
  let beat = 0;
  for (const it of items) {
    const last = segs[segs.length - 1];
    const sig = it.meter?.sig ?? last?.sig ?? first;
    if (!last || !sameSig(last.sig, sig)) segs.push({ beat, tick: last ? last.tick + (beat - last.beat) * ticksPerBeat(last.sig) : 0, sig });
    beat += it.beats;
  }
  if (!segs.length) segs.push({ beat: 0, tick: 0, sig: first });
  const seg = (b: number) => {
    let s = segs[0];
    for (const x of segs) if (x.beat <= b + 1e-9) s = x;
    return s;
  };
  return { at: (b) => { const s = seg(b); return s.tick + (b - s.beat) * ticksPerBeat(s.sig); }, tpb: (b) => ticksPerBeat(seg(b).sig), segs };
}

/**
 * The progression as a MIDI file: the harp, the melody on a track of its own, and the drums on
 * channel 10 (each section with its own rhythm, starting again from its first bar). The tracks
 * added on the Track page come too, each on a track of its own named as in the app (`names`):
 * chords and melodies on their own channels, drums on channel 10. With no chords, the beat is
 * exported as four bars (or its whole pattern if longer), with the melody. Each section's time
 * signature is written where it starts (`sig` is the song's, for items that do not say).
 * Each chords and melody track is written with the General MIDI program of its instrument
 * (the strings as a harp, the pianos as pianos, the synth by the kind of sound): as each section
 * has it (the items carry it), with a change of program where a section on another instrument
 * starts; `tones`, by track id, stands in where the items do not say. A synth track's chords are
 * written as held chords, as they are written in the app, except on a synth that arpeggiates
 * them (in every section it plays): then the notes its arpeggio plays are written (and a melody on
 * such a synth likewise), so the file plays what the app plays.
 */
export function progressionToMidi(items: PlayItem[], bpm: number, pattern: PatternId, name = "M-Theory progression", beat: Beat | null = null, tune: PlayTune | null = null, names: Record<string, string> = {}, sig: Sig = { num: 4, den: 4 }, tones: Tones = {}): Uint8Array {
  /** what plays a track in each item where it plays (undefined where it does not): as its section has it, else as `tones` says, else the strings */
  const toneAt = (id: string): (Tone | undefined)[] =>
    items.map((it) => {
      const own = id === "chords" ? { tone: it.tone } : id === "melody" ? it.tune && { tone: it.tune.tone } : it.extra?.chords.find((c) => c.track === id) ?? (it.extra?.tunes.find((x) => x.track === id) && { tone: it.extra.tunes.find((x) => x.track === id)!.tune.tone });
      return own ? own.tone ?? tones[id] ?? GUITAR : undefined;
    });
  const toneOfTrack = (id: string): Tone => toneAt(id).find((t) => !!t) ?? tones[id] ?? GUITAR;
  const program = (id: string) => midiProgram(toneOfTrack(id));
  /** a synth's chords are written held (in the items where the track plays the synth) */
  const held = (id: string) => {
    const ts = toneAt(id);
    return (i: number) => (ts[i] ?? toneOfTrack(id)).inst === "synth";
  };
  /** the synth's way of playing, if it is an arpeggio (in every item the track plays in) */
  const arpOf = (id: string, kind: "chords" | "melody"): PlaySettings | null => {
    const ts = toneAt(id).filter((t): t is Tone => !!t);
    const plays = (ts.length ? ts : [toneOfTrack(id)]).map((t) => (t.inst === "synth" ? synthOf(t, kind).play : null));
    const play = plays[0];
    return play?.mode === "arp" && plays.every((x) => JSON.stringify(x) === JSON.stringify(play)) ? play : null;
  };
  /** a change of program on a channel wherever a section plays the track on another instrument */
  const switches = (id: string, ch: number): Ev[] => {
    const ts = toneAt(id);
    const out: Ev[] = [];
    let last = program(id);
    let at = 0;
    items.forEach((it, i) => {
      const t = ts[i];
      if (t && midiProgram(t) !== last) {
        last = midiProgram(t);
        out.push({ tick: Math.round(clock.at(at)), data: [0xc0 | ch, last], order: -0.5 });
      }
      at += it.beats;
    });
    return out;
  };
  const drums = beat?.on ? beat : null;
  if (!items.length) {
    // no chords: the drums (four bars, or their whole pattern) and the melody on their own
    const solo = Math.max(drums ? barBeats(drums) * Math.max(4, barsOf(drums)) : 0, hasTune(tune?.m) ? melodyBeats(tune.m, tune.bar) : 0);
    items = solo ? [{ midi: [], beats: solo }] : [];
  }
  const clock = clockOf(items, sig);
  const totalTicks = Math.round(clock.at(items.reduce((a, x) => a + x.beats, 0)));
  const head = clock.segs[0].sig;
  const meta: number[] = [];
  meta.push(0, 0xff, 0x03, ...vlq(str(name).length), ...str(name));
  meta.push(0, ...tempoEvent(bpm, head));
  meta.push(0, ...sigEvent(head));
  // every later change of signature, and of tempo where the beat changes between a quarter and a dotted quarter
  const changes: Ev[] = [];
  clock.segs.slice(1).forEach((s, i) => {
    const tick = Math.round(s.tick);
    const was = clock.segs[i].sig;
    if (quarterMicros(bpm, s.sig) !== quarterMicros(bpm, was)) changes.push({ tick, data: tempoEvent(bpm, s.sig), order: -2 });
    changes.push({ tick, data: sigEvent(s.sig), order: -1 });
  });
  const tracks: number[][] = [];
  // the first track carries the name, tempo and time signature, and the harp
  const chordsArp = arpOf("chords", "chords");
  tracks.push(chordsArp ? arpTrack(arpChords(items, beat, bpm, chordsArp), clock, 0, null, totalTicks, meta, [...changes, ...switches("chords", 0)], program("chords")) : harpTrack(items, pattern, beat, bpm, clock, 0, null, totalTicks, meta, [...changes, ...switches("chords", 0)], program("chords"), held("chords")));
  const tuneArp = arpOf("melody", "melody");
  const melody = tuneArp ? arpTuneTrack(arpTune(items, tune, beat, bpm, tuneArp), clock, 1, "Melody", totalTicks, program("melody"), switches("melody", 1)) : tuneTrack(itemTune(items, tune), clock, 1, "Melody", totalTicks, program("melody"), switches("melody", 1));
  if (melody) tracks.push(melody);
  if (items.some((x) => (x.drums ?? drums)?.on)) tracks.push(drumTrack(items, drums, clock, "Drums", totalTicks));

  // the added tracks
  const ids = { chords: new Set<string>(), tunes: new Set<string>(), drums: new Set<string>() };
  for (const it of items) {
    it.extra?.chords.forEach((c) => ids.chords.add(c.track));
    it.extra?.tunes.forEach((t) => ids.tunes.add(t.track));
    it.extra?.drums.forEach((d) => ids.drums.add(d.track));
  }
  // each track a channel of its own while there are channels (10 is the drums'); past that, a track
  // shares one with a track on the same instrument, as a channel plays one instrument at a time
  const programs = new Map<number, number>([[0, program("chords")], [1, program("melody")]]);
  let ch = 2;
  const nextCh = (prog: number) => {
    if (ch === 9) ch++;
    if (ch <= 15) {
      programs.set(ch, prog);
      return ch++;
    }
    for (const [c, p] of programs) if (p === prog) return c;
    return 15;
  };
  for (const id of ids.chords) {
    // (a chord played by a playing style counts the style from where its clip's content starts, as the player does; a
    // chord on the synth counts from its section's start, as the player does too)
    const own = extraChordItems(items, id, (c) => (c.tone ?? toneOfTrack(id)).inst !== "synth");
    const a = arpOf(id, "chords");
    const ch = nextCh(program(id));
    const heldOwn = (i: number) => (own[i].tone ?? toneOfTrack(id)).inst === "synth";
    tracks.push(a ? arpTrack(arpChords(own, beat, bpm, a), clock, ch, names[id] ?? "Chords", totalTicks, [], switches(id, ch), program(id)) : harpTrack(own, pattern, beat, bpm, clock, ch, names[id] ?? "Chords", totalTicks, [], switches(id, ch), program(id), heldOwn));
  }
  for (const id of ids.tunes) {
    const own = items.map((it) => ({ ...it, tune: it.extra?.tunes.find((x) => x.track === id)?.tune ?? null }));
    const a = arpOf(id, "melody");
    const ch = nextCh(program(id));
    const t = a ? arpTuneTrack(arpTune(own, null, beat, bpm, a), clock, ch, names[id] ?? "Melody", totalTicks, program(id), switches(id, ch)) : tuneTrack(itemTune(own, null), clock, ch, names[id] ?? "Melody", totalTicks, program(id), switches(id, ch));
    if (t) tracks.push(t);
  }
  for (const id of ids.drums) {
    const own = items.map((it) => {
      const b = it.extra?.drums.find((x) => x.track === id)?.beat;
      return { ...it, drums: b ?? { ...(it.drums ?? beat ?? b!), on: false } };
    });
    tracks.push(drumTrack(own, null, clock, names[id] ?? "Drums", totalTicks));
  }
  return new Uint8Array([...str("MThd"), ...u32(6), ...u16(tracks.length > 1 ? 1 : 0), ...u16(tracks.length), ...u16(TPQ), ...tracks.flatMap((t) => [...str("MTrk"), ...u32(t.length), ...t])]);
}

type Ev = { tick: number; data: number[]; order: number };

/** Events in time order, as a track's bytes, ending at `end`. */
function trackOf(head: number[], events: Ev[], end: number): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const t = [...head];
  let last = 0;
  for (const e of events) {
    t.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  t.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0x00);
  return t;
}
const named = (name: string) => [0, 0xff, 0x03, ...vlq(str(name).length), ...str(name)];

/**
 * A chords track: what the playing style plays over each chord, or (`held`) each chord held for
 * its length. (`more`: events that go with it, such as changes of signature.)
 */
function harpTrack(items: PlayItem[], pattern: PatternId, beat: Beat | null, bpm: number, clock: Clock, ch: number, name: string | null, end: number, head: number[] = [], more: Ev[] = [], program = 46, held: boolean | ((item: number) => boolean) = false): number[] {
  const events: Ev[] = [...more];
  // (held in the items that say so: a section on the synth among sections on the strings)
  const notes = typeof held === "function" ? [...itemNotes(items, pattern, beat).filter((n) => !held(n.item)), ...heldNotes(items).filter((n) => held(n.item))] : held ? heldNotes(items) : itemNotes(items, pattern, beat);
  for (const { at, e, beats } of notes) {
    const tpb = clock.tpb(at + e.beat);
    // seconds to ticks there: the playing styles' small delays are in seconds
    const tps = (bpm / 60) * tpb;
    const chordEnd = Math.round(clock.at(at + beats));
    const on = Math.round(clock.at(at + e.beat) + e.delay * tps);
    const lenTicks = Math.min(Number.isFinite(e.length) ? e.length * tpb : Infinity, e.cut !== undefined ? e.cut * tps : Infinity, chordEnd - on);
    const off = Math.max(on + 10, Math.min(chordEnd, Math.round(on + lenTicks)));
    if (on >= end) continue;
    const vel = Math.max(1, Math.min(127, Math.round(e.velocity * 118)));
    // overlapping identical notes: each note-off comes before the next note-on at the same tick
    events.push({ tick: off, data: [0x80 | ch, e.midi, 0], order: 0 });
    events.push({ tick: on, data: [0x90 | ch, e.midi, vel], order: 1 });
  }
  return trackOf([...head, ...(name ? named(name) : []), 0, 0xc0 | ch, program], events, end);
}
/** Every chord's notes, held from its start to its end. */
function heldNotes(items: PlayItem[]): ReturnType<typeof itemNotes> {
  const out: ReturnType<typeof itemNotes> = [];
  let at = 0;
  items.forEach((item, i) => {
    item.midi.forEach((m, slot) => {
      if (m !== null) out.push({ at, item: i, beats: item.beats, e: { beat: 0, delay: 0, midi: m, slot, velocity: 0.75, length: Infinity } });
    });
    at += item.beats;
  });
  return out;
}
/** A note as an arpeggio plays it, in beats from the start of the song. */
type BeatNote = { beat: number; beats: number; midi: number; velocity: number };

/**
 * The song's items section by section (each starting again from its first bar, as the app plays
 * them): where each section starts and ends (in beats) and how long its bars are.
 */
function sectionsOf(items: PlayItem[], beat: Beat | null): { from: number; to: number; origin: number; bar: number }[] {
  const out: { from: number; to: number; origin: number; bar: number }[] = [];
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    const o = sectionStart(item, i, at, origin);
    const last = out[out.length - 1];
    if (!last || Math.abs(o - origin) > 1e-9) out.push({ from: at, to: at + item.beats, origin: o, bar: meterOf(item.drums ?? beat, item.meter).bar });
    else last.to = at + item.beats;
    origin = o;
    at += item.beats;
  });
  return out;
}

/** Written notes (in beats) played the synth's way over one section, as the app plays it (in seconds there, back to beats here). */
function arpSection(written: BeatNote[], sec: { origin: number; bar: number }, bpm: number, play: PlaySettings): BeatNote[] {
  const spb = 60 / Math.max(20, Math.min(400, bpm || 120));
  const notes: PlayNote[] = written.map((n) => ({ midi: n.midi, start: n.beat * spb, length: n.beats * spb, velocity: n.velocity }));
  // (the seed the app's player uses, so a random arpeggio is the one heard)
  return playNotes(notes, play, { bpm: 60 / spb, origin: sec.origin * spb, seed: 11, bar: sec.bar }).map((n) => ({ beat: n.start / spb, beats: n.length / spb, midi: n.midi, velocity: n.velocity }));
}

/** A chords track's chords as its synth's arpeggio plays them, section by section. */
function arpChords(items: PlayItem[], beat: Beat | null, bpm: number, play: PlaySettings): BeatNote[] {
  const out: BeatNote[] = [];
  for (const sec of sectionsOf(items, beat)) {
    const written: BeatNote[] = [];
    let at = 0;
    for (const item of items) {
      if (at >= sec.from - 1e-9 && at < sec.to - 1e-9) for (const m of item.midi) if (m !== null) written.push({ beat: at, beats: item.beats, midi: m, velocity: 0.78 });
      at += item.beats;
    }
    out.push(...arpSection(written, sec, bpm, play));
  }
  return out;
}

/** A melody as its synth's arpeggio plays it: each note held until the next (never past its section's end), then arpeggiated. */
function arpTune(items: PlayItem[], tune: PlayTune | null, beat: Beat | null, bpm: number, play: PlaySettings): BeatNote[] {
  const hits = itemTune(items, tune);
  const out: BeatNote[] = [];
  for (const sec of sectionsOf(items, beat)) {
    const own = hits.filter((h) => h.beat >= sec.from - 1e-9 && h.beat < sec.to - 1e-9);
    const written = own.map((h) => {
      const next = own.find((x) => x.beat > h.beat + 1e-6);
      return { beat: h.beat, beats: (next ? next.beat : sec.to) - h.beat, midi: h.midi, velocity: 0.9 };
    });
    out.push(...arpSection(written, sec, bpm, play));
  }
  return out;
}

/** A track of notes that each have their own length (an arpeggio's). */
function arpTrack(notes: BeatNote[], clock: Clock, ch: number, name: string | null, end: number, head: number[] = [], more: Ev[] = [], program = 46): number[] {
  const events: Ev[] = [...more];
  for (const n of notes) {
    const on = Math.round(clock.at(n.beat));
    if (on >= end) continue;
    const off = Math.max(on + 10, Math.min(end, Math.round(clock.at(n.beat + n.beats))));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 118)));
    // overlapping identical notes: each note-off comes before the next note-on at the same tick
    events.push({ tick: off, data: [0x80 | ch, n.midi, 0], order: 0 });
    events.push({ tick: on, data: [0x90 | ch, n.midi, vel], order: 1 });
  }
  return trackOf([...head, ...(name ? named(name) : []), 0, 0xc0 | ch, program], events, end);
}
/** A melody's arpeggio as a track of its own (none if it plays nothing in the song). */
function arpTuneTrack(notes: BeatNote[], clock: Clock, ch: number, name: string, end: number, program: number, more: Ev[] = []): number[] | null {
  return notes.some((n) => Math.round(clock.at(n.beat)) < end) ? arpTrack(notes, clock, ch, name, end, [], more, program) : null;
}

/** A melody track, each note held until the next one. */
function tuneTrack(hits: { beat: number; midi: number }[], clock: Clock, ch: number, name: string, end: number, program = 46, more: Ev[] = []): number[] | null {
  hits = hits.filter((h) => Math.round(clock.at(h.beat)) < end);
  if (!hits.length) return null;
  const ev: Ev[] = [...more];
  hits.forEach((h, i) => {
    const on = Math.round(clock.at(h.beat));
    const after = hits.slice(i + 1).find((x) => x.beat > h.beat + 1e-6);
    const off = Math.max(on + 10, Math.min(end, after ? Math.round(clock.at(after.beat)) : on + clock.tpb(h.beat) * 2));
    ev.push({ tick: off, data: [0x80 | ch, h.midi, 0], order: 0 });
    ev.push({ tick: on, data: [0x90 | ch, h.midi, 104], order: 1 });
  });
  return trackOf([...named(name), 0, 0xc0 | ch, program], ev, end);
}

/** A drum track on channel 10: each item's rhythm (or `drums`), counted from where its section began. */
function drumTrack(items: PlayItem[], drums: Beat | null, clock: Clock, name: string, end: number): number[] {
  const runs: { from: number; to: number; origin: number; b: Beat | null }[] = [];
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    origin = sectionStart(item, i, at, origin);
    runs.push({ from: at, to: at + item.beats, origin, b: item.drums ?? drums });
    at += item.beats;
  });
  const ev: Ev[] = [];
  const all = runs.flatMap((r) => (r.b?.on ? beatHitsBetween(r.b, r.from - r.origin, r.to - r.origin).map((h) => ({ ...h, beat: h.beat + r.origin })) : []));
  for (const h of all) {
    const on = Math.round(clock.at(h.beat));
    if (on >= end) continue;
    const vel = Math.max(1, Math.min(127, Math.round(h.velocity * 118)));
    ev.push({ tick: on, data: [0x99, GM_DRUM[h.id], vel], order: 1 });
    ev.push({ tick: Math.min(end, on + 60), data: [0x89, GM_DRUM[h.id], 0], order: 0 });
  }
  return trackOf(named(name), ev, end);
}

/**
 * What an added chords track plays, as items of its own: section by section, its chords where
 * they fall in the section, and silence around them, so its playing style counts from the
 * start of each section as it does in the app.
 * `own`: for the chords it says yes to, the style counts from the beat the chord itself names (`from`: where its clip's
 * content starts), as it does when the song plays; a chord that names none counts from the section's start as ever.
 */
export function extraChordItems(items: PlayItem[], track: string, own?: (c: ExtraPlay["chords"][number]) => boolean): PlayItem[] {
  const out: PlayItem[] = [];
  let i = 0;
  while (i < items.length) {
    let j = i + 1;
    while (j < items.length && !items[j].section && items[j].from === undefined) j++;
    const sec = items.slice(i, j);
    const len = sec.reduce((a, x) => a + x.beats, 0);
    const drums = sec[0].drums;
    const meter = sec[0].meter;
    const cs = (sec[0].extra?.chords ?? []).filter((c) => c.track === track && c.at < len - 1e-6).sort((a, b) => a.at - b.at);
    let at = 0;
    const push = (x: PlayItem) => out.push({ ...x, drums, meter, section: at === 0 });
    for (const c of cs) {
      if (c.at > at + 1e-6) {
        push({ midi: [], beats: c.at - at });
        at = c.at;
      }
      const beats = Math.min(c.beats, len - c.at);
      // (an item's own `from` says how far into its section's count it starts: see patterns' `sectionStart`)
      push({ midi: c.midi, beats, style: c.style, feel: c.feel, tone: c.tone, ...(c.from !== undefined && own?.(c) ? { from: styleAt(c) } : {}) });
      at += beats;
    }
    if (at < len - 1e-6) push({ midi: [], beats: len - at });
    i = j;
  }
  return out;
}

// ── Saving files ─────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal uncompressed ("stored") ZIP archive. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const central: number[] = [];
  const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
  const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const offset = chunks.length;
    const common = [...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(f.data.length), ...le32(f.data.length), ...le16(name.length), ...le16(0)];
    chunks.push(...le32(0x04034b50), ...common, ...name, ...f.data);
    central.push(...le32(0x02014b50), ...le16(20), ...common, ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name);
  }
  const cdOffset = chunks.length;
  const end = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length), ...le32(central.length), ...le32(cdOffset), ...le16(0)];
  return new Uint8Array([...chunks, ...central, ...end]);
}

/** Read the first file out of a ZIP made by zipStore (uncompressed entries only). */
export function unzipFirst(zip: Uint8Array): Uint8Array | null {
  if (zip.length < 30 || zip[0] !== 0x50 || zip[1] !== 0x4b || zip[2] !== 3 || zip[3] !== 4) return null;
  const le16 = (o: number) => zip[o] | (zip[o + 1] << 8);
  const le32 = (o: number) => (zip[o] | (zip[o + 1] << 8) | (zip[o + 2] << 16) | (zip[o + 3] << 24)) >>> 0;
  if (le16(8) !== 0) return null; // compressed: not ours
  const start = 30 + le16(26) + le16(28);
  const size = le32(18);
  return start + size <= zip.length ? zip.slice(start, start + size) : null;
}

type DownloadsCap = { save(req: { filename: string; data: Uint8Array | string }): Promise<{ status: string }> };
type ClaudeHost = { use(name: string): Promise<unknown> };

/**
 * Save a file to the user's device. Normally a plain browser download; when the
 * app runs inside a claude.ai artifact (sandboxed, no direct downloads) it asks the
 * viewer through the artifact `downloads` capability. That allowlist has no .mid,
 * so MIDI files travel inside a .zip there.
 * Resolves "saved", "declined" or "failed".
 */
export async function saveFile(bytes: Uint8Array, filename: string, mime = "application/octet-stream"): Promise<"saved" | "declined" | "failed"> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const downloads = (await host.use("downloads").catch(() => null)) as DownloadsCap | null;
    if (!downloads) return "failed";
    let name = filename;
    let data = bytes;
    if (/\.(mid|json)$/i.test(filename)) {
      data = zipStore([{ name: filename, data: bytes }]);
      name = filename.replace(/\.(mid|json)$/i, ".zip");
    }
    try {
      await downloads.save({ filename: name, data });
      return "saved";
    } catch (e) {
      return (e as { code?: string })?.code === "declined" ? "declined" : "failed";
    }
  }
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "saved";
}

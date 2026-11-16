/**
 * Standard MIDI File export. Drag the .mid into any DAW (GarageBand, Logic,
 * Ableton, Reaper, FL…) and your progression shows up with the exact voicings
 * and rhythm you heard in the app.
 */
import { PatternId, patternEvents } from "./patterns";
import type { PlayItem } from "./synth";

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

export function progressionToMidi(items: PlayItem[], bpm: number, pattern: PatternId, name = "M-Theory progression"): Uint8Array {
  type Ev = { tick: number; data: number[]; order: number };
  const events: Ev[] = [];
  const secPerTick = 60 / bpm / TPQ;
  let chordStart = 0;
  for (const item of items) {
    const chordEnd = chordStart + item.beats * TPQ;
    for (const e of patternEvents(item.midi, item.beats, pattern)) {
      const notes = e.dir === "up" ? [...e.notes].reverse() : e.notes;
      notes.forEach((note, i) => {
        const on = Math.round(chordStart + e.beat * TPQ + (i * e.spread) / secPerTick);
        const lenTicks = Number.isFinite(e.length) ? e.length * TPQ : chordEnd - on;
        const off = Math.max(on + 10, Math.min(chordEnd, Math.round(on + lenTicks)));
        const vel = Math.max(1, Math.min(127, Math.round(e.velocity * 110)));
        events.push({ tick: off, data: [0x80, note, 0], order: 0 });
        events.push({ tick: on, data: [0x90, note, vel], order: 1 });
      });
    }
    chordStart = chordEnd;
  }
  // overlapping identical notes: make sure each note-off precedes the next note-on at the same tick
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  const meta = (type: number, bytes: number[]) => track.push(0, 0xff, type, ...vlq(bytes.length), ...bytes);
  meta(0x03, str(name));
  const mpq = Math.round(60_000_000 / bpm);
  meta(0x51, [(mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255]);
  meta(0x58, [4, 2, 24, 8]);
  track.push(0, 0xc0, 25); // Acoustic Guitar (steel)
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  track.push(...vlq(Math.max(0, chordStart - last)), 0xff, 0x2f, 0x00);

  const bytes = [...str("MThd"), ...u32(6), ...u16(0), ...u16(1), ...u16(TPQ), ...str("MTrk"), ...u32(track.length), ...track];
  return new Uint8Array(bytes);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "audio/midi") {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

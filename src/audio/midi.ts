/**
 * Standard MIDI File export. Drag the .mid into any DAW (GarageBand, Logic,
 * Ableton, Reaper, FL…) and your progression shows up with the exact voicings
 * and rhythm you heard in the app.
 */
import { barBeats, barsOf, beatHitsBetween, type Beat } from "./beats";
import { hasTune, melodyBeats } from "../song/melody";
import type { DrumId } from "./drums";
import { itemNotes, itemTune, type PatternId, type PlayItem, type PlayTune } from "./patterns";

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

/**
 * The progression as a MIDI file. With a beat switched on, the file has two tracks:
 * harp, and drums on channel 10. Items can carry their own drum rhythm (song sections); a
 * section's pattern starts again from its first bar. A melody gets a track of its own. With no
 * chords, the beat is exported as four bars (or its whole pattern if longer), with the melody.
 */
export function progressionToMidi(items: PlayItem[], bpm: number, pattern: PatternId, name = "M-Theory progression", beat: Beat | null = null, tune: PlayTune | null = null): Uint8Array {
  type Ev = { tick: number; data: number[]; order: number };
  const drums = beat?.on ? beat : null;
  if (!items.length) {
    // no chords: the drums (four bars, or their whole pattern) and the melody on their own
    const solo = Math.max(drums ? barBeats(drums) * Math.max(4, barsOf(drums)) : 0, hasTune(tune?.m) ? melodyBeats(tune.m, tune.bar) : 0);
    items = solo ? [{ midi: [], beats: solo }] : [];
  }
  const events: Ev[] = [];
  const secPerTick = 60 / bpm / TPQ;
  const chordStart = Math.round(items.reduce((a, x) => a + x.beats, 0) * TPQ);
  for (const { at, e, beats } of itemNotes(items, pattern, beat)) {
    const chordEnd = Math.round((at + beats) * TPQ);
    const on = Math.round((at + e.beat) * TPQ + e.delay / secPerTick);
    const lenTicks = Math.min(Number.isFinite(e.length) ? e.length * TPQ : Infinity, e.cut !== undefined ? e.cut / secPerTick : Infinity, chordEnd - on);
    const off = Math.max(on + 10, Math.min(chordEnd, Math.round(on + lenTicks)));
    const vel = Math.max(1, Math.min(127, Math.round(e.velocity * 118)));
    events.push({ tick: off, data: [0x80, e.midi, 0], order: 0 });
    events.push({ tick: on, data: [0x90, e.midi, vel], order: 1 });
  }
  // overlapping identical notes: make sure each note-off precedes the next note-on at the same tick
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  const meta = (type: number, bytes: number[]) => track.push(0, 0xff, type, ...vlq(bytes.length), ...bytes);
  meta(0x03, str(name));
  const mpq = Math.round(60_000_000 / bpm);
  meta(0x51, [(mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255]);
  meta(0x58, [4, 2, 24, 8]);
  track.push(0, 0xc0, 46); // Orchestral Harp
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  const totalTicks = chordStart;
  track.push(...vlq(Math.max(0, totalTicks - last)), 0xff, 0x2f, 0x00);
  const chunk = (t: number[]) => [...str("MTrk"), ...u32(t.length), ...t];
  // the melody: its own track on channel 2, each note held until the next one
  const tracks = [track];
  const hits = itemTune(items, tune).filter((h) => Math.round(h.beat * TPQ) < totalTicks);
  if (hits.length) {
    const ev: Ev[] = [];
    hits.forEach((h, i) => {
      const on = Math.round(h.beat * TPQ);
      const after = hits.slice(i + 1).find((x) => x.beat > h.beat + 1e-6);
      const off = Math.max(on + 10, Math.min(totalTicks, after ? Math.round(after.beat * TPQ) : on + TPQ * 2));
      ev.push({ tick: off, data: [0x81, h.midi, 0], order: 0 });
      ev.push({ tick: on, data: [0x91, h.midi, 104], order: 1 });
    });
    ev.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const mt: number[] = [0, 0xff, 0x03, ...vlq(6), ...str("Melody"), 0, 0xc1, 46];
    let ml = 0;
    for (const e of ev) {
      mt.push(...vlq(e.tick - ml), ...e.data);
      ml = e.tick;
    }
    mt.push(...vlq(Math.max(0, totalTicks - ml)), 0xff, 0x2f, 0x00);
    tracks.push(mt);
  }
  if (!drums) return new Uint8Array([...str("MThd"), ...u32(6), ...u16(tracks.length > 1 ? 1 : 0), ...u16(tracks.length), ...u16(TPQ), ...tracks.flatMap(chunk)]);

  // which rhythm plays when: each item (or the whole export, with no chords) and where its pattern began
  const runs: { from: number; to: number; origin: number; b: Beat }[] = [];
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    if (i === 0 || item.section) origin = at;
    runs.push({ from: at, to: at + item.beats, origin, b: item.drums ?? drums });
    at += item.beats;
  });
  const dhits: Ev[] = [];
  const all = runs.flatMap((r) => (r.b.on ? beatHitsBetween(r.b, r.from - r.origin, r.to - r.origin).map((h) => ({ ...h, beat: h.beat + r.origin })) : []));
  for (const h of all) {
    const on = Math.round(h.beat * TPQ);
    if (on >= totalTicks) continue;
    const vel = Math.max(1, Math.min(127, Math.round(h.velocity * 118)));
    dhits.push({ tick: on, data: [0x99, GM_DRUM[h.id], vel], order: 1 });
    dhits.push({ tick: Math.min(totalTicks, on + 60), data: [0x89, GM_DRUM[h.id], 0], order: 0 });
  }
  dhits.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const dtrack: number[] = [0, 0xff, 0x03, ...vlq(5), ...str("Drums")];
  let dl = 0;
  for (const e of dhits) {
    dtrack.push(...vlq(e.tick - dl), ...e.data);
    dl = e.tick;
  }
  dtrack.push(...vlq(Math.max(0, totalTicks - dl)), 0xff, 0x2f, 0x00);
  tracks.push(dtrack);
  return new Uint8Array([...str("MThd"), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(TPQ), ...tracks.flatMap(chunk)]);
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

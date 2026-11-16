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
    if (/\.mid$/i.test(filename)) {
      data = zipStore([{ name: filename, data: bytes }]);
      name = filename.replace(/\.mid$/i, ".zip");
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

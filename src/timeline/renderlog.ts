// A helper for the tests (not part of the app): everything a list of items asks of the audio engine, written down.
//
// It plays the list on the pretend audio context the audio tests use, as an offline render or on the live player,
// and records every note each track's voice is asked for, every drum hit, every change of a piano's pedal and every
// recorded take that is started. Two lists that give the same record sound the same: this is how a converted song is
// held to its original. (It compares what is asked of the audio graph, not samples: plucked strings and loosened
// drums use random numbers, and the tests have no real audio engine.)
import { vi } from "vitest";
import type { FakeSource } from "../keys/fakeaudio";
import { FakeAudio, FakeOffline } from "../audio/fakectx";
import { kitOfBeat, kitSig, type Beat } from "../audio/beats";
import type { PlayItem } from "../audio/patterns";
import type { TrackVoice } from "../audio/trackvoice";

export interface RenderLog {
  /** every note asked of a track's voice */
  notes: { track: string; midi: number; when: number; velocity: number; length: number; slot?: number }[];
  /** every voice that was asked for a note or a pedal change: its tone and its sound, as JSON */
  voices: { track: string; tone: string; sound: string }[];
  /** every drum hit; `kit` is the kit's signature (the same for the same sound) */
  hits: { track: string; drum: string; level: number; when: number; kit: string }[];
  /** every change of pedal on a piano that has its pedal on */
  pedals: { track: string; when: number }[];
  /** every recorded take started: `take` is its buffer's label */
  takes: { track: string; take: string; when: number; offset: number; dur: number }[];
}

/** A pretend decoded take, for a test's `buffer`: `label` is what the record says was started. */
export const fakeBuffer = (label: string, seconds: number): AudioBuffer => ({ duration: seconds, label }) as unknown as AudioBuffer;

let live: FakeAudio | null = null;
/** the record being written, and the context whose takes go into it */
let sink: { log: RenderLog; ctx: FakeAudio | null; tracks: string[]; rename: (t: string) => string; fader: (track: string, c: BaseAudioContext) => unknown } | null = null;

/** Every buffer source a context starts that plays a labelled take goes into the record, with the track whose fader it reaches. */
function watch(c: FakeAudio) {
  const make = c.createBufferSource.bind(c);
  c.createBufferSource = () => {
    const s = make() as unknown as FakeSource;
    const go = s.start.bind(s);
    (s as unknown as { start: (when?: number, offset?: number, dur?: number) => void }).start = (when = 0, offset = 0, dur?: number) => {
      const label = (s.buffer as unknown as { label?: string } | null)?.label;
      if (sink && sink.ctx === c && label !== undefined) {
        const out = s.outputs[0]?.outputs[0];
        const track = sink.tracks.find((t) => sink!.fader(t, c as unknown as BaseAudioContext) === out) ?? "?";
        sink.log.takes.push({ track: sink.rename(track), take: label, when, offset, dur: dur ?? Infinity });
      }
      go(when, offset);
    };
    return s as never;
  };
}
class LiveCtx extends FakeAudio {
  constructor() {
    super();
    live = this;
    watch(this);
  }
}
class Render extends FakeOffline {
  constructor(_channels: number, length: number, rate: number) {
    super(rate, length);
    if (sink) sink.ctx = this;
    watch(this);
  }
}

/** Set the pretend audio up, write down what `run` asks of it, and put everything back. */
async function record(items: PlayItem[], rename: (t: string) => string, onLive: boolean, run: (S: typeof import("../audio/synth"), log: RenderLog) => Promise<void> | void): Promise<RenderLog> {
  const log: RenderLog = { notes: [], voices: [], hits: [], pedals: [], takes: [] };
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", LiveCtx);
  vi.stubGlobal("OfflineAudioContext", Render);
  // the live player keeps its voices from one ▶ to the next: each record starts from a fresh engine, as a fresh app does
  if (onLive) vi.resetModules();
  const drumbus = await import("../audio/drumbus");
  const S = await import("../audio/synth");
  const { fader, setMix } = await import("../audio/mix");
  const { Harp } = await import("../audio/plucked");
  const { TrackVoice } = await import("../audio/trackvoice");
  setMix(undefined);
  const tracks = [...new Set(items.flatMap((it) => (it.extra?.takes ?? []).map((k) => k.track)))];
  const nameOf = (v: TrackVoice) => rename(v.track ?? (v.kind === "melody" ? "melody" : "chords"));
  const seen = new Set<string>();
  const voice = (v: TrackVoice) => {
    const x = { track: nameOf(v), tone: JSON.stringify(v.tone), sound: JSON.stringify(v.sound) };
    const k = `${x.track}|${x.tone}|${x.sound}`;
    if (!seen.has(k)) seen.add(k), log.voices.push(x);
  };
  const spies = [
    vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never),
    vi.spyOn(TrackVoice.prototype, "prepare").mockResolvedValue(undefined),
    vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, midi: number, when: number, velocity: number, length: number, o?: { slot?: number }) {
      voice(this);
      log.notes.push({ track: nameOf(this), midi, when, velocity, length, ...(o?.slot !== undefined ? { slot: o.slot } : {}) });
    }),
    vi.spyOn(TrackVoice.prototype, "repedal").mockImplementation(function (this: TrackVoice, at: number) {
      // (only a piano with its pedal on changes pedal: on anything else the call does nothing)
      if (this.tone.inst !== "piano" || !this.tone.pedal) return;
      voice(this);
      log.pedals.push({ track: nameOf(this), when: at });
    }),
    vi.spyOn(drumbus, "playStep").mockImplementation((b: Beat, id: string, level: number, when: number, track = drumbus.FIRST_DRUMS) => {
      log.hits.push({ track: rename(track), drum: id, level, when, kit: kitSig(kitOfBeat(b)) });
    }),
  ];
  sink = { log, ctx: null, tracks, rename, fader };
  try {
    if (onLive) {
      S.getAudio();
      sink.ctx = liveCtx();
      liveCtx().currentTime = 0;
    }
    await run(S, log);
  } finally {
    sink = null;
    for (const s of spies) s.mockRestore();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
  return log;
}
const liveCtx = (): FakeAudio => live!;

/** What an offline render of the items asks for (a WAV, the recording backing). `rename`: a track's id as the record should name it. */
export async function renderLog(items: PlayItem[], bpm: number, rename: (track: string) => string = (t) => t): Promise<RenderLog> {
  return record(items, rename, false, async (S) => {
    await S.renderSong(items, { bpm, pattern: "ring", beat: null, rate: 8000 });
  });
}

/**
 * What the live player asks for, the clock run from ▶ for `seconds` (the song's length and a little more when not
 * given; going round, give it). Times are counted from the moment ▶ was pressed.
 */
export async function liveLog(items: PlayItem[], bpm: number, o: { loop?: boolean; seconds?: number; from?: number; rename?: (track: string) => string; steps?: { at: number; run(p: import("../audio/synth").ProgressionPlayer): void }[] } = {}): Promise<RenderLog> {
  const total = (items.reduce((a, x) => a + x.beats, 0) * 60) / bpm;
  const seconds = o.seconds ?? total + 0.5;
  return record(items, o.rename ?? ((t) => t), true, (S) => {
    const c = liveCtx();
    const p = new S.ProgressionPlayer();
    p.start(items, bpm, "ring", !!o.loop, null, o.from ?? 0, null);
    // (`steps`: things done to the player while it plays, each once the clock has reached its moment)
    const steps = [...(o.steps ?? [])].sort((a, b) => a.at - b.at);
    while (c.currentTime < seconds - 1e-9) {
      while (steps.length && steps[0].at <= c.currentTime + 1e-9) steps.shift()!.run(p);
      c.currentTime = Math.min(seconds, c.currentTime + 0.01);
      vi.advanceTimersByTime(10);
    }
    p.stop();
  }).then((log) => {
    // the player books a whole item's chords the moment the item comes up, so how far past the last moment the record
    // reaches depends on where the items are cut, not on what is played: only what sounds by then is kept
    const by = <T extends { when: number }>(xs: T[]) => xs.filter((x) => x.when < seconds);
    return { ...log, notes: by(log.notes), hits: by(log.hits), pedals: by(log.pedals), takes: by(log.takes) };
  });
}

/** The differences between two records (none: they ask for the same). Times may differ by `tol` seconds. */
export function logDiff(a: RenderLog, b: RenderLog, tol = 1e-6): string[] {
  const out: string[] = [];
  const near = (x: number, y: number) => x === y || Math.abs(x - y) <= tol;
  const pair = <T,>(what: string, xs: T[], ys: T[], key: (x: T) => string, same: (x: T, y: T) => boolean, show: (x: T) => string) => {
    if (xs.length !== ys.length) out.push(`${what}: ${xs.length} before, ${ys.length} after`);
    const left = new Map<string, T[]>();
    for (const y of ys) left.set(key(y), [...(left.get(key(y)) ?? []), y]);
    for (const x of xs) {
      const pool = left.get(key(x)) ?? [];
      const i = pool.findIndex((y) => same(x, y));
      if (i < 0) out.push(`${what} only before: ${show(x)}`);
      else pool.splice(i, 1);
    }
    for (const pool of left.values()) for (const y of pool) out.push(`${what} only after: ${show(y)}`);
  };
  pair("note", a.notes, b.notes, (n) => `${n.track}|${n.midi}|${n.slot ?? ""}`, (x, y) => near(x.when, y.when) && near(x.velocity, y.velocity) && near(x.length, y.length), (n) => JSON.stringify(n));
  pair("hit", a.hits, b.hits, (h) => `${h.track}|${h.drum}|${h.level}|${h.kit}`, (x, y) => near(x.when, y.when), (h) => JSON.stringify({ ...h, kit: h.kit.length }));
  pair("pedal", a.pedals, b.pedals, (p) => p.track, (x, y) => near(x.when, y.when), (p) => JSON.stringify(p));
  pair("take", a.takes, b.takes, (t) => `${t.track}|${t.take}`, (x, y) => near(x.when, y.when) && near(x.offset, y.offset) && near(x.dur, y.dur), (t) => JSON.stringify(t));
  return out;
}

/** A MIDI file's tracks, each with its name and its note events in order (for comparing two exports). */
export function midiTracks(file: Uint8Array): { name: string; notes: { tick: number; on: boolean; midi: number; vel: number }[] }[] {
  const out: { name: string; notes: { tick: number; on: boolean; midi: number; vel: number }[] }[] = [];
  const u32 = (o: number) => ((file[o] << 24) | (file[o + 1] << 16) | (file[o + 2] << 8) | file[o + 3]) >>> 0;
  let at = 8 + u32(4);
  while (at + 8 <= file.length) {
    const len = u32(at + 4);
    const end = at + 8 + len;
    let i = at + 8;
    let tick = 0;
    let name = "";
    const notes: { tick: number; on: boolean; midi: number; vel: number }[] = [];
    const vlq = () => {
      let v = 0;
      for (;;) {
        const b = file[i++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
    };
    while (i < end) {
      tick += vlq();
      const status = file[i++];
      if (status === 0xff) {
        const type = file[i++];
        const n = vlq();
        if (type === 0x03 && !name) name = String.fromCharCode(...file.slice(i, i + n));
        i += n;
      } else if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
        notes.push({ tick, on: (status & 0xf0) === 0x90 && file[i + 1] > 0, midi: file[i], vel: file[i + 1] });
        i += 2;
      } else if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) i += 1;
      else i += 2;
    }
    out.push({ name, notes });
    at = end;
  }
  return out;
}

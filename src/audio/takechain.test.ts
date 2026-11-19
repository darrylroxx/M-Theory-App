/**
 * A take from the moment it is sung to the moment it is heard: the engine's report (the round
 * trip, the count-in, the loop's length), the cut into takes, the take laid in the song, and
 * the player starting it. A singer exactly on the beat is a click on every beat of every pass;
 * wherever and however the song is played back, each click must be heard on the beat it was
 * sung on (within a millisecond), and only once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio } from "./fakectx";
import { Harp } from "./plucked";
import { setMix } from "./mix";
import type { ExtraPlay, PlayItem } from "./patterns";
import { cutTakes, type Recorded, type Take } from "../song/takes";
import { layClips, wholeClip } from "../song/clips";

let live: FakeAudio;
class LiveCtx extends FakeAudio {
  constructor(rate?: number) {
    super();
    void rate;
    live = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", LiveCtx);
  vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never);
  setMix(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const S = await import("./synth");

/** A song: its sections in order, each so many bars of so many beats (A 4/4, B 6/8, C 3/4 …). */
type Sec = { block: string; bars: number; bar: number };
const SONG: Sec[] = [
  { block: "a", bars: 2, bar: 4 },
  { block: "b", bars: 2, bar: 3 },
  { block: "a2", bars: 2, bar: 4 },
  { block: "c", bars: 3, bar: 3 },
];
const startOf = (song: Sec[], block: string) => {
  let at = 0;
  for (const s of song) {
    if (s.block === block) return at;
    at += s.bars * s.bar;
  }
  throw new Error(block);
};
type Bar = { block: string; bar: number };
/** The bars from one to another, in the song's order. */
function barsBetween(song: Sec[], from: Bar, to: Bar): (Bar & { beats: number; abs: number })[] {
  const out: (Bar & { beats: number; abs: number })[] = [];
  let on = false;
  for (const s of song)
    for (let k = 0; k < s.bars; k++) {
      if (s.block === from.block && k === from.bar) on = true;
      if (on) out.push({ block: s.block, bar: k, beats: s.bar, abs: startOf(song, s.block) + k * s.bar });
      if (s.block === to.block && k === to.bar) return out;
    }
  return out;
}

/**
 * What the engine hands back after a session over the bars `from`..`to` (all between, as Vocals
 * records a loop): `passes` whole passes and `tail` frames more. The singer is exactly on the
 * beat: a click on every beat of every pass, captured `rt` ms after it was heard. Returns the
 * report and where the clicks are in the file (with the beat of the loop each is).
 */
function session(o: { song: Sec[]; from: Bar; to: Bar; bpm: number; rate: number; rt: number; countIn: number; passes: number; tail?: number }) {
  const bars = barsBetween(o.song, o.from, o.to);
  const loopBeats = bars.reduce((a, b) => a + b.beats, 0);
  const spb = 60 / o.bpm;
  // as the engine counts: a beat in frames, the count-in in the meter of the loop's first bar
  const beat = (o.rate * 60) / o.bpm;
  const count_in = Math.round(beat * o.countIn * bars[0].beats);
  // the backing as renderSong makes it: the loop's length, to the nearest frame
  const loop_frames = Math.max(1, Math.round(loopBeats * spb * o.rate));
  const offset = Math.round((o.rt / 1000) * o.rate);
  const frames = offset + count_in + o.passes * loop_frames + (o.tail ?? 0);
  const clicks: { at: number; pass: number; beat: number }[] = [];
  for (let n = 0; n <= o.passes; n++)
    for (let b = 0; b < loopBeats; b++) {
      // heard at song frame count_in + n·loop + b·spb·rate, captured rt later: that far into the file
      const at = offset + count_in + n * loop_frames + b * spb * o.rate;
      if (at < frames) clicks.push({ at, pass: n + 1, beat: b });
    }
  const r: Recorded = { dry: "rec.wav", wet: "rec-wet-1.wav", rate: o.rate, frames, offset, count_in, loop_frames, dropped: 0 };
  return { r, clicks, loopBeats };
}

let ids = 0;
const newId = () => `t${++ids}`;

/** The play list of some bars of the song (one item a bar, as the page makes it), with the takes laid in each section. */
function listOf(song: Sec[], runs: { from: Bar; to: Bar }[], takes: Take[], bpm: number) {
  const laid = layClips(song.map((s) => ({ block: s.block, bar: s.bar, beats: s.bars * s.bar })), takes.map((take) => ({ clip: wholeClip(take, take.id), take })), bpm);
  const extras: Record<string, ExtraPlay> = {};
  for (const s of song) {
    const list = laid[s.block];
    if (list.length) extras[s.block] = { chords: [], tunes: [], drums: [], takes: list.map(({ take, at }) => ({ track: "v1", buffer: { duration: take.frames / take.rate, take } as unknown as AudioBuffer, at, offset: 0, dur: take.frames / take.rate, id: take.id })) };
  }
  const items: PlayItem[] = [];
  /** where each item is in the song (beats from its start) */
  const abs: number[] = [];
  runs.forEach((run, k) =>
    barsBetween(song, run.from, run.to).forEach((b, n) => {
      items.push({ midi: [], beats: b.beats, from: b.bar * b.beats, section: n === 0 || b.bar === 0, meter: { bar: b.beats }, extra: extras[b.block], ...(k > 0 && n === 0 ? { jump: true } : {}) });
      abs.push(b.abs);
    }),
  );
  return { items, abs };
}
/** The whole song, straight through (each section's bars counted from its start, as the page lists them). */
function songList(song: Sec[], takes: Take[], bpm: number) {
  const l = listOf(song, [{ from: { block: song[0].block, bar: 0 }, to: { block: song[song.length - 1].block, bar: song[song.length - 1].bars - 1 } }], takes, bpm);
  return { items: l.items.map(({ from: _, ...x }) => x), abs: l.abs };
}

/** Every take source the player starts: when, from where in the take, for how long, and when it was stopped. */
function capture() {
  const out: { take: Take; when: number; offset: number; dur: number; stops: number[] }[] = [];
  const make = live.createBufferSource.bind(live);
  live.createBufferSource = () => {
    const s = make() as unknown as { buffer: { take?: Take } | null; start: (w?: number, o?: number, d?: number) => void; stops: number[] };
    const go = s.start.bind(s);
    s.start = (when = 0, offset = 0, dur = Infinity) => {
      if (s.buffer?.take) out.push({ take: s.buffer.take, when, offset, dur, stops: s.stops });
      go(when, offset);
    };
    return s as never;
  };
  return out;
}
/** Let the clock run to `to`, the player's timers with it. */
function runTo(to: number) {
  while (live.currentTime < to - 1e-9) {
    live.currentTime = Math.min(to, live.currentTime + 0.05);
    vi.advanceTimersByTime(30);
  }
}

/**
 * Play `list` (from item `from`, round and round if `loop`) until `until` seconds in, and hear
 * every click of the takes: when, and where in the song that is (beats from the song's start),
 * against where it was sung.
 */
function play(list: { items: PlayItem[]; abs: number[] }, o: { bpm: number; loop: boolean; from?: number; until: number; stall?: { at: number; by: number } }, sung: { take: Take; clicks: { at: number; beat: number }[]; begin: number }[]) {
  S.getAudio();
  live.currentTime = 0;
  const srcs = capture();
  const p = new S.ProgressionPlayer();
  p.start(list.items, o.bpm, "ring", o.loop, null, o.from ?? 0);
  const t0 = 0.08;
  if (o.stall) {
    // the page is busy (a heavy page drawn): the clock runs on, the player's timers do not
    runTo(o.stall.at);
    live.currentTime += o.stall.by;
  }
  runTo(o.until);
  p.stop();
  const spb = 60 / o.bpm;
  // where the music is at a moment: which item, how far into it, so where in the song
  const first = o.from ?? 0;
  const lens = list.items.map((x) => x.beats);
  const passBeats = lens.slice(o.loop ? 0 : first).reduce((a, b) => a + b, 0);
  const songAt = (t: number): number => {
    let into = (t - t0) / spb;
    if (o.loop) into %= passBeats;
    // (a click a hair before a pass ends is the next pass's first beat)
    if (o.loop && passBeats - into < 1e-6) into = 0;
    for (let i = o.loop ? 0 : first; i < lens.length; i++) {
      if (into < lens[i] - 1e-9) return list.abs[i] + into;
      into -= lens[i];
    }
    return NaN;
  };
  const heard: { t: number; song: number; sung: number }[] = [];
  for (const s of srcs) {
    const mine = sung.find((x) => x.take === s.take);
    if (!mine) continue;
    const stop = Math.min(s.when + s.dur, ...s.stops.filter((w) => w > 0), o.until);
    for (const c of mine.clicks) {
      const tau = (c.at - s.take.start) / s.take.rate;
      if (tau < 0 || tau >= s.take.frames / s.take.rate) continue;
      const t = s.when + (tau - s.offset);
      if (tau < s.offset - 1e-9 || t >= stop - 1e-9) continue;
      heard.push({ t, song: songAt(t), sung: mine.begin + c.beat });
    }
  }
  heard.sort((a, b) => a.t - b.t);
  return { heard, srcs, spb };
}
/** Each click heard where it was sung (within 1 ms), and no click heard twice (nothing within 20 ms of another). */
function onTheBeat(h: ReturnType<typeof play>) {
  expect(h.heard.length).toBeGreaterThan(0);
  for (const x of h.heard) expect(Math.abs(x.song - x.sung) * h.spb).toBeLessThan(0.001);
  for (let i = 1; i < h.heard.length; i++) expect(h.heard[i].t - h.heard[i - 1].t).toBeGreaterThan(0.02);
}

describe("a take is heard on the beat it was sung on", () => {
  const cases: { name: string; rate: number; rt: number; countIn: number; bpm: number; from: Bar; to: Bar }[] = [];
  for (const rate of [48000, 44100])
    for (const rt of [0, 5, 12])
      for (const countIn of [0, 1, 2]) cases.push({ name: `${rate / 1000} kHz, ${rt} ms round trip, ${countIn}-bar count-in, a 4/4 section`, rate, rt, countIn, bpm: 97, from: { block: "a", bar: 0 }, to: { block: "a", bar: 1 } });
  cases.push({ name: "a 6/8 section", rate: 48000, rt: 5, countIn: 1, bpm: 113, from: { block: "b", bar: 0 }, to: { block: "b", bar: 1 } });
  cases.push({ name: "a 3/4 section, from its second bar", rate: 48000, rt: 12, countIn: 2, bpm: 131, from: { block: "c", bar: 1 }, to: { block: "c", bar: 2 } });
  cases.push({ name: "a loop from 4/4 across 6/8 into 4/4", rate: 44100, rt: 12, countIn: 1, bpm: 88, from: { block: "a", bar: 1 }, to: { block: "a2", bar: 0 } });

  for (const c of cases)
    it(`${c.name}: every pass, looped`, () => {
      const { r, clicks } = session({ song: SONG, from: c.from, to: c.to, bpm: c.bpm, rate: c.rate, rt: c.rt, countIn: c.countIn, passes: 3, tail: 1234 });
      const takes = cutTakes(r, { group: "g", at: c.from, id: newId });
      expect(takes.filter((t) => !t.short)).toHaveLength(3);
      for (const take of takes.filter((t) => !t.short)) {
        const list = listOf(SONG, [{ from: c.from, to: c.to }], [take], c.bpm);
        const loop = list.items.reduce((a, x) => a + x.beats, 0) * (60 / c.bpm);
        const h = play(list, { bpm: c.bpm, loop: true, until: 0.08 + loop * 2.5 }, [{ take, clicks: clicks.filter((k) => k.pass === take.n), begin: startOf(SONG, c.from.block) + c.from.bar * SONG.find((s) => s.block === c.from.block)!.bar }]);
        onTheBeat(h);
        // every beat of the loop, every time round (two and a half times round: 2.5 × the beats)
        const beats = list.items.reduce((a, x) => a + x.beats, 0);
        expect(h.heard.length).toBe(Math.ceil(beats * 2.5 - 1e-9));
      }
    });

  it("played through the song from its start, or from its own section; and from the middle of the take (a loop of its second bar)", () => {
    const from = { block: "b", bar: 0 };
    const { r, clicks } = session({ song: SONG, from, to: { block: "b", bar: 1 }, bpm: 104, rate: 48000, rt: 7, countIn: 1, passes: 2 });
    const take = cutTakes(r, { group: "g", at: from, id: newId })[1];
    const sung = [{ take, clicks: clicks.filter((k) => k.pass === 2), begin: startOf(SONG, "b") }];
    const list = songList(SONG, [take], 104);
    const whole = play(list, { bpm: 104, loop: false, until: 20 }, sung);
    onTheBeat(whole);
    expect(whole.heard).toHaveLength(6);
    // ▶ on B's page: from B's start
    const own = play(list, { bpm: 104, loop: false, from: 2, until: 20 }, sung);
    onTheBeat(own);
    expect(own.heard).toHaveLength(6);
    // B's second bar looping: the take is under way there, so it comes in part-way, in its place, every time round
    const mid = play(listOf(SONG, [{ from: { block: "b", bar: 1 }, to: { block: "b", bar: 1 } }], [take], 104), { bpm: 104, loop: true, until: 0.08 + 3 * (60 / 104) * 3 }, sung);
    onTheBeat(mid);
    expect(mid.heard).toHaveLength(9);
    expect(mid.heard.every((x) => x.sung >= startOf(SONG, "b") + 3)).toBe(true);
  });

  it("a loop of sections apart (A and C): recorded from A to C with all between, each part heard over its own section", () => {
    const from = { block: "a", bar: 0 };
    const to = { block: "c", bar: 2 };
    const { r, clicks } = session({ song: SONG, from, to, bpm: 120, rate: 48000, rt: 12, countIn: 1, passes: 2 });
    const take = cutTakes(r, { group: "g", at: from, id: newId })[0];
    // the loop as it plays: A, then a jump to C
    const list = listOf(SONG, [{ from, to: { block: "a", bar: 1 } }, { from: { block: "c", bar: 0 }, to }], [take], 120);
    const h = play(list, { bpm: 120, loop: true, until: 0.08 + 8.5 * 2 }, [{ take, clicks: clicks.filter((k) => k.pass === 1), begin: 0 }]);
    onTheBeat(h);
    // A's 8 beats and C's 9, twice round; never the bits sung over B and the second A
    expect(h.heard).toHaveLength(34);
    expect(h.heard.every((x) => x.song < 8 || x.song >= startOf(SONG, "c"))).toBe(true);
  });

  it("the page busy for 0.6 s while the song plays (another page drawn): a take started late starts that much further in", () => {
    const from = { block: "a", bar: 0 };
    const { r, clicks } = session({ song: SONG, from, to: { block: "a", bar: 1 }, bpm: 120, rate: 48000, rt: 5, countIn: 1, passes: 2 });
    const take = cutTakes(r, { group: "g", at: from, id: newId })[0];
    const list = listOf(SONG, [{ from, to: { block: "a", bar: 1 } }], [take], 120);
    // the loop comes round at 4.08 s; the timers stop at 3.7 s (before it is scheduled) and the clock runs on 0.6 s
    const h = play(list, { bpm: 120, loop: true, until: 9, stall: { at: 3.7, by: 0.6 } }, [{ take, clicks: clicks.filter((k) => k.pass === 1), begin: 0 }]);
    onTheBeat(h);
    const late = h.srcs.filter((s) => s.when > 4);
    expect(late[0].offset).toBeGreaterThan(0.2);
  });

  it("after a change of tempo the take still starts on its bar; after a change of time signature, on the bar it was sung from", () => {
    const from = { block: "a", bar: 1 };
    const { r, clicks } = session({ song: SONG, from, to: { block: "a", bar: 1 }, bpm: 90, rate: 48000, rt: 5, countIn: 1, passes: 1 });
    const take = cutTakes(r, { group: "g", at: from, id: newId })[0];
    const first = clicks.filter((k) => k.pass === 1 && k.beat === 0);
    // at 100 instead of 90: the first beat is on bar 2's downbeat (the rest are sung at 90 and drift, as sung)
    const fast = play(listOf(SONG, [{ from: { block: "a", bar: 0 }, to: { block: "a", bar: 1 } }], [take], 100), { bpm: 100, loop: true, until: 5 }, [{ take, clicks: first, begin: 4 }]);
    onTheBeat(fast);
    // A in 3/4 now: bar 2 starts on beat 3
    const three = SONG.map((s) => (s.block === "a" ? { ...s, bar: 3 } : s));
    const waltz = play(listOf(three, [{ from: { block: "a", bar: 0 }, to: { block: "a", bar: 1 } }], [take], 90), { bpm: 90, loop: true, until: 5 }, [{ take, clicks: first, begin: 3 }]);
    onTheBeat(waltz);
  });

  it("a take chosen while the song plays takes over from the one playing, in its place, never both", () => {
    const from = { block: "a", bar: 0 };
    const to = { block: "a", bar: 1 };
    const { r, clicks } = session({ song: SONG, from, to, bpm: 120, rate: 48000, rt: 5, countIn: 1, passes: 3 });
    const [one, two] = cutTakes(r, { group: "g", at: from, id: newId });
    S.getAudio();
    live.currentTime = 0;
    const srcs = capture();
    const p = new S.ProgressionPlayer();
    p.start(listOf(SONG, [{ from, to }], [one], 120).items, 120, "ring", true);
    runTo(1.3);
    p.update(listOf(SONG, [{ from, to }], [two], 120).items, 120, "ring", true);
    runTo(5);
    p.stop();
    const a = srcs.find((s) => s.take === one)!;
    const b = srcs.find((s) => s.take === two)!;
    // the first stops a moment after the choice (not only at the next bar), the second starts there, in its place
    expect(Math.min(...a.stops.filter((w) => w > 0))).toBeCloseTo(b.when, 6);
    expect(b.when).toBeCloseTo(1.32, 6);
    expect(b.offset).toBeCloseTo(b.when - 0.08, 6);
    void clicks;
  });

  it("an edit while the song plays is heard at once, even in a section with no chords (one item a whole pass)", () => {
    const from = { block: "a", bar: 0 };
    const { r } = session({ song: SONG, from, to: { block: "a", bar: 1 }, bpm: 120, rate: 48000, rt: 5, countIn: 1, passes: 2 });
    const [one, two] = cutTakes(r, { group: "g", at: from, id: newId });
    // A with only a beat in it: the whole pass (8 beats, 4 s) is one item
    // (each take read once: the same buffer every time, as the page has it)
    const bufs = new Map<Take, AudioBuffer>();
    const buf = (t: Take) => bufs.get(t) ?? bufs.set(t, { duration: t.frames / t.rate, take: t } as unknown as AudioBuffer).get(t)!;
    const item = (takes: Take[], at = 0): PlayItem[] => [{ midi: [], beats: 8, section: true, meter: { bar: 4 }, extra: { chords: [], tunes: [], drums: [], takes: takes.map((t) => ({ track: "v1", buffer: buf(t), at, offset: 0, dur: t.frames / t.rate, id: "clip" })) } }];
    S.getAudio();
    live.currentTime = 0;
    const srcs = capture();
    const p = new S.ProgressionPlayer();
    p.start(item([one]), 120, "ring", true);
    runTo(1);
    // the clip deleted 0.92 s into the pass: it stops 20 ms later, not 3 s later where the pass ends
    p.update(item([]), 120, "ring", true);
    const a = srcs.find((s) => s.take === one)!;
    expect(Math.min(...a.stops)).toBeCloseTo(1.02, 6);
    runTo(1.5);
    // undone: back at once, from where the music is
    p.update(item([one]), 120, "ring", true);
    const back = srcs.filter((s) => s.take === one);
    expect(back).toHaveLength(2);
    expect(back[1].when).toBeCloseTo(1.52, 6);
    expect(back[1].offset).toBeCloseTo(1.52 - 0.08, 6);
    // another take used for it: that one takes over there and then
    runTo(2);
    p.update(item([two]), 120, "ring", true);
    const b = srcs.find((s) => s.take === two)!;
    expect(b.when).toBeCloseTo(2.02, 6);
    expect(b.offset).toBeCloseTo(2.02 - 0.08, 6);
    expect(Math.min(...back[1].stops)).toBeCloseTo(2.02, 6);
    // nothing changed: nothing started again
    p.update(item([two]), 120, "ring", true);
    runTo(3);
    p.update(item([two]), 120, "ring", true);
    expect(srcs.filter((s) => s.take === two)).toHaveLength(1);
    // a new tempo (a moved clip's place in beats moves with it): what is booked at the old tempo is left as it is, the new one is heard from the next item
    const n = srcs.length;
    p.update(item([two], 0.25), 130, "ring", true);
    expect(srcs.length).toBe(n);
    p.stop();
  });
});

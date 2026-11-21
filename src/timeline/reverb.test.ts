// The reverb of a converted song is the reverb the old song was heard with.
//
// The old engine ran a voice for every way a row was played, and each voice joined the row's one reverb send to its
// room once more. A row with N voices on one room was heard with N times the reverb its knob said. A converted track
// has one voice, so the conversion turns its Reverb up to what was heard (migrate5.ts `keepReverb`). Here: what the
// old engine did, measured; that every note of every fixture reaches the speakers and the rooms as it did; that a row
// with one voice converts exactly as it did before this was built; and what cannot be kept, with how far it falls short.
//
// The measure is `sendLog`: the gains between each note's voice and the speakers, and between it and each room, read
// off the pretend audio graph (every way from a voice to a room added up). The tests have no real audio engine.
import { describe, expect, it } from "vitest";
import type { Mix } from "../audio/mix";
import { SOUND_DEFAULT, reviveSound, verbSendOf, type HarpSound } from "../audio/rack";
import type { Tone } from "../audio/tone";
import { chordShape } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";
import { legacyPlan } from "../song/legacyplan";
import { normalize } from "../song/tracks";
import { presetById } from "../synth/presets";
import type { ChordRef } from "../theory/chords";
import type { Progression } from "../ui/state";
import { FIXTURES, fixture } from "./fixtures5";
import { songEnd } from "./edit";
import { flatten, type FlattenCtx } from "./flatten";
import { keepReverb, reverbTimes, toTimeline } from "./migrate5";
import type { ChordsTrack, TimelineSong, TuneTrack } from "./model";
import { fakeBuffer, sendLog, type NoteSend } from "./renderlog";
import { voicingsFor, type VoicingCtx } from "./voicing";

const tuning = getTuning("standard");
const vctx: VoicingCtx = { tuning, capo: 0, avoidBarre: true, shapeOf: (ref: ChordRef, voicingId?: string) => chordShape(ref, tuning, 0, true, voicingId) };

/** The faders' levels only: a muted or soloed-away track would compare nothing with nothing. */
const levels = (mix: Mix | undefined): Mix | undefined => mix && Object.fromEntries(Object.entries(mix).map(([id, m]) => [id, m?.db !== undefined ? { db: m.db } : undefined]));

/** An old song both ways: what each note of the old song is sent out with, and each note of the converted one (named by the old row). */
async function both(p: Progression): Promise<{ old: NoteSend[]; now: NoteSend[]; song: TimelineSong }> {
  const bufs = new Map<string, AudioBuffer>();
  const buffer = (t: { id: string; frames: number; rate: number }) => {
    if (!bufs.has(t.id)) bufs.set(t.id, fakeBuffer(t.id, t.frames / t.rate));
    return bufs.get(t.id)!;
  };
  const conv = toTimeline(p);
  const fctx: FlattenCtx = { voicingsOf: voicingsFor(vctx), buffer };
  const back = new Map<string, string>();
  for (const [was, now] of Object.entries(conv.ids)) for (const id of now) back.set(id, was);
  const order = (xs: NoteSend[]) => [...xs].sort((a, b) => a.track.localeCompare(b.track) || a.when - b.when || a.midi - b.midi);
  const old = order(await sendLog(legacyPlan(p, vctx, buffer).items, p.bpm, (t) => t, levels(normalize(p).mix)));
  const now = order(await sendLog(flatten(conv.song, fctx).items, p.bpm, (t) => back.get(t) ?? t, levels(conv.song.mix)));
  return { old, now, song: conv.song };
}

/** Two gains are the same when they differ by less than a thousandth (the knobs are stored to four decimals). */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-3 * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;
const total = (r: Record<string, number>): number => Object.values(r).reduce((a, x) => a + x, 0);

/** An old song with the first chords' sound set in some sections (by section id), as an old build would have stored it. */
function chordSounds(p: Progression, sounds: Record<string, Partial<HarpSound>>): Progression {
  const song = p.song!;
  const cur = song.blocks.find((b) => b.id === song.current)!.partId;
  // (the page holds a copy of the section on screen)
  return { ...p, ...(sounds[cur] ? { sound: sounds[cur] } : {}), song: { ...song, parts: song.parts.map((x) => (sounds[x.id] ? { ...x, sound: sounds[x.id] } : x)) } };
}
const sounded = (s: TimelineSong, id: string) => s.tracks.find((t) => t.id === id) as ChordsTrack | TuneTrack;

/** A short name for everything a conversion gives (the same for the same song). */
async function mark(x: unknown): Promise<string> {
  const sum = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(x)));
  return [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

const HALL = "hall|0.4";
/** one voice's send at the Reverb and Level every track starts with, as the rack sets it */
const ONE = verbSendOf(SOUND_DEFAULT) * Math.pow(10, (-7 * Math.pow(SOUND_DEFAULT.space, 1.6)) / 20) * SOUND_DEFAULT.level ** 2 * 1.25;

describe("what the old engine did", () => {
  it("one voice: the send is the Reverb knob's, the dry mix's and the Level's, as the rack sets them", async () => {
    // (the conversion works with these three curves: were one changed in the rack, this fails)
    for (const [space, level] of [[0.3, 0.8], [0.6, 0.5], [1, 1], [0.1, 0.9]]) {
      const { old } = await both({ ...fixture(1).progression, sound: { space, level } });
      const chords = old.filter((n) => n.track === "chords");
      expect(chords.length).toBeGreaterThan(0);
      const dry = Math.pow(10, (-7 * Math.pow(space, 1.6)) / 20) * level * level * 1.25;
      for (const n of chords) {
        expect(n.dry).toBeCloseTo(dry, 9);
        expect(n.wet).toEqual({ [HALL]: expect.closeTo(verbSendOf({ space, verb: "hall" }) * dry, 9) });
      }
    }
  });

  it("a row on N voices in one room sent every note there N times: four times in fixture 3, twice in 9, 10, 15 and 18", async () => {
    const heard = async (n: number, track: string) => [...new Set((await both(fixture(n).progression)).old.filter((x) => x.track === track).map((x) => +(total(x.wet) / ONE).toFixed(6)))].sort((a, b) => a - b);
    // the first chords on the strings, a piano, a synth, and the strings again remembering a synth they do not play
    expect(await heard(3, "chords")).toEqual([4]);
    // a piano, and a voice on the strings made for the section the chords are silent in: a row that is not split
    expect(await heard(10, "chords")).toEqual([2]);
    expect(await heard(15, "melody")).toEqual([2]);
    expect(await heard(18, "chords")).toEqual([2]);
    // rows on one voice: once
    expect(await heard(15, "chords")).toEqual([1]);
    expect(await heard(8, "chords")).toEqual([1]);
    // fixture 9: the drone twice; the arpeggio twice what little the track's Reverb counts for behind an arpeggio
    const arp = verbSendOf({ space: 0.15, verb: "hall" }) * Math.pow(10, (-7 * Math.pow(0.15, 1.6)) / 20) * 0.8 ** 2 * 1.25;
    expect(await heard(9, "chords")).toEqual([+((2 * arp) / ONE).toFixed(6), 2]);
  });

  it("voices in different rooms: every note went to every room a voice of its row had", async () => {
    // the first chords of fixture 3: a plate where the piano plays, a larger hall where the synth plays
    const { old } = await both(chordSounds(fixture(3).progression, { B: { verb: "plate" }, C: { size: 0.8 } }));
    const rooms = new Set(old.map((n) => JSON.stringify(Object.keys(n.wet).sort())));
    expect([...rooms]).toEqual([JSON.stringify(["hall|0.4", "hall|0.8", "plate|0.4"])]);
    // (the two voices on the strings share the first hall: twice there, once in each of the others)
    const strings = old.find((n) => near(n.wet["hall|0.8"], ONE))!;
    expect(strings.wet[HALL] / ONE).toBeCloseTo(2, 6);
    expect(strings.wet["plate|0.4"] / ONE).toBeCloseTo(1, 6);
  });
});

describe("a converted song sends what the old song sent", () => {
  for (let n = 1; n <= FIXTURES + 1; n++)
    it(`${n > FIXTURES ? "the worked example" : `fixture ${n}`}: every note reaches the speakers and each room as it did`, async () => {
      const { old, now } = await both(fixture(n).progression);
      expect(now.length).toBe(old.length);
      let short = 0;
      old.forEach((a, i) => {
        const b = now[i];
        expect([b.track, b.midi, +b.when.toFixed(6)]).toEqual([a.track, a.midi, +a.when.toFixed(6)]);
        expect(near(b.dry, a.dry), `${a.track} ${a.midi} at ${a.when}: its own sound ${b.dry}, was ${a.dry}`).toBe(true);
        expect(Object.keys(b.wet)).toEqual(Object.keys(a.wet));
        // the one thing known not to be kept: fixture 9's arpeggio (below)
        if (n === 9 && a.track === "chords" && near(a.wet[HALL], 2 * b.wet[HALL])) return void short++;
        for (const r of Object.keys(a.wet)) expect(near(b.wet[r], a.wet[r]), `${a.track} ${a.midi} at ${a.when}: to ${r} ${b.wet[r]}, was ${a.wet[r]}`).toBe(true);
      });
      // (32 notes of the arpeggio in fixture 9, and none anywhere else)
      expect(short).toBe(n === 9 ? 32 : 0);
    });

  it("fixtures 3, 15 and 8 in numbers: how many times one voice's send reached the room before, and reaches it now", async () => {
    const sent = async (n: number, track: string) => {
      const { old, now } = await both(fixture(n).progression);
      const of = (xs: NoteSend[]) => [...new Set(xs.filter((x) => x.track === track).map((x) => +(total(x.wet) / ONE).toFixed(2)))];
      return { old: of(old), now: of(now) };
    };
    // (with the knobs left as they were, each track would send once: a quarter, and a half, of what was heard)
    expect(await sent(3, "chords")).toEqual({ old: [4], now: [4] });
    expect(await sent(15, "melody")).toEqual({ old: [2], now: [2] });
    // fixture 8 has no row on more than one voice (its vocals send to no room): nothing was different, nothing is changed
    expect(await sent(8, "chords")).toEqual({ old: [1], now: [1] });
    expect(sounded(toTimeline(fixture(8).progression).song, "t-chords").sound).toBeUndefined();
  });
});

describe("a row the old engine ran one voice for converts exactly as it did before", () => {
  // What `toTimeline` gave for each fixture before it kept the reverb, as a short name of the whole result (the song
  // and the ids). Thirteen fixtures have no row on more than one voice: they must give that very result still.
  const BEFORE = ["81e3fb11696bec89", "a2be006bdce2a4ff", "5345881cbb693de9", "477918b280e25f39", "ea3d20db53c2d0ac", "f0d291fdbaf9c525", "75e9547f8c98e921", "6a7ccfbdb25533e8", "735640cc56056db6", "e1efe1ec17a07582", "fb56ca79bce9e45b", "61c17f582fdef944", "56954d94e418c20f", "25ecc35502016479", "7777e2b5e23a0359", "b077a81f22eaebd4", "ee624d735dd3899d", "25970f6cba4d0eb2"];
  const TWICE = { space: 0.5113, level: 0.8658 };
  const FOUR = { space: 0.8715, level: 0.9955 };
  /** the five with such a row: the tracks it became, what their two knobs are now, and the faders that moved */
  const MORE: Record<number, { sound: Record<string, { space: number; level: number }>; mix?: Mix }> = {
    3: { sound: { "t-chords": FOUR, "t-chords~2": FOUR, "t-chords~3": FOUR }, mix: { "t-chords": { db: 0.8 }, "t-chords~2": { db: 0.8 }, "t-chords~3": { db: 0.8 } } },
    9: { sound: { "t-chords~2": TWICE } },
    10: { sound: { "t-chords": TWICE } },
    15: { sound: { "t-melody": TWICE, "t-melody~2": TWICE } },
    18: { sound: { "t-chords": TWICE, "t-chords~2": TWICE } },
  };

  it("a silent recording left from a bar that is gone does not make the converted song longer than it was", () => {
    // (fixture 8: such a clip starts in the last bar; uncut it would add a bar of silence at the song's end.
    // This changed fixture 8's mark below on purpose: the clip is shorter, nothing else moved.)
    const p = fixture(8).progression;
    const plan = legacyPlan(p, vctx, (t) => fakeBuffer(t.id, t.frames / t.rate));
    const { song } = toTimeline(p);
    expect(songEnd(song)).toBe(plan.items.reduce((a, x) => a + x.beats, 0));
    expect(song.clips.some((c) => c.kind === "audio" && c.mute)).toBe(true);
  });

  it("the thirteen fixtures with no such row: the very result of before", async () => {
    for (let n = 1; n <= FIXTURES + 1; n++) if (!MORE[n]) expect(await mark(toTimeline(fixture(n).progression)), `fixture ${n}`).toBe(BEFORE[n - 1]);
  });

  it("the five with one: those tracks' Reverb and Level, three faders, and nothing else", async () => {
    for (const [n, more] of Object.entries(MORE)) {
      const conv = toTimeline(fixture(+n).progression);
      // exactly these tracks carry a sound now, and it is exactly these two knobs (no fixture row had a sound of its own)
      expect(Object.fromEntries(conv.song.tracks.flatMap((t) => ("sound" in t && t.sound ? [[t.id, t.sound]] : []))), `fixture ${n}`).toEqual(more.sound);
      expect(conv.song.mix, `fixture ${n}`).toEqual(more.mix);
      // with the two knobs and the faders put back, it is the very result of before
      const { mix: _mix, ...song } = conv.song;
      const tracks = song.tracks.map((t) => {
        if (!more.sound[t.id]) return t;
        const { sound: _sound, ...rest } = t as ChordsTrack;
        return rest;
      });
      expect(await mark({ ...conv, song: { ...song, tracks } }), `fixture ${n}`).toBe(BEFORE[+n - 1]);
    }
  });

  it("one voice (and a row with no music): the sound is handed back as it is, whatever its knobs", () => {
    const sound = { space: 0.9, level: 1, shimmer: 0.4 };
    expect(keepReverb(sound, { inst: "guitar" }, "chords", 1)).toEqual({ sound, wet: 1, dry: 1 });
    expect(keepReverb(sound, { inst: "guitar" }, "chords", 1).sound).toBe(sound);
    expect(keepReverb(undefined, { inst: "piano" }, "melody", 1).sound).toBeUndefined();
    // (a song whose every section plays the chords one way: fixture 2's first chords carry no sound, as before)
    expect(sounded(toTimeline(fixture(2).progression).song, "t-chords").sound).toBeUndefined();
  });
});

describe("the knobs a track is given", () => {
  const strings: Tone = { inst: "guitar" };
  const pad = presetById("warm-pad")!.params;
  const arp: Tone = { inst: "synth", synth: { ...pad, play: { ...pad.play, mode: "arp", rate: "1/8" } } };
  /** what one voice sends at a sound's knobs, and what its own sound leaves at (the rack's curves) */
  const sendOf = (s: Partial<HarpSound> | undefined, db = 0) => {
    const r = reviveSound(s);
    const out = Math.pow(10, (-7 * Math.pow(r.space, 1.6)) / 20) * r.level ** 2 * 1.25 * Math.pow(10, db / 20);
    return { wet: verbSendOf(r) * out, dry: out };
  };

  it("N voices in one room: the Reverb that sends N times as much, the Level that leaves the track's own sound where it was", () => {
    for (const [sound, times] of [[undefined, 2], [undefined, 3], [{ space: 0.2, level: 0.6, verb: "plate" }, 4], [{ space: 0.05 }, 6]] as [Partial<HarpSound> | undefined, number][]) {
      const k = keepReverb(sound, strings, "chords", times);
      expect(k.db).toBeUndefined();
      expect(near(sendOf(k.sound).wet, times * sendOf(sound).wet)).toBe(true);
      expect(near(sendOf(k.sound).dry, sendOf(sound).dry)).toBe(true);
      expect(k.wet).toBeCloseTo(1, 3);
      expect(k.dry).toBeCloseTo(1, 3);
      // (only the two knobs: every other one of the sound is as it was)
      expect({ ...k.sound, space: 0, level: 0 }).toEqual({ ...sound, space: 0, level: 0 });
    }
    // at the knobs every track starts with: the Reverb knob's own curve is a power of 1.3, so twice the send is 0.3 × 2^(1/1.3)
    expect(keepReverb(undefined, strings, "chords", 2).sound).toEqual({ space: 0.5113, level: 0.8658 });
    expect(0.3 * Math.pow(2, 1 / 1.3)).toBeCloseTo(0.5113, 4);
  });

  it("the Level knob at its top: the rest goes on the track's fader, in tenths of a dB", () => {
    // four voices at the starting knobs need 4.6 dB more volume; Level gives 3.9 (0.8 to 1)
    const k = keepReverb(undefined, strings, "chords", 4);
    expect(k).toMatchObject({ sound: { space: 0.8715, level: 0.9955 }, db: 0.8 });
    expect(near(sendOf(k.sound, 0.8).wet, 4 * sendOf(undefined).wet)).toBe(true);
    expect(near(sendOf(k.sound, 0.8).dry, sendOf(undefined).dry)).toBe(true);
    // a fader that was already moved: the lift is added to it
    expect(keepReverb(undefined, strings, "chords", 4, -5).db).toBe(-4.2);
    // Level already at its top: all of it on the fader (1.4 dB for the 1.37 needed, and the Level a hair down to make it exact)
    const loud = keepReverb({ level: 1 }, strings, "chords", 2, 1.5);
    expect(loud).toMatchObject({ sound: { space: 0.5113, level: 0.9985 }, db: 2.9 });
    expect(near(sendOf(loud.sound, 2.9).dry, sendOf({ level: 1 }, 1.5).dry)).toBe(true);
    expect(near(sendOf(loud.sound, 2.9).wet, 2 * sendOf({ level: 1 }, 1.5).wet)).toBe(true);
  });

  it("the cap: a Reverb that would pass the top of its knob stays there, and the reverb falls short by what is left", () => {
    // Reverb at 0.9, heard four times as loud: the knob's top is 1.147 times as much, so 29% of what was heard is left (10.9 dB less)
    const k = keepReverb({ space: 0.9 }, strings, "chords", 4);
    expect(k.sound).toMatchObject({ space: 1 });
    expect(k.wet).toBeCloseTo(Math.pow(1 / 0.9, 1.3) / 4, 3);
    expect(k.wet).toBeCloseTo(0.287, 3);
    expect(k.dry).toBeCloseTo(1, 3);
    expect(near(sendOf(k.sound, k.db).wet, k.wet * 4 * sendOf({ space: 0.9 }).wet)).toBe(true);
    // at the starting Reverb the knob has room for up to 4.78 times (0.3 to 1): five voices in a room reach 96% (0.4 dB less)
    expect(Math.pow(1 / 0.3, 1.3)).toBeCloseTo(4.78, 2);
    expect(keepReverb(undefined, strings, "chords", 5).wet).toBeCloseTo(0.957, 3);
    // already at the top: nothing can be added, the sound is handed back as it is, and half of what two voices sent is left
    const full = { space: 1 };
    expect(keepReverb(full, strings, "chords", 2)).toEqual({ sound: full, wet: 0.5, dry: 1 });
    expect(keepReverb(full, strings, "chords", 2).sound).toBe(full);
    // the fader at its top as well (6 dB): the track's own sound, and its reverb with it, fall short by what the fader lacks
    // (here 3.9 dB are needed and 0.2 are left: its own sound comes out at 65% of what it was, 3.7 dB less)
    const top = keepReverb({ space: 0.6, level: 1 }, strings, "chords", 2, 5.8);
    expect(top).toMatchObject({ sound: { space: 1, level: 1 }, db: 6 });
    expect(top.dry).toBeCloseTo(0.652, 3);
    expect(top.wet).toBeCloseTo(0.634, 3);
    expect(near(sendOf(top.sound, 6).dry, top.dry * sendOf({ space: 0.6, level: 1 }, 5.8).dry)).toBe(true);
    expect(near(sendOf(top.sound, 6).wet, top.wet * 2 * sendOf({ space: 0.6, level: 1 }, 5.8).wet)).toBe(true);
  });

  it("the cap, heard: fixture 3 with its Reverb at 0.9 sends 29% of what it sent, its own sound as loud as it was", async () => {
    const all = { space: 0.9 };
    const { old, now, song } = await both(chordSounds(fixture(3).progression, { A: all, B: all, C: all, D: all }));
    for (const id of ["t-chords", "t-chords~2", "t-chords~3"]) expect(sounded(song, id).sound).toMatchObject({ space: 1 });
    old.forEach((a, i) => {
      expect(near(now[i].dry, a.dry)).toBe(true);
      expect(now[i].wet[HALL] / a.wet[HALL]).toBeCloseTo(0.287, 3);
    });
  });

  it("a Reverb at nothing stays at nothing; the shimmer, which passes the knob by, is turned up on the strings", () => {
    const none = { space: 0 };
    expect(keepReverb(none, strings, "chords", 4)).toEqual({ sound: none, wet: 1, dry: 1 });
    expect(keepReverb(none, strings, "chords", 4).sound).toBe(none);
    expect(keepReverb({ space: 0, shimmer: 0.2 }, strings, "melody", 3).sound).toEqual({ space: 0, shimmer: 0.6 });
    expect(keepReverb({ shimmer: 0.5 }, strings, "chords", 4).sound).toMatchObject({ shimmer: 1 });
    // (a piano plays no shimmer: its knob is left)
    expect(keepReverb({ shimmer: 0.2 }, { inst: "piano" }, "chords", 2).sound).toEqual({ shimmer: 0.2, ...{ space: 0.5113, level: 0.8658 } });
  });

  it("behind a synth's arpeggio the track's Reverb counts only up to 0.15: it is turned up as far as that, and no further", () => {
    // at 0.3 it already counts as 0.15, the most there is: nothing changes, and half of what two voices sent is left
    expect(keepReverb(undefined, arp, "chords", 2)).toEqual({ sound: undefined, wet: 0.5, dry: 1 });
    // under it there is room
    expect(keepReverb({ space: 0.05 }, arp, "chords", 2).sound).toMatchObject({ space: 0.0852 });
    expect(keepReverb({ space: 0.1 }, arp, "chords", 2)).toMatchObject({ sound: { space: 0.15 }, wet: expect.closeTo(Math.pow(1.5, 1.3) / 2, 3) });
  });

  it("voices in different rooms count as more of the track's own room, as loud as they were heard", () => {
    const hall = reviveSound(undefined);
    const big = reviveSound({ size: 0.8 });
    const plate = reviveSound({ verb: "plate" });
    expect(reverbTimes(hall, [hall])).toBe(1);
    expect(reverbTimes(hall, [hall, hall, hall, hall])).toBe(4);
    // another room rings apart from this one: one voice there and one here are heard as √2 of one, not as two
    expect(reverbTimes(hall, [hall, big])).toBeCloseTo(Math.SQRT2, 9);
    expect(reverbTimes(hall, [hall, hall, big])).toBeCloseTo(Math.sqrt(5), 9);
    // a plate gives back less of what it is sent than a hall (which is why its own sends are turned up 1.35 times)
    expect(reverbTimes(hall, [hall, plate])).toBeCloseTo(Math.sqrt(1 + 1 / 1.35 ** 2), 9);
    expect(reverbTimes(plate, [hall, plate])).toBeCloseTo(Math.sqrt(1 + 1.35 ** 2), 9);
  });

  it("different rooms, heard: each track sends to its own room as much as its notes sent to all of them together", async () => {
    const p = chordSounds(fixture(3).progression, { B: { verb: "plate" }, C: { size: 0.8 } });
    const { old, now, song } = await both(p);
    // the strings (two voices in the first hall, one in each other room), the piano in its plate, the synth in its larger hall
    expect(sounded(song, "t-chords").sound).toEqual({ space: 0.5799, level: 0.8928 });
    expect(sounded(song, "t-chords~2").sound).toEqual({ verb: "plate", space: 0.7305, level: 0.9627 });
    expect(sounded(song, "t-chords~3").sound).toEqual({ size: 0.8, space: 0.5799, level: 0.8928 });
    const back = (room: string) => verbSendOf({ space: 1, verb: room.split("|")[0] as HarpSound["verb"] });
    old.forEach((a, i) => {
      const b = now[i];
      // what is kept: the track's own sound, and how loud its reverb is in all
      expect(near(b.dry, a.dry)).toBe(true);
      const [own, ...none] = Object.keys(b.wet);
      expect(none).toEqual([]);
      const heard = Math.sqrt(Object.entries(a.wet).reduce((sum, [room, g]) => sum + Math.pow((g * back(own)) / back(room), 2), 0));
      expect(near(b.wet[own], heard)).toBe(true);
      // what is not: the part of it that rang in the other rooms now rings in the track's own (more there than before)
      expect(b.wet[own]).toBeGreaterThan(a.wet[own]);
    });
  });
});

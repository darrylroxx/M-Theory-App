// The host of the player: when a change while playing may be taken in by `update` and when the list must be handed
// over anew, where the music goes on then, and how a start inside the loop stays in time. On the pretend live context.
import { describe, expect, it } from "vitest";
import type { Groove } from "../../audio/beats";
import { songEnd } from "../../timeline/edit";
import { flatten, type FlattenCtx } from "../../timeline/flatten";
import type { Region, TimelineSong } from "../../timeline/model";
import { liveLog, type RenderLog } from "../../timeline/renderlog";
import { chordsClip, chordsTrack, drumsClip, drumsTrack, groove, melodyClip, songOf, tuneTrack } from "../../timeline/testsongs";
import { carryOn, rangeFor, resumeAt, sameShape, startFor, startIndex, type PlayMode } from "./usePlayer";

const ctx: FlattenCtx = { voicingsOf: (chords) => chords.map(() => undefined), buffer: () => undefined };
const BPM = 96;
const SPB = 60 / BPM;
/** when the player's first beat sounds, counted from ▶ */
const LEAD = 0.08;

/** A rhythm of so many bars with a kick on every beat and a snare on a different step of every bar, so each bar can be told from every other. */
function barsApart(bars: number): Groove {
  const g = groove(bars);
  const snare = Array.from({ length: 16 * bars }, (_, i) => (i % 16 === (Math.floor(i / 16) * 3 + 2) % 16 ? "3" : "0")).join("");
  return { ...g, rows: { ...g.rows, snare } };
}
/**
 * Eight bars: chords and drums in two clips each, meeting at bar 3 (beat 8), and a melody clip from beat 4 to `to`.
 * While the melody crosses beat 8 the song is one stretch; once it ends there, the song is cut at beat 8.
 */
const song = (to: number): TimelineSong => songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm"), drumsTrack("td", "Drums", { lead: true })], {
  bpm: BPM,
  clips: [
    chordsClip("c1", "tc", 0, 8), chordsClip("c2", "tc", 8, 24),
    drumsClip("d1", "td", 0, 8, { content: barsApart(2) }), drumsClip("d2", "td", 8, 24, { content: barsApart(6) }),
    melodyClip("m1", "tm", 4, to - 4),
  ],
  end: 32,
});
const session = (regions: Region[] | null) => ({ loop: regions ? { regions, on: true } : null });
const drums = (l: RenderLog) => l.hits.map((h) => `${h.drum}@${Math.round(h.when * 1000)}`).sort();
const shifted = (l: RenderLog, from: number, by: number) => l.hits.filter((h) => h.when >= from - 1e-6).map((h) => `${h.drum}@${Math.round((h.when - by) * 1000)}`).sort();

describe("a change while the song plays", () => {
  it("two lists that differ only in where a stretch starts are not the same shape", () => {
    const a = flatten(song(12), ctx);
    const b = flatten(song(8), ctx);
    expect(a.items.length).toBe(b.items.length);
    expect(a.items.map((x) => x.beats)).toEqual(b.items.map((x) => x.beats));
    expect(a.at).toEqual(b.at);
    expect(a.origin).not.toEqual(b.origin);
    expect(sameShape(a, b)).toBe(false);
    expect(sameShape(a, flatten(song(12), ctx))).toBe(true);
    // a knob turned changes nothing of the shape
    const knob = { ...song(12), mix: { tc: { db: -3 } } };
    expect(sameShape(a, flatten(knob, ctx))).toBe(true);
    // a list that goes round is not one that does not
    expect(sameShape(a, { ...a, loop: true })).toBe(false);
  });

  /** the list as the host makes it for a song played straight through from its first beat */
  const straight = (x: TimelineSong) => flatten(x, ctx, rangeFor({ from: 0, audition: null }, session(null), songEnd(x)));

  it("the list is handed over anew, and the drums heard after it are the right bars (with `update` they would not be)", async () => {
    // the song is cut at beat 8; while bar 3 plays, the melody's edge is dragged out across that line: the cut goes
    const before = straight(song(8));
    const after = song(12);
    const mode: PlayMode = { from: 0, audition: null };
    const r = carryOn(before, mode, after, session(null), ctx);
    expect(r.same).toBe(false);
    if (r.same) return;
    const want = await liveLog(straight(after).items, BPM);
    const when = LEAD + 9.5 * SPB;
    let asked = -1;
    let landed: ReturnType<typeof r.land> | null = null;
    const got = await liveLog(before.items, BPM, {
      steps: [{ at: when, run(p) {
        const items = [...r.first.items];
        p.relist(items, r.first.loop, (next) => {
          asked = next;
          landed = r.land(next);
          items.length = 0;
          items.push(...landed.flat.items);
          return landed.index;
        });
        p.update(items, BPM, "ring", false, null, null);
      } }],
    });
    // it goes on at the item that starts on the beat the old list would have played next
    expect(asked).toBeGreaterThan(0);
    expect(landed!.flat.at[landed!.index]).toBe(before.at[asked]);
    expect(drums(got)).toEqual(drums(want));
    const notes = (l: RenderLog) => l.notes.filter((n) => n.track !== "tm").map((n) => `${n.track}:${n.midi}@${Math.round(n.when * 1000)}`).sort();
    expect(notes(got)).toEqual(notes(want));
    // taken in by `update` alone, the player would go on counting the stretch from its old start: other bars' drums
    const wrong = await liveLog(before.items, BPM, { steps: [{ at: when, run: (p) => p.update(straight(after).items, BPM, "ring", false, null, null) }] });
    expect(drums(wrong)).not.toEqual(drums(want));
    // the other way round (a cut appears) it is handed over anew as well, and plays the same
    const back = carryOn(straight(song(12)), mode, song(8), session(null), ctx);
    if (back.same) throw new Error("the shape changed");
    const again = await liveLog(straight(song(12)).items, BPM, {
      steps: [{ at: when, run(p) {
        const items = [...back.first.items];
        p.relist(items, false, (next) => {
          const to = back.land(next);
          items.length = 0;
          items.push(...to.flat.items);
          return to.index;
        });
        p.update(items, BPM, "ring", false, null, null);
      } }],
    });
    expect(drums(again)).toEqual(drums(await liveLog(straight(song(8)).items, BPM)));
  });

  it("a change that keeps the shape is taken in as it is", () => {
    const a = song(12);
    const quieter = { ...a, mix: { td: { db: -6 } } };
    const r = carryOn(straight(a), { from: 0, audition: null }, quieter, session(null), ctx);
    expect(r.same).toBe(true);
  });

  it("where the old list was about to end or go round: the loop's first item when looping, the new list's end when not", () => {
    const old = flatten(song(12), ctx);
    const neu = flatten(song(8), ctx);
    expect(resumeAt(old, old.items.length, neu, null)).toBe(neu.items.length);
    const regions = [{ from: 8, to: 24 }];
    const round = flatten(song(8), ctx, { spans: regions, loop: true });
    expect(resumeAt(old, old.items.length, round, regions)).toBe(0);
    // the same beat is found in the new list wherever it is in it
    const i = old.at.indexOf(12);
    expect(round.at[resumeAt(old, i, round, regions)]).toBe(12);
    expect(neu.at[resumeAt(old, i, neu, null)]).toBe(12);
  });

  it("a beat outside the new loop goes on at the next stretch, and past the last one at the first", () => {
    const old = flatten(song(12), ctx);
    const regions = [{ from: 8, to: 16 }, { from: 24, to: 32 }];
    const neu = flatten(song(12), ctx, { spans: regions, loop: true });
    expect(neu.at[resumeAt(old, old.at.indexOf(20), neu, regions)]).toBe(24);
    expect(neu.at[resumeAt(old, old.at.indexOf(4), neu, regions)]).toBe(8);
    const early = [{ from: 0, to: 8 }];
    const first = flatten(song(12), ctx, { spans: early, loop: true });
    expect(resumeAt(old, old.at.indexOf(20), first, early)).toBe(0);
    // with no loop, a beat past the new end ends the song
    const short = flatten(songOf([chordsTrack("tc", "Chords", { lead: true })], { bpm: BPM, clips: [chordsClip("c1", "tc", 0, 8)] }), ctx);
    expect(resumeAt(old, old.at.indexOf(20), short, null)).toBe(short.items.length);
  });

  it("the loop switched on while playing: the music goes on from the beat it was at, cut there when that is inside the loop", () => {
    const s = song(12);
    const old = straight(s);
    const regions = [{ from: 8, to: 24 }];
    const r = carryOn(old, { from: 0, audition: null }, s, session(regions), ctx);
    expect(r.same).toBe(false);
    if (r.same) return;
    // the old list would have played beat 12 next: it is in the loop
    const to = r.land(old.at.indexOf(12));
    expect(to.flat.loop).toBe(true);
    expect(to.flat.at[to.index]).toBe(12);
    // (beat 12 is a bar line, where an item starts anyway: only a beat inside an item needs a cut of its own)
    const mid = carryOn({ ...old, at: old.at.map((b) => (b === 12 ? 13 : b)) }, { from: 0, audition: null }, s, session(regions), ctx);
    if (mid.same) throw new Error("the shape changed");
    const cut = mid.land(old.at.indexOf(12));
    expect(cut.mode.cut).toBe(13);
    expect(cut.flat.at[cut.index]).toBe(13);
    expect(cut.flat.items[cut.index].from).toBe(13 - cut.flat.origin[cut.index]);
    // a beat before the loop: on at the loop's start
    const before = r.land(old.at.indexOf(4));
    expect(before.flat.at[before.index]).toBe(8);
    expect(before.mode.cut).toBeUndefined();
  });
});

describe("starting", () => {
  const s = song(8);
  const end = songEnd(s);

  it("with no loop: from the cursor to the song's end; from the first beat when the cursor is at the end", () => {
    const m = startFor(12, null, null, end);
    const flat = flatten(s, ctx, rangeFor(m, session(null), end));
    expect(flat.loop).toBe(false);
    expect(flat.at[0]).toBe(12);
    expect(startIndex(flat, m)).toBe(0);
    expect(flat.items.reduce((a, x) => a + x.beats, 0)).toBe(end - 12);
    expect(startFor(end, null, null, end).from).toBe(0);
  });

  it("with the loop on and the cursor outside it: round the loop from its start; at a later stretch's start: from that stretch", () => {
    const regions = [{ from: 8, to: 16 }, { from: 24, to: 32 }];
    const out = startFor(2, regions, null, end);
    expect(out.cut).toBeUndefined();
    const flat = flatten(s, ctx, rangeFor(out, session(regions), end));
    expect(flat.loop).toBe(true);
    expect(startIndex(flat, out)).toBe(0);
    const second = startFor(24, regions, null, end);
    expect(flat.at[startIndex(flat, second)]).toBe(24);
  });

  it("two stretches give one jump, at the second one's first item", () => {
    const regions = [{ from: 8, to: 16 }, { from: 24, to: 32 }];
    const flat = flatten(s, ctx, { spans: regions, loop: true });
    const jumps = flat.items.map((x, i) => (x.jump ? i : -1)).filter((i) => i >= 0);
    expect(jumps.length).toBe(1);
    expect(flat.at[jumps[0]]).toBe(24);
    expect(flat.items[jumps[0]].from).toBe(24 - flat.origin[jumps[0]]);
  });

  it("with the cursor inside the loop: from the cursor, in time on the first pass and on the second", async () => {
    const regions = [{ from: 8, to: 24 }];
    // (a beat that is not a bar line: the list is cut there)
    const at = 14;
    const m = startFor(at, regions, null, end);
    expect(m.cut).toBe(at);
    const flat = flatten(s, ctx, rangeFor(m, session(regions), end));
    const from = startIndex(flat, m);
    expect(flat.at[from]).toBe(at);
    expect(flat.items[from].from).toBe(at - flat.origin[from]);
    // the first pass is the 10 beats left of the loop; then a whole round, and a little of the next
    const seconds = LEAD + (10 + 16 + 6) * SPB;
    const got = await liveLog(flat.items, BPM, { loop: true, from, seconds });
    // the same loop started at its beginning is 6 beats further on at every moment
    const whole = flatten(s, ctx, { spans: regions, loop: true });
    const ref = await liveLog(whole.items, BPM, { loop: true, seconds: seconds + 6 * SPB });
    expect(drums(got).length).toBeGreaterThan(30);
    expect(drums(got)).toEqual(shifted(ref, LEAD + 6 * SPB, 6 * SPB));
    // a stretch heard on its own goes round the same way
    const alone = startFor(8, null, { from: 8, to: 12 }, end);
    const heard = flatten(s, ctx, rangeFor(alone, session(null), end));
    expect(heard.loop).toBe(true);
    expect(heard.items.reduce((a, x) => a + x.beats, 0)).toBe(4);
  });
});

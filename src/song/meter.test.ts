import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, barBeats } from "../audio/beats";
import { fitChordBeats, fitMelody, fitRhythm, isCompound, reviveSig, sigBeats, sigFor, sigName, TIME_SIGS } from "./meter";

const rock = BEAT_LIBRARY.find((p) => p.steps === 16 && p.div === 4 && (p.bars ?? 1) === 1)!;

describe("time signature", () => {
  it("says how many beats a bar has: quarter notes, or dotted quarters in 6/8, 9/8, 12/8", () => {
    expect(TIME_SIGS.map((s) => `${sigName(s)}=${sigBeats(s)}`).join(" ")).toBe("2/4=2 3/4=3 4/4=4 5/4=5 6/4=6 7/4=7 6/8=2 9/8=3 12/8=4");
    expect(isCompound({ num: 6, den: 8 })).toBe(true);
    expect(isCompound({ num: 3, den: 4 })).toBe(false);
  });

  it("gives an older song the signature its bars had", () => {
    expect(sigName(sigFor(4, false))).toBe("4/4");
    expect(sigName(sigFor(3, false))).toBe("3/4");
    expect(sigName(sigFor(2, true))).toBe("6/8");
    expect(sigName(sigFor(4, true))).toBe("12/8");
    expect(sigName(sigFor(3.5, false))).toBe("4/4");
    expect(reviveSig({ num: 7, den: 4 })).toEqual({ num: 7, den: 4 });
    expect(reviveSig({ num: 11, den: 4 })).toBeUndefined();
  });

  it("a rhythm already in bars of that length is left alone", () => {
    expect(fitRhythm(rock, 4, false)).toBe(rock);
    // a 12/8 shuffle has four beats too: it stays a shuffle in 4/4
    const shuffle = BEAT_LIBRARY.find((p) => p.steps === 12 && p.div === 3)!;
    expect(fitRhythm(shuffle, 4, false)).toBe(shuffle);
  });

  it("4/4 to 3/4 keeps beats 1 to 3; back to 4/4, beat 4 goes round to beat 1 again", () => {
    const w = fitRhythm(rock, 3, false);
    expect([w.steps, w.div, barBeats(w)]).toEqual([12, 4, 3]);
    expect(w.rows.kick).toBe(rock.rows.kick.slice(0, 12));
    expect((w as { edited?: boolean }).edited).toBe(true);
    const back = fitRhythm(w, 4, false);
    expect(back.steps).toBe(16);
    expect(back.rows.kick).toBe(rock.rows.kick.slice(0, 12) + rock.rows.kick.slice(0, 4));
  });

  it("every bar of a longer rhythm is fitted, bar by bar", () => {
    const two = { ...rock, bars: 2, rows: Object.fromEntries(Object.entries(rock.rows).map(([k, v]) => [k, v + "3".repeat(16)])) as typeof rock.rows };
    const w = fitRhythm(two, 3, false);
    expect(w.rows.hat.length).toBe(24);
    expect(w.rows.hat.slice(12)).toBe("3".repeat(12));
  });

  it("to 6/8 the 16ths become triplets: the and and the a share the last one", () => {
    const g = { steps: 16, div: 4, rows: { ...rock.rows, kick: "2000" + "0030" + "0100" + "0002", hat: "2222".repeat(4) } };
    const w = fitRhythm(g, 2, true);
    expect([w.steps, w.div]).toEqual([6, 3]);
    expect(w.rows.kick).toBe("200" + "003");
    expect(w.rows.hat).toBe("222222");
  });

  it("leaving 6/8 the triplets become 16ths again; a shuffle chosen in 4/4 stays a shuffle", () => {
    const g = { steps: 6, div: 3, rows: { ...rock.rows, kick: "203" + "010", hat: "222222" } };
    const w = fitRhythm(g, 4, false, true);
    expect([w.steps, w.div]).toEqual([16, 4]);
    expect(w.rows.kick).toBe("2030" + "0100" + "2030" + "0100");
    const shuffle = BEAT_LIBRARY.find((p) => p.steps === 12 && p.div === 3)!;
    expect(fitRhythm(shuffle, 3, false).div).toBe(3);
    const m = fitMelody({ div: 3, bars: 1, notes: [{ at: 0, midi: 60 }, { at: 4, midi: 62 }, { at: 8, midi: 64 }] }, 2, 4, false, true);
    expect([m.div, ...m.notes.map((n) => n.at)]).toEqual([4, 0, 3, 6]);
  });

  it("chords that last whole bars still do; others keep their length", () => {
    expect(fitChordBeats(4, 4, 3)).toBe(3);
    expect(fitChordBeats(8, 4, 3)).toBe(6);
    expect(fitChordBeats(2, 4, 3)).toBe(2);
    expect(fitChordBeats(3, 3, 7)).toBe(7);
    expect(fitChordBeats(12, 4, 7)).toBe(16); // never longer than a chord can be
  });

  it("melody notes stay in their bar; what falls off the end of a shorter bar is left out", () => {
    const m = { div: 2 as const, bars: 2, notes: [{ at: 0, midi: 60 }, { at: 36, midi: 62 }, { at: 48, midi: 64 }, { at: 54, midi: 65 }] };
    const w = fitMelody(m, 4, 3, false);
    // bar 1 beat 1 stays; beat 4 of bar 1 (at 36) is gone; bar 2 beat 1 and its "and" are now at 36 and 42
    expect(w.notes.map((n) => [n.at, n.midi])).toEqual([[0, 60], [36, 64], [42, 65]]);
    const longer = fitMelody(m, 4, 5, false);
    expect(longer.notes.map((n) => n.at)).toEqual([0, 36, 60, 66]);
    expect(fitMelody(m, 4, 4, false)).toBe(m);
  });

  it("to 6/8 a straight melody moves onto the triplets", () => {
    const m = { div: 2 as const, bars: 1, notes: [{ at: 0, midi: 60 }, { at: 6, midi: 62 }, { at: 12, midi: 64 }, { at: 21, midi: 65 }] };
    const w = fitMelody(m, 4, 2, true);
    expect(w.div).toBe(3);
    expect(w.notes.map((n) => n.at)).toEqual([0, 8, 12, 20]);
  });
});

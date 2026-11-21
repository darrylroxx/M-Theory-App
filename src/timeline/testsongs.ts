// Small songs built by hand, for the tests of the timeline's own functions (the edits, the bar map, undo, and the
// playback and conversion code that follows). Not used by the screen, and not by the app.
// Everything here is a function, so every test gets objects of its own.
import { emptyRows, type Groove } from "../audio/beats";
import { SOUND_DEFAULT } from "../audio/rack";
import { GUITAR } from "../audio/tone";
import { FX_DEFAULT } from "../audio/vocalfx";
import type { Melody } from "../song/melody";
import { isCompound, sigBeats, type TimeSig } from "../song/meter";
import { PLAIN_KIT } from "../song/tracks";
import type { Key } from "../theory/keys";
import type { ProgChord } from "../ui/state";
import type { AudioClip, AudioTrack, ChordsClip, ChordsContent, ChordsTrack, DrumsClip, DrumsTrack, MelodyClip, Take5, TimelineSong, Track, TuneTrack } from "./model";

export const SIG44: TimeSig = { num: 4, den: 4 };
export const SIG34: TimeSig = { num: 3, den: 4 };
export const SIG68: TimeSig = { num: 6, den: 8 };
export const KEY_C: Key = { tonic: "C", scaleId: "ionian" };
export const KEY_B: Key = { tonic: "B", scaleId: "ionian" };

/** Ids for new clips and tracks, the same every time: "n1", "n2" … */
export function counter(prefix = "n"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

// ── content ─────────────────────────────────────────────────

export const chord = (id: string, root: string, beats = 4, typeId = "maj"): ProgChord => ({ id, ref: { root, typeId }, beats });

/** Chords for a clip: by default one chord to the bar, going round C, F, G, A minor. */
export function chordsContent(bars: number, sig: TimeSig = SIG44, chords?: ProgChord[]): ChordsContent {
  const round: [string, string][] = [["C", "maj"], ["F", "maj"], ["G", "maj"], ["A", "min"]];
  return { chords: chords ?? Array.from({ length: bars }, (_, i) => chord(`c${i + 1}`, round[i % 4][0], sigBeats(sig), round[i % 4][1])), bars, style: "ring" };
}

/** A melody of so many bars. `notes`: [beat, midi] pairs. */
export function tune(bars: number, notes: [number, number][] = [], div: Melody["div"] = 2): Melody {
  return { div, bars, notes: notes.map(([beat, midi]) => ({ at: Math.round(beat * 12), midi })) };
}

/** A drum rhythm of so many bars in a signature: a kick on every beat, and a snare on the first beat of bar `mark` (so each bar can be told apart). */
export function groove(bars: number, sig: TimeSig = SIG44, mark = 0): Groove {
  const div = isCompound(sig) ? 3 : 4;
  const steps = sigBeats(sig) * div;
  const rows = emptyRows(steps * bars);
  rows.kick = Array.from({ length: steps * bars }, (_, i) => (i % div === 0 ? "2" : "0")).join("");
  rows.snare = Array.from({ length: steps * bars }, (_, i) => (i === mark * steps ? "3" : "0")).join("");
  return { patternId: null, name: "Test", edited: true, steps, div, bars, swing: 0, rows };
}

// ── clips ───────────────────────────────────────────────────

export const chordsClip = (id: string, track: string, start: number, len: number, o: Partial<ChordsClip> = {}): ChordsClip => {
  const sig = o.sig ?? SIG44;
  return { id, track, kind: "chords", start, len, off: 0, sig, content: chordsContent(Math.max(1, Math.round(len / sigBeats(sig))), sig), ...o };
};
export const melodyClip = (id: string, track: string, start: number, len: number, o: Partial<MelodyClip> = {}): MelodyClip => {
  const sig = o.sig ?? SIG44;
  const bars = Math.max(1, Math.round(len / sigBeats(sig)));
  return { id, track, kind: "melody", start, len, off: 0, sig, content: tune(bars, [[0, 60], [1, 62], [2.5, 64]]), ...o };
};
/** A drums clip. Its rhythm is `bars` long (4 by default) whatever the clip's own length, so a longer clip repeats it. */
export const drumsClip = (id: string, track: string, start: number, len: number, o: Partial<DrumsClip> & { bars?: number } = {}): DrumsClip => {
  const { bars = 4, ...rest } = o;
  const sig = rest.sig ?? SIG44;
  return { id, track, kind: "drums", start, len, off: 0, sig, content: groove(bars, sig), ...rest };
};

/** A recorded take: `seconds` long at 48,000 frames a second, sung from song beat `at`. */
export const take = (id: string, seconds: number, at: number | null = 0, o: Partial<Take5> = {}): Take5 => ({
  id, n: 1, group: `g-${id}`, dry: `${id}-dry.wav`, wet: `${id}-wet.wav`, rate: 48000, start: 0, frames: Math.round(seconds * 48000), at, ...o,
});
/** A clip that plays a whole take from a beat. */
export const audioClip = (id: string, track: string, t: Take5, start: number, o: Partial<AudioClip> = {}): AudioClip => ({
  id, track, kind: "audio", take: t.id, from: 0, to: t.frames, off: 0, frames: t.frames, start, ...o,
});

// ── tracks ──────────────────────────────────────────────────

export const chordsTrack = (id: string, name = "Chords", o: Partial<ChordsTrack> = {}): ChordsTrack => ({ id, kind: "chords", name, tone: GUITAR, sound: SOUND_DEFAULT, ...o });
export const tuneTrack = (id: string, kind: "melody" | "bass" = "melody", name = kind === "bass" ? "Bass" : "Melody", o: Partial<TuneTrack> = {}): TuneTrack => ({ id, kind, name, tone: GUITAR, sound: SOUND_DEFAULT, ...o });
export const drumsTrack = (id: string, name = "Drums", o: Partial<DrumsTrack> = {}): DrumsTrack => ({ id, kind: "drums", name, kit: PLAIN_KIT, ...o });
export const audioTrack = (id: string, kind: "vocals" | "audio" = "vocals", name = kind === "vocals" ? "Vocal 1" : "Audio 1", takes: Take5[] = [], o: Partial<AudioTrack> = {}): AudioTrack => ({
  id, kind, name, fx: kind === "vocals" ? FX_DEFAULT : { ...FX_DEFAULT, on: false }, takes, ...o,
});

// ── songs ───────────────────────────────────────────────────

/** A song with tracks and nothing else: 4/4, 96 beats a minute. */
export const songOf = (tracks: Track[], o: Partial<TimelineSong> = {}): TimelineSong => ({ v: 5, bpm: 96, meter: SIG44, tracks, clips: [], ...o });

/**
 * A small band, 16 bars of 4/4 at 96: chords (bars 1–8 and 9–16), a melody (bars 9–16), a bass (bars 1–8), drums
 * (a 4-bar rhythm at bars 5–8), and a vocal track with one take of 12 seconds whose clip starts at bar 9 and shows
 * its first 8 seconds. Markers "Verse" at bar 1 and "Chorus" at bar 9. Track ids: tc, tm, tb, td, tv.
 */
export function bandSong(): TimelineSong {
  const sung = take("k1", 12, 32);
  return songOf(
    [chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm"), tuneTrack("tb", "bass"), drumsTrack("td", "Drums", { lead: true }), audioTrack("tv", "vocals", "Vocal 1", [sung])],
    {
      clips: [
        chordsClip("c1", "tc", 0, 32),
        chordsClip("c2", "tc", 32, 32),
        melodyClip("m1", "tm", 32, 32),
        melodyClip("b1", "tb", 0, 32, { content: tune(8, [[0, 36], [4, 41], [8, 43]]) }),
        drumsClip("d1", "td", 16, 16),
        audioClip("a1", "tv", sung, 32, { frames: 8 * 48000 }),
      ],
      markers: [{ id: "mk1", beat: 0, name: "Verse" }, { id: "mk2", beat: 32, name: "Chorus" }],
      end: 64,
    },
  );
}

/**
 * A song whose bars change length: 4/4 for 8 bars, 6/8 for 4 bars (from bar 9, beat 32), then 4/4 again (from bar 13,
 * beat 40). One chords clip and one drums clip in each stretch, each written in that stretch's signature.
 */
export function mixedSong(): TimelineSong {
  return songOf([chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td", "Drums", { lead: true })], {
    sigs: [{ bar: 8, sig: SIG68 }, { bar: 12, sig: SIG44 }],
    clips: [
      chordsClip("c1", "tc", 0, 32),
      chordsClip("c2", "tc", 32, 8, { sig: SIG68 }),
      chordsClip("c3", "tc", 40, 16),
      drumsClip("d1", "td", 0, 32),
      drumsClip("d2", "td", 32, 8, { sig: SIG68, bars: 2 }),
      drumsClip("d3", "td", 40, 16),
    ],
    markers: [{ id: "mk1", beat: 0, name: "A" }, { id: "mk2", beat: 32, name: "B" }, { id: "mk3", beat: 40, name: "A" }],
    end: 56,
  });
}

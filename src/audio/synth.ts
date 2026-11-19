/**
 * The song, live: every chords and melody track plays through a voice of its own (its instrument,
 * its effects, its fader; see trackvoice.ts), every drums track through a drum desk of its own
 * (drumbus.ts), and the player steps through a progression in time. `renderSong` plays the same
 * song into an offline context, for a WAV and for the recording engine's backing.
 */
import { barBeats, barsOf, lenOf, levelAt, stepBeat, type Beat } from "./beats";
import { audioContext, audioIfStarted, withContext } from "./context";
import { FIRST_DRUMS, keepDrums, onKickHit, playStep, prepareBeat, setBedPlaying, stopDrums, syncDrums } from "./drumbus";
import { DRUM_IDS } from "./drums";
import { melodyBeats, nextNote, tuneBetween } from "../song/melody";
import { itemNotes, sectionStart, type PatternId, type PlayItem, type PlayTune } from "./patterns";
import { dropPulses } from "./pulse";
import { tapStem, untapStem } from "./stems";
import { fader } from "./mix";
export type { PlayItem } from "./patterns";
import { SOUND_DEFAULT, type HarpSound } from "./rack";
import type { HarpString } from "./harp";
import { TrackVoice, type VoiceKind } from "./trackvoice";
import { GUITAR, type Tone, type Tones } from "./tone";
import { playNotes, type PlayNote } from "../synth/play";
import type { LiveOut } from "../synth/live";
import { TUNE_LIFT, TUNE_SLOT, clipChords, playChord, playTuneNote, playTuneSpan, synthWay, type SecChord, type SynthCache } from "./trackplay";


// ── the live voices ──────────────────────────────────────────

/** Every chords and melody track's voice on the live context, by track id ("chords" and "melody" are the first tracks). */
const voices = new Map<string, TrackVoice>();
/** What each track is set to on the page, so a voice made later starts the same way. */
const liveSound = new Map<string, HarpSound>();
let liveTones: Tones = {};
let tempo = 90;
let pumping = false;

const kindOf = (id: string, kind?: VoiceKind): VoiceKind => kind ?? (id === "melody" ? "melody" : "chord");

/** A track's voice on the live context (made the first time it is needed). */
function voiceOf(id: string, kind?: VoiceKind): TrackVoice {
  const ctx = audioContext();
  let v = voices.get(id);
  if (!v || v.c !== ctx) {
    const f = fader(id, ctx);
    const first = id === "chords" || id === "melody";
    v = new TrackVoice(ctx, f, kindOf(id, kind), first ? undefined : id);
    // every track goes out through a tap, so the canvas's guide hears each kind of part apart
    tapStem(v.kind === "melody" ? "melody" : "chords", f, id);
    v.setSound(liveSound.get(id) ?? SOUND_DEFAULT, tempo);
    v.setTone(liveTones[id] ?? GUITAR);
    voices.set(id, v);
    if (!pumping) {
      pumping = true;
      // Pump: every track dips under each kick and swells back, like a sidechained compressor
      onKickHit((when, depth) => {
        for (const x of voices.values()) {
          const duck = x.rack.duck.gain;
          duck.cancelScheduledValues(when);
          duck.setTargetAtTime(1 - 0.75 * Math.min(1, depth), when, 0.004);
          duck.setTargetAtTime(1, when + 0.03, 0.09);
        }
      });
    }
  }
  return v;
}

export function getAudio(): AudioContext {
  return voiceOf("chords").c as AudioContext;
}

/**
 * Change a track's sound and effects. Safe to call before any sound has been made. The effects
 * follow at once; new strings wait until the knob has stopped moving. With `now` false (the page
 * shows a section other than the one playing) it is only noted: the voice keeps the playing
 * section's sound, and takes this one when the music stops.
 */
export function setTrackSound(id: string, s: HarpSound, bpm: number, now = true) {
  liveSound.set(id, s);
  tempo = bpm;
  if (now) voices.get(id)?.turn(s, bpm, () => prepareNotes(queue));
}
/** The first chords track. */
export const setHarpSound = (s: HarpSound, bpm: number, now = true) => setTrackSound("chords", s, bpm, now);
/** The first melody track: a separate instrument with separate effects. */
export const setTuneSound = (s: HarpSound, bpm: number, now = true) => setTrackSound("melody", s, bpm, now);

/** What every track plays (its instrument and that instrument's settings). The voices that exist change at once. */
export function setTones(t: Tones | undefined) {
  liveTones = t ?? {};
  for (const [id, v] of voices) v.setTone(liveTones[id] ?? GUITAR);
}

/**
 * Get a track ready on the instrument just chosen for it, before the song says so: the voice
 * takes the tone straight away and starts loading. Resolves when it can sound.
 */
export function warmTrack(id: string, kind: "chords" | "melody", tone: Tone): Promise<void> {
  liveTones = { ...liveTones, [id]: tone };
  const v = voiceOf(id, kind === "melody" ? "melody" : "chord");
  v.setTone(tone);
  return v.load();
}
/**
 * Get every track that plays a piano or the synth ready to sound (a piano loads its recordings,
 * the synth its processor) before the music starts, so the first chord is heard. Resolves when
 * they all can, or after `ms` whatever happens (the rest then joins in as it arrives).
 */
export function readyTracks(tracks: { id: string; kind: VoiceKind }[], ms = 4000): Promise<void> {
  const loading = tracks.map((t) => voiceOf(t.id, t.kind)).filter((v) => !v.ready());
  if (!loading.length) return Promise.resolve();
  const all = Promise.all(loading.map((v) => v.load().catch(() => {}))).then(() => {});
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, ms))]);
}

/** Let go of the voices and drum desks of tracks that are no longer in the song (they fade out). */
export function keepTracks(ids: string[]) {
  for (const [id, v] of voices) {
    if (id === "chords" || id === "melody" || ids.includes(id)) continue;
    v.dispose();
    voices.delete(id);
    liveSound.delete(id);
    untapStem(id);
  }
  keepDrums(ids);
}

/** A note to get ready: for the chords or the melody, on that track's own strings or a given section's. */
export interface Prep {
  midi: number;
  tune?: boolean;
  as?: HarpString;
}
let queue: Prep[] = [];
let queued = 0;
/** Get these notes ready in the background, one at a time, so playing never has to wait for them. */
export function prepareNotes(list: Prep[]) {
  queue = list;
  if (queued) return;
  const step = () => {
    queued = 0;
    const next = queue.find((n) => {
      const v = voices.get(n.tune ? "melody" : "chords");
      return !!v && !v.instrument && !v.harp.has(n.midi, n.as);
    });
    if (!next) return;
    voices.get(next.tune ? "melody" : "chords")!.harp.buffer(next.midi, next.as);
    queued = window.setTimeout(step, 0);
  };
  queued = window.setTimeout(step, 0);
}

/** While a page edits a track added on the Track page, the notes it plays to be heard go to that track. */
const heardOn: { chord: { id: string; sound: HarpSound } | null; melody: { id: string; sound: HarpSound } | null } = { chord: null, melody: null };
export function hearOn(kind: "chord" | "melody", track: { id: string; sound: HarpSound } | null) {
  heardOn[kind] = track;
  if (track) {
    liveSound.set(track.id, track.sound);
    voices.get(track.id)?.setSound(track.sound, tempo);
  }
}
const chordVoice = () => (heardOn.chord ? voiceOf(heardOn.chord.id, "chord") : voiceOf("chords"));
const tuneVoice = () => (heardOn.melody ? voiceOf(heardOn.melody.id, "melody") : voiceOf("melody"));

/** Play a single note (on the melody track's instrument when `slot` is the melody's). */
export function playNote(midi: number, when?: number, velocity = 0.8, slot?: number, lengthSec = Infinity) {
  const tune = slot === TUNE_SLOT;
  const v = tune ? tuneVoice() : chordVoice();
  // a keyboard or a synth holds a note as long as the key is down: a tapped note is a short one
  const len = v.instrument && !Number.isFinite(lengthSec) ? 0.6 : lengthSec;
  const t0 = when ?? v.c.currentTime + 0.01;
  // a synth with a way of its own plays even a tapped note its way (an arp runs, a pulse repeats it), so the way is heard
  if (synthWay(v)) {
    for (const n of playNotes([{ midi, start: t0, length: len, velocity }], v.synth.play, { bpm: tempo, origin: t0 })) v.note(n.midi, n.start, n.velocity, n.length, { slot: n.slot });
    return;
  }
  v.note(midi, t0, velocity, len, { slot, lift: tune ? TUNE_LIFT : 1 });
}

/**
 * The on-screen keys of a piano or synth track (see synth/live.ts): notes go to the track the page
 * is editing, on its own instrument. Its recordings or its processor start loading at the first touch.
 */
export function liveKeys(kind: "chord" | "melody"): LiveOut {
  const v = () => {
    const x = kind === "melody" ? tuneVoice() : chordVoice();
    void x.load().catch(() => {});
    return x;
  };
  // each note is let go on the voice that played it, though the page may edit another track by then
  // (every voice numbers its own notes, so an id alone could reach another track's note)
  const held = new Map<number, { v: TrackVoice; id: number }>();
  let ids = 0;
  return {
    now: () => v().c.currentTime,
    bpm: () => tempo,
    on: (midi, when, velocity) => {
      const x = v();
      const id = x.hold(midi, when, velocity);
      if (!id) return 0;
      held.set(++ids, { v: x, id });
      return ids;
    },
    off: (id, when) => {
      const h = held.get(id);
      if (!h) return;
      held.delete(id);
      h.v.letGo(h.id, when);
    },
    note: (midi, when, velocity, length) => v().note(midi, when, velocity, length),
    onCut: (fn) => {
      cuts.add(fn);
      return () => void cuts.delete(fn);
    },
  };
}

/** The on-screen keys, told when every sound is stopped (the transport) or the page changes: their keys go up. */
const cuts = new Set<() => void>();
/** Let go of every key held or latched on the screen. */
export function letGoOfKeys() {
  for (const fn of [...cuts]) fn();
}

/** Roll a chord (the note on each string, null = not played), the way a harpist spreads one. On a synth, the synth's own way of playing. */
export function strum(midi: (number | null)[], opts: { when?: number; dir?: "down" | "up"; spread?: number; velocity?: number; length?: number } = {}) {
  const v = chordVoice();
  const strings = midi.map((m, s) => ({ m, s })).filter((x): x is { m: number; s: number } => x.m !== null);
  const t0 = opts.when ?? v.c.currentTime + 0.02;
  if (v.tone.inst === "synth") {
    const len = opts.length ?? 2;
    const notes: PlayNote[] = strings.map((x) => ({ midi: x.m, start: t0, length: len, velocity: opts.velocity ?? 0.78 }));
    for (const n of playNotes(notes, v.synth.play, { bpm: tempo, origin: t0 })) v.note(n.midi, n.start, n.velocity, n.length, { slot: n.slot });
    return;
  }
  // the first note sounds as soon as the notes are ready
  if (!v.instrument) for (const x of strings) v.harp.buffer(x.m);
  if (opts.dir === "up") strings.reverse();
  const length = opts.length ?? (v.instrument ? 1.8 : Infinity);
  v.repedal(t0);
  strings.forEach(({ m, s }, i) => v.note(m, t0 + i * (opts.spread ?? (v.instrument ? 0.012 : 0.028)), (opts.velocity ?? 0.78) * (1 + i * 0.02), length, { slot: v.instrument ? undefined : s }));
}

export function stopAll() {
  if (!audioIfStarted()) return;
  // (the keys on the screen let go too, so none stays lit over a note that was silenced)
  letGoOfKeys();
  for (const v of voices.values()) v.stopAll();
}

/** Play a scale / list of notes one after another. */
export function playSequence(midis: number[], noteSec = 0.28) {
  const v = voiceOf("chords");
  if (!v.instrument) for (const m of new Set(midis)) v.harp.buffer(m);
  const t0 = v.c.currentTime + 0.05;
  midis.forEach((m, i) => v.note(m, t0 + i * noteSec, 0.75, noteSec * 1.6, { slot: v.instrument ? undefined : 0 }));
}

/** Every note a run of chords and its melodies will need, each with the sound of its own section. */
export function prepFor(items: PlayItem[], pattern: PatternId, beat: Beat | null = null, tune: PlayTune | null = null): Prep[] {
  const out: Prep[] = itemNotes(items, pattern, beat).map((n) => ({ midi: n.e.midi, as: items[n.item].sound }));
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    origin = sectionStart(item, i, at, origin);
    const t = item.tune === undefined ? tune : item.tune;
    if (t && t.m.on !== false) for (const h of tuneBetween(t.m, t.bar, at - origin, at - origin + item.beats)) out.push({ midi: h.midi, tune: true, as: t.sound });
    at += item.beats;
  });
  return out;
}

// ── Progression player (look-ahead scheduler) ─────────────────

/** Where a chord starts: the drum grid re-locks to each of these, so tempo changes and loops stay tight. */
interface Anchor {
  time: number;
  /** beats since the start of this pass through the progression */
  beat: number;
  /** seconds per beat */
  spb: number;
  /** which item this chord is, to look up its drums live (so edits are heard straight away) */
  index: number;
  /** where the drum pattern started (the start of the pass, or of the song section) */
  origin: number;
  /** when the run of items this one belongs to ends (its section, or the loop's end) */
  end: number;
  /** where that run starts, in beats into its section (a loop's start) */
  run: number;
}

/** A drums track on its own grid: the first one ("drums") and each one added on the Track page. */
interface Lane {
  anchors: Anchor[];
  cur: Anchor | null;
  step: number;
  div: number;
  /** the beat whose sound its desk was last set to */
  synced: Beat | null;
}

/** Where each item's section starts (beats from the start of the list), and how many beats are left to its end. */
function sectionsOf(items: PlayItem[]): { origin: number[]; rest: number[] } {
  const origin: number[] = [];
  let at = 0;
  let o = 0;
  items.forEach((item, i) => {
    o = sectionStart(item, i, at, o);
    origin.push(o);
    at += item.beats;
  });
  const rest = items.map(() => 0);
  for (let i = items.length - 1; i >= 0; i--) rest[i] = items[i].beats + (i + 1 < items.length && Math.abs(origin[i + 1] - origin[i]) < 1e-6 ? rest[i + 1] : 0);
  return { origin, rest };
}

export class ProgressionPlayer {
  private timer: number | null = null;
  private stepTimer: number | null = null;
  private startTime = 0;
  private items: PlayItem[] = [];
  private secs: { origin: number[]; rest: number[] } = { origin: [], rest: [] };
  private bpm = 90;
  private pattern: PatternId = "ring";
  private loop = true;
  private nextIndex = 0;
  private nextTime = 0;
  private passBeat = 0;
  private origin = 0;
  private endAt: number | null = null;
  private marks: { time: number; index: number }[] = [];
  // drums: every drums track on a grid of its own
  private beat: Beat | null = null;
  private lanes = new Map<string, Lane>();
  private drumMarks: { time: number; step: number }[] = [];
  // melody: scheduled a moment ahead, like the drums, so a note tapped in is heard on the next pass of the grid
  private tune: PlayTune | null = null;
  private tAnchors: Anchor[] = [];
  private tCur: Anchor | null = null;
  private tTick = 0;
  /** where recent chords started, to tell how far into its section the music is */
  private spans: Anchor[] = [];
  /** recorded takes that are playing */
  private sources = new Set<AudioBufferSourceNode>();
  /** the next item scheduled starts a pass (play pressed, or the loop came round): takes already under way start part-way */
  private fresh = true;
  /** the synth tracks' notes, section by section */
  private synthNotes: SynthCache = new Map();
  onStep: (index: number) => void = () => {};
  /** Called as each drum step sounds (step index inside the bar), or with −1 when playback stops. */
  onDrumStep: (step: number) => void = () => {};
  onEnd: () => void = () => {};
  playing = false;

  /** With no chords, the beat and the melody play on their own, the whole of the longer one each time round. */
  private fill(items: PlayItem[]): PlayItem[] {
    if (items.length) return items;
    const drums = this.beat?.on ? barBeats(this.beat) * barsOf(this.beat) : 0;
    const tune = this.tune && this.tune.m.on !== false && this.tune.m.notes.length ? melodyBeats(this.tune.m, this.tune.bar) : 0;
    const beats = tune && drums ? Math.ceil(tune / drums - 1e-6) * drums : Math.max(drums, tune);
    return beats ? [{ midi: [], beats }] : [];
  }

  private tuneAt(a: Anchor): PlayTune | null {
    const own = this.items[a.index]?.tune;
    return own === undefined ? this.tune : own;
  }

  /** How many beats into its section the music is right now (null when stopped). */
  sectionBeat(): number | null {
    return this.position()?.beat ?? null;
  }

  /** What is sounding right now: which item of the list, and how many beats into its section (null when stopped). */
  position(): { index: number; beat: number } | null {
    if (!this.playing) return null;
    const now = getAudio().currentTime;
    let at: Anchor | null = null;
    for (const s of this.spans) if (s.time <= now) at = s;
    return at ? { index: at.index, beat: at.beat - at.origin + (now - at.time) / at.spb } : null;
  }

  /** A drums track's beat under an item: the first track's (the item's own, or the player's), or an added track's. */
  private beatOf(track: string, a: Anchor): Beat | null {
    const item = this.items[a.index];
    if (track === FIRST_DRUMS) return item?.drums ?? this.beat;
    return item?.extra?.drums.find((d) => d.track === track)?.beat ?? null;
  }

  private setItems(items: PlayItem[]) {
    this.items = items;
    this.secs = sectionsOf(items);
  }

  start(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, beat: Beat | null = null, fromIndex = 0, tune: PlayTune | null = null) {
    this.stop();
    this.beat = beat;
    this.tune = tune;
    const list = this.fill(items);
    if (!list.length) return;
    const c = getAudio();
    this.setItems(list);
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop || !items.length;
    this.nextIndex = fromIndex;
    this.passBeat = list.slice(0, fromIndex).reduce((a, x) => a + x.beats, 0);
    this.origin = 0;
    this.endAt = null;
    // the first track's noise bed: as the section that plays first has it (each next one's, as it comes)
    setBedPlaying(true, list[fromIndex]?.drums ?? beat, FIRST_DRUMS);
    if (beat) {
      syncDrums(beat, bpm);
      for (const b of new Set([beat, ...list.map((x) => x.drums).filter((x): x is Beat => !!x)])) prepareBeat(b);
    }
    for (const it of list) for (const d of it.extra?.drums ?? []) prepareBeat(d.beat);
    // the first chords are made ready before the clock starts, the rest while they play
    const v = voiceOf("chords");
    const need = itemNotes(list, pattern, beat);
    if (!v.instrument) for (const n of need) if (n.item <= fromIndex + 1 && n.item >= fromIndex) v.harp.buffer(n.e.midi, list[n.item].sound);
    prepareNotes(prepFor(list, pattern, beat, tune));
    this.startTime = c.currentTime + 0.08;
    for (const x of voices.values()) x.sync(this.startTime);
    this.nextTime = this.startTime;
    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.stepTimer = window.setInterval(() => this.tick(), 30);
    this.schedule();
  }

  /** Update tempo/pattern/items/beat on the fly (chords from the next chord, drums from the next step). */
  update(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, beat: Beat | null = null, tune: PlayTune | null = null) {
    this.beat = beat;
    this.tune = tune;
    this.setItems(this.fill(items));
    // a new tempo: every drums track's desk (its echo) follows at once, not only when its beat changes
    if (bpm !== this.bpm) for (const [track, lane] of this.lanes) if (lane.synced) syncDrums(lane.synced, bpm, track);
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop || !items.length;
    // the first track's noise bed follows the section that is playing, not the one on the page
    const lane = this.lanes.get(FIRST_DRUMS);
    setBedPlaying(this.playing, lane?.cur ? this.beatOf(FIRST_DRUMS, lane.cur) : beat, FIRST_DRUMS, lane?.cur?.time);
    // chords were removed while playing: start over. (Exactly at the end is left alone, so a song that is not looping can finish.)
    if (this.nextIndex > this.items.length) this.nextIndex = 0;
  }

  private schedule() {
    const c = getAudio();
    const horizon = c.currentTime + 0.25;
    const spb = 60 / this.bpm;
    while (this.playing && this.nextTime < horizon) {
      if (this.nextIndex >= this.items.length) {
        if (!this.loop || !this.items.length) {
          this.endAt = this.nextTime;
          this.marks.push({ time: this.nextTime, index: -1 });
          this.playing = false;
          break;
        }
        this.nextIndex = 0;
        this.passBeat = 0;
        this.fresh = true;
      }
      const i = this.nextIndex;
      const item = this.items[i];
      const t = this.nextTime;
      this.origin = sectionStart(item, i, this.passBeat, this.origin);
      this.marks.push({ time: t, index: i });
      const s0 = this.passBeat - this.origin;
      // where this item's section started, on the clock: the synth plays a whole section its way
      const t0 = t - s0 * spb;
      const firstOf = (from: number) => {
        let a = from;
        while (a > 0 && Math.abs(this.secs.origin[a - 1] - this.secs.origin[from]) < 1e-6) a--;
        return a;
      };
      const run = s0 - this.items.slice(firstOf(i), i).reduce((a, x) => a + x.beats, 0);
      const anchor: Anchor = { time: t, beat: this.passBeat, spb, index: i, origin: this.origin, end: t + (this.secs.rest[i] ?? item.beats) * spb, run };
      this.tAnchors.push(anchor);
      this.spans.push(anchor);
      if (this.spans.length > 24) this.spans.shift();
      const items = this.items;
      const origins = this.secs.origin;
      playChord(voiceOf("chords"), item, t, spb, this.pattern, s0, this.beat, this.synthNotes, () => {
        const chords: SecChord[] = [];
        let at = s0 - items.slice(firstOf(i), i).reduce((a, x) => a + x.beats, 0);
        for (let j = firstOf(i); j < items.length && Math.abs(origins[j] - origins[i]) < 1e-6; j++) {
          chords.push({ midi: items[j].midi, at, beats: items[j].beats });
          at += items[j].beats;
        }
        return { key: `chords@${t0.toFixed(4)}`, t0, chords };
      });
      // the extra chords tracks: every chord that starts while this item plays (cut to the run of items it is in: a loop's edges)
      const ex = item.extra;
      if (ex) {
        const s1 = s0 + item.beats;
        const run = clipChords(ex.chords, s0 - items.slice(firstOf(i), i).reduce((a, x) => a + x.beats, 0), s0 + (this.secs.rest[i] ?? item.beats));
        for (const ch of run)
          if (ch.midi.length && ch.at >= s0 - 1e-6 && ch.at < s1 - 1e-6)
            playChord(voiceOf(ch.track, "chord"), { midi: ch.midi, beats: ch.beats, style: ch.style, feel: ch.feel, sound: ch.sound, tone: ch.tone, drums: item.drums, meter: item.meter }, t + (ch.at - s0) * spb, spb, this.pattern, ch.at, this.beat, this.synthNotes, () => ({
              key: `${ch.track}@${t0.toFixed(4)}`,
              t0,
              chords: run.filter((x) => x.track === ch.track),
            }));
        // recorded takes: from their start, or part-way in when playing starts in the middle of one
        for (const tk of ex.takes ?? []) {
          const starts = tk.at >= s0 - 1e-6 && tk.at < s1 - 1e-6;
          const under = this.fresh && tk.at < s0 - 1e-6 && tk.at + tk.dur / spb > s0;
          if (!starts && !under) continue;
          const src = c.createBufferSource();
          src.buffer = tk.buffer;
          src.connect(fader(tk.track, c));
          const skip = starts ? 0 : (s0 - tk.at) * spb;
          // going round, a take stops where the loop ends (the next time round starts it again)
          const left = this.loop ? (this.items.slice(i).reduce((a, x) => a + x.beats, 0) - (starts ? tk.at - s0 : 0)) * spb : Infinity;
          src.start(Math.max(c.currentTime, t + (starts ? (tk.at - s0) * spb : 0)), tk.offset + skip, Math.max(0.01, Math.min(tk.dur - skip, left)));
          this.sources.add(src);
          src.onended = () => this.sources.delete(src);
        }
      }
      this.fresh = false;
      // every drums track's grid re-locks to each chord; an added one joins when it first has a beat
      if (!this.lanes.has(FIRST_DRUMS)) this.lanes.set(FIRST_DRUMS, { anchors: [], cur: null, step: 0, div: this.beat?.div ?? 4, synced: this.beat });
      for (const d of ex?.drums ?? []) if (!this.lanes.has(d.track)) this.lanes.set(d.track, { anchors: [], cur: null, step: 0, div: d.beat.div, synced: null });
      for (const lane of this.lanes.values()) lane.anchors.push(anchor);
      this.nextTime += item.beats * spb;
      this.passBeat += item.beats;
      this.nextIndex++;
    }
    this.scheduleDrums(horizon);
    this.scheduleTune(horizon);
  }

  /** The melodies, a twelfth of a beat at a time: the first melody track and every added one, each on its own voice. */
  private scheduleTune(horizon: number) {
    const first = (a: Anchor) => Math.ceil((a.beat - a.origin) * 12 - 1e-6);
    for (let guard = 0; guard < 2000; guard++) {
      if (!this.tCur) {
        const next = this.tAnchors.shift();
        if (!next) return;
        this.tCur = next;
        this.tTick = first(next);
        this.repedalTunes(next);
      }
      const cur = this.tCur;
      const base = cur.time + (cur.origin + this.tTick / 12 - cur.beat) * cur.spb;
      const next = this.tAnchors[0];
      if (next && base >= next.time - 1e-4) {
        this.tCur = this.tAnchors.shift()!;
        this.tTick = first(this.tCur);
        this.repedalTunes(this.tCur);
        continue;
      }
      if (this.endAt !== null && base >= this.endAt - 1e-4) return;
      if (!next && base >= this.nextTime - 1e-4) return;
      if (base >= horizon) return;
      const at = (beat: number) => cur.time + (cur.origin + beat - cur.beat) * cur.spb;
      // the first melody track and every added one, each on its own voice
      const t = this.tuneAt(cur);
      const tunes: { id: string; t: PlayTune }[] = [...(t ? [{ id: "melody", t }] : []), ...(this.items[cur.index]?.extra?.tunes ?? []).map((x) => ({ id: x.track, t: x.tune }))];
      for (const { id, t: tune } of tunes) {
        if (tune.m.on === false || !tune.m.notes.length) continue;
        const v = voiceOf(id, "melody");
        if (tune.tone) v.setTone(tune.tone);
        if (synthWay(v)) {
          // a synth with a way of its own plays the whole section its way: this twelfth of a beat plays what starts in it
          const t0 = at(0);
          if (tune.sound) v.setSound(tune.sound, this.bpm, Math.max(base, t0));
          playTuneSpan(v, this.synthNotes, `${id}~${t0.toFixed(4)}`, tune, t0, cur.spb, (cur.end - t0) / cur.spb, base, base + cur.spb / 12, cur.run);
          continue;
        }
        const hits = tuneBetween(tune.m, tune.bar, this.tTick / 12, (this.tTick + 1) / 12, tune.swing);
        if (!hits.length) continue;
        if (tune.sound) v.setSound(tune.sound, this.bpm, at(hits[0].beat));
        // (for the canvas, and the keys' held notes: a melody note sounds until the next one comes)
        const gap = nextNote(tune.m, tune.bar, this.tTick / 12) * cur.spb;
        hits.forEach((h, i) => playTuneNote(v, h.midi, at(h.beat), gap, cur.end, Math.min(i, 3), tune.sound));
      }
      this.tTick++;
    }
  }

  /** A melody on the piano with its pedal on changes pedal with every chord, as the chords' own pianist does. */
  private repedalTunes(a: Anchor) {
    voices.get("melody")?.repedal(a.time);
    for (const x of this.items[a.index]?.extra?.tunes ?? []) voices.get(x.track)?.repedal(a.time);
  }

  /** Every drums track, each on its own short look-ahead, so edits to a grid are heard on the very next step. */
  private scheduleDrums(horizon: number) {
    // first grid step at or after a chord's start, counted from where the pattern started
    const firstStep = (a: Anchor, div: number) => Math.ceil((a.beat - a.origin) * div - 1e-6);
    for (const [track, lane] of this.lanes) {
      const main = track === FIRST_DRUMS;
      for (let guard = 0; guard < 400; guard++) {
        if (!lane.cur) {
          const first = lane.anchors.shift();
          if (!first) break;
          lane.cur = first;
          lane.div = this.beatOf(track, first)?.div ?? lane.div;
          lane.step = firstStep(first, lane.div);
          this.syncLane(track, lane, first);
        }
        const cur = lane.cur;
        const b = this.beatOf(track, cur);
        const div = b?.div ?? lane.div;
        if (div !== lane.div) {
          // the rhythm changed to a different grid: carry on from the same place in the bar
          lane.step = Math.ceil((lane.step / lane.div) * div - 1e-6);
          lane.div = div;
        }
        const base = cur.time + (cur.origin + lane.step / div - cur.beat) * cur.spb;
        const next = lane.anchors[0];
        if (next && base >= next.time - 1e-4) {
          lane.cur = lane.anchors.shift()!;
          lane.div = this.beatOf(track, lane.cur)?.div ?? lane.div;
          lane.step = firstStep(lane.cur, lane.div);
          this.syncLane(track, lane, lane.cur);
          continue;
        }
        if (this.endAt !== null && base >= this.endAt - 1e-4) break;
        if (!next && base >= this.nextTime - 1e-4) break; // wait until the next chord is scheduled
        if (base >= horizon) break;
        const step = b ? lane.step % lenOf(b) : 0;
        const t = cur.time + (cur.origin + Math.floor(lane.step / div) + stepBeat(lane.step % div, div, b?.swing ?? 0) - cur.beat) * cur.spb;
        if (b?.on) {
          for (const id of DRUM_IDS) {
            const lv = levelAt(b.rows, id, step);
            if (lv) playStep(b, id, lv, t, track);
          }
          if (main) this.drumMarks.push({ time: t, step });
        }
        lane.step++;
      }
    }
  }

  /**
   * A drums track reaches a chord whose section has a drum sound of its own: its desk takes that
   * sound when the section starts. (Only when the beat changed, so it is cheap.)
   */
  private syncLane(track: string, lane: Lane, a: Anchor) {
    const b = this.beatOf(track, a);
    if (b === lane.synced) return;
    lane.synced = b;
    if (b) syncDrums(b, this.bpm, track, a.time);
    // a track's noise bed runs only while its drums play, from where the section starts (as a render has it)
    setBedPlaying(!!b, b, track, a.time);
  }

  private tick() {
    const c = getAudio();
    while (this.drumMarks.length && this.drumMarks[0].time <= c.currentTime) this.onDrumStep(this.drumMarks.shift()!.step);
    while (this.marks.length && this.marks[0].time <= c.currentTime) {
      const m = this.marks.shift()!;
      if (m.index === -1) {
        this.stop();
        this.onEnd();
        return;
      }
      this.onStep(m.index);
    }
  }

  stop() {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.stepTimer !== null) window.clearInterval(this.stepTimer);
    this.timer = this.stepTimer = null;
    this.marks = [];
    this.tAnchors = [];
    this.tCur = null;
    this.spans = [];
    this.lanes.clear();
    // (a fresh cache: what each section's melody was played up to goes with it)
    this.synthNotes = new Map();
    this.fresh = true;
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources.clear();
    this.drumMarks = [];
    this.onDrumStep(-1);
    dropPulses();
    setBedPlaying(false, null);
    for (const [id, v] of voices) {
      v.rack.duck.gain.cancelScheduledValues(0);
      v.rack.duck.gain.setValueAtTime(1, getAudio().currentTime);
      // the sections' own sounds were played on each track's voice: it goes back to the one its page is set to
      v.setSound(liveSound.get(id) ?? SOUND_DEFAULT, tempo);
    }
    stopAll();
    stopDrums();
  }
}

/**
 * The song, rendered to audio in one go (faster than it plays), for the recording engine to
 * play under the singer on the interface's own clock, and for a WAV. Everything that sounds in
 * the song is in it: every chords, melody and drums track and the recorded takes (except those
 * of `skip`, the track being recorded), each on its own instrument, through its own effects and
 * its own fader. Notes still ringing at the end are folded back onto the start, because the
 * engine plays the song round and round (with `fold: false`, for a file, they are kept after the
 * end instead).
 *
 * The order matters: every voice is made and every note played first (a piano only writes its
 * notes down), then the pianos load exactly the recordings those notes need at this sample rate
 * and the synths their processors, and only then does the render start.
 */
export async function renderSong(items: PlayItem[], o: { bpm: number; pattern: PatternId; beat: Beat | null; rate: number; skip?: string; tail?: number; fold?: boolean }): Promise<Float32Array[]> {
  const spb = 60 / o.bpm;
  const beats = items.reduce((a, x) => a + x.beats, 0);
  const length = Math.max(1, Math.round(beats * spb * o.rate));
  const tail = Math.round((o.tail ?? 3) * o.rate);
  const off = new OfflineAudioContext(2, length + tail, o.rate);
  const made = new Map<string, TrackVoice>();
  withContext(off, () => {
    const voice = (id: string, kind: VoiceKind) => {
      let v = made.get(id);
      if (!v) {
        v = new TrackVoice(off, fader(id, off), kind, id === "chords" || id === "melody" ? undefined : id);
        // each track starts as the page has it; a section with a sound of its own changes it where it starts
        v.setSound(liveSound.get(id) ?? SOUND_DEFAULT, o.bpm, 0);
        v.setTone(liveTones[id] ?? GUITAR);
        made.set(id, v);
      }
      return v;
    };
    const cache: SynthCache = new Map();
    const secs = sectionsOf(items);
    const synced = new Map<string, Beat>();
    const syncAt = (track: string, b: Beat | null, at: number) => {
      if (!b || synced.get(track) === b) return;
      synced.set(track, b);
      syncDrums(b, o.bpm, track, at);
      // its noise bed too, from where the section starts (live, the player runs it)
      setBedPlaying(true, b, track, at);
    };
    let at = 0;
    items.forEach((item, i) => {
      const origin = secs.origin[i];
      const t = at * spb;
      const s0 = at - origin;
      const s1 = s0 + item.beats;
      const t0 = t - s0 * spb;
      const end = t + secs.rest[i] * spb;
      // where the run of items this one is in starts, in beats into its section (a loop's start)
      let first = i;
      while (first > 0 && Math.abs(secs.origin[first - 1] - origin) < 1e-6) first--;
      const runStart = s0 - items.slice(first, i).reduce((n, it) => n + it.beats, 0);
      playChord(voice("chords", "chord"), item, t, spb, o.pattern, s0, o.beat, cache, () => {
        const chords: SecChord[] = [];
        let a = i;
        while (a > 0 && Math.abs(secs.origin[a - 1] - origin) < 1e-6) a--;
        let x = s0 - items.slice(a, i).reduce((n, it) => n + it.beats, 0);
        for (let j = a; j < items.length && Math.abs(secs.origin[j] - origin) < 1e-6; j++) {
          chords.push({ midi: items[j].midi, at: x, beats: items[j].beats });
          x += items[j].beats;
        }
        return { key: `chords@${t0.toFixed(4)}`, t0, chords };
      });
      const tunes: { id: string; tune: PlayTune | null }[] = [{ id: "melody", tune: item.tune ?? null }, ...(item.extra?.tunes ?? []).map((x) => ({ id: x.track, tune: x.tune }))];
      for (const { id, tune } of tunes) {
        if (!tune || tune.m.on === false) continue;
        const v = voice(id, "melody");
        if (tune.tone) v.setTone(tune.tone);
        if (tune.sound) v.setSound(tune.sound, o.bpm, t);
        v.repedal(t);
        if (synthWay(v)) {
          playTuneSpan(v, cache, `${id}~${t0.toFixed(4)}`, tune, t0, spb, s0 + secs.rest[i], t, t + item.beats * spb, runStart);
          continue;
        }
        const hits = tuneBetween(tune.m, tune.bar, s0, s1, tune.swing);
        hits.forEach((h, k) => {
          const after = hits.slice(k + 1).find((x) => x.beat > h.beat + 1e-6);
          const gap = (after ? after.beat - h.beat : nextNote(tune.m, tune.bar, h.beat)) * spb;
          // notes struck together each get a string of their own, as live (where a twelfth of a beat's notes are counted off)
          const tick = (b: number) => Math.floor(b * 12 + 1e-6);
          const lane = hits.slice(0, k).filter((x) => tick(x.beat) === tick(h.beat)).length;
          playTuneNote(v, h.midi, t + (h.beat - s0) * spb, gap, end, Math.min(lane, 3), tune.sound);
        });
      }
      const ex = item.extra;
      // (cut to the run of items it is in, as the live player does: a loop's edges)
      const run = clipChords(ex?.chords ?? [], runStart, s0 + secs.rest[i]);
      for (const ch of run)
        if (ch.midi.length && ch.at >= s0 - 1e-6 && ch.at < s1 - 1e-6)
          playChord(voice(ch.track, "chord"), { midi: ch.midi, beats: ch.beats, style: ch.style, feel: ch.feel, sound: ch.sound, tone: ch.tone, drums: item.drums, meter: item.meter }, t + (ch.at - s0) * spb, spb, o.pattern, ch.at, o.beat, cache, () => ({
            key: `${ch.track}@${t0.toFixed(4)}`,
            t0,
            chords: run.filter((x) => x.track === ch.track),
          }));
      // every drums track on its own desk, each section's drum sound from where the section starts
      const drums = [{ beat: item.drums ?? o.beat, track: FIRST_DRUMS }, ...(ex?.drums ?? []).map((d) => ({ beat: d.beat, track: d.track }))];
      // an added track with no drums here goes quiet, its noise bed too, as it does live
      for (const track of [...synced.keys()])
        if (track !== FIRST_DRUMS && !drums.some((d) => d.track === track)) {
          synced.delete(track);
          setBedPlaying(false, null, track, t);
        }
      for (const d of drums) {
        const b = d.beat;
        syncAt(d.track, b, t);
        if (!b?.on) continue;
        const div = b.div;
        for (let k = Math.ceil(s0 * div - 1e-6); k / div < s1 - 1e-9; k++) {
          const time = t + (Math.floor(k / div) + stepBeat(k % div, div, b.swing ?? 0) - s0) * spb;
          const step = k % lenOf(b);
          for (const id of DRUM_IDS) {
            const lv = levelAt(b.rows, id, step);
            if (lv) playStep(b, id, lv, time, d.track);
          }
        }
      }
      // the takes, as the live player plays them: one under way where the loop starts comes in part-way,
      // and going round (folded) none runs past the end, where it would come round again over itself
      for (const tk of ex?.takes ?? []) {
        if (tk.track === o.skip) continue;
        const starts = tk.at >= s0 - 1e-6 && tk.at < s1 - 1e-6;
        const under = i === 0 && tk.at < s0 - 1e-6 && tk.at + tk.dur / spb > s0;
        if (!starts && !under) continue;
        const skip = starts ? 0 : (s0 - tk.at) * spb;
        const when = t + (starts ? (tk.at - s0) * spb : 0);
        const left = o.fold === false ? Infinity : beats * spb - when;
        const src = off.createBufferSource();
        src.buffer = tk.buffer;
        src.connect(fader(tk.track, off));
        src.start(when, tk.offset + skip, Math.max(0.01, Math.min(tk.dur - skip, left)));
      }
      at += item.beats;
    });
    // every noise bed stops where the song ends, as live: a looping bed would otherwise hiss on
    // through a file's tail, or (folded) come round again over the start of the loop
    setBedPlaying(false, null, undefined, beats * spb);
  });
  let buf: AudioBuffer;
  try {
    await Promise.all([...made.values()].map((v) => v.prepare()));
    buf = await off.startRendering();
  } finally {
    // what the voices hold (a piano's recordings at this sample rate, a synth's processor) is let go
    for (const v of made.values()) v.dispose();
  }
  // for a file (not a loop): the song, then what rings on after it
  if (o.fold === false) return [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const loop = d.slice(0, length);
    // what rings past the end comes round again at the start
    for (let i = 0; i < tail && i < length; i++) loop[i] += d[length + i];
    out.push(loop);
  }
  return out;
}

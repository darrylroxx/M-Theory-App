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
import { fader, sendFader } from "./mix";
import { roomsOf } from "./rooms";
import { loadSafety } from "./safety";
import { TakeRuns, type PlayTake, type TakeSpan } from "./takeplay";
import { DRUM_LATE, lateCount } from "./late";
export type { PlayItem } from "./patterns";
import { SOUND_DEFAULT, type HarpSound } from "./rack";
import type { HarpString } from "./harp";
import { TrackVoice, type VoiceKind } from "./trackvoice";
import { GUITAR, type Tone } from "./tone";
import { playNotes, withSteps, type PlayNote } from "../synth/play";
import { TUNE_LIFT, TUNE_SLOT, clipChords, playChord, playTuneNote, playTuneSpan, synthWay, type SecChord, type SynthCache } from "./trackplay";


// ── the live voices ──────────────────────────────────────────

/**
 * What a track plays with in a section: its instrument (`tone`) and its sound and effects. Every
 * section has its own, so a track can play the piano in A and the strings in B: each different
 * way a track is played gets a voice of its own (a "slot"), and sections that play it the same way
 * share one. A song whose sections all play a track the same way has one voice for it, as it
 * always had; where a section starts, its notes are simply on its own voice, so nothing has to
 * switch on the beat and nothing of the section before is cut off.
 */
export interface SlotUse {
  track: string;
  kind: VoiceKind;
  tone?: Tone;
  sound?: HarpSound;
}
/** A short name for a tone or a sound (worked out once for each object: the plan shares them). */
const names = new WeakMap<object, string>();
const nameOf = (x: object): string => {
  let k = names.get(x);
  if (k === undefined) {
    k = JSON.stringify(x);
    names.set(x, k);
  }
  return k;
};
/** The slot a track's notes go to when it plays with this tone and sound. */
export const slotOf = (u: Pick<SlotUse, "track" | "tone" | "sound">): string => `${u.track}|${nameOf(u.tone ?? GUITAR)}|${nameOf(u.sound ?? SOUND_DEFAULT)}`;

/** Every voice on the live context, by slot. */
const voices = new Map<string, { v: TrackVoice; track: string; drop?: ReturnType<typeof setTimeout> }>();
/** The slots the song uses (see keepSlots): a voice of another one is free to be retuned in place, or let go. */
let kept = new Set<string>();
let tempo = 90;
let pumping = false;

const isFirstTrack = (id: string) => id === "chords" || id === "melody";
const kindOf = (id: string, kind?: VoiceKind): VoiceKind => kind ?? (id === "melody" ? "melody" : "chord");

/**
 * A slot's voice on the live context, made the first time it is needed, on its own sound and
 * instrument. `prefer`: the slot this track was heard on until now (a knob just turned, an
 * instrument just chosen): when the song no longer uses it, that voice is retuned in place
 * instead, so turning a knob never makes a new one.
 */
function voiceFor(u: SlotUse, prefer?: string): TrackVoice {
  const ctx = audioContext();
  const key = slotOf(u);
  const tone = u.tone ?? GUITAR;
  const sound = u.sound ?? SOUND_DEFAULT;
  const e = voices.get(key);
  if (e && e.v.c === ctx) {
    clearTimeout(e.drop);
    return e.v;
  }
  const old = prefer && prefer !== key ? voices.get(prefer) : undefined;
  if (old && old.v.c === ctx && old.track === u.track && old.v.kind === kindOf(u.track, u.kind) && !kept.has(prefer!)) {
    clearTimeout(old.drop);
    voices.delete(prefer!);
    voices.set(key, { ...old, drop: undefined });
    old.v.setTone(tone);
    old.v.turn(sound, tempo, () => prepareNotes(queue));
    return old.v;
  }
  const f = fader(u.track, ctx);
  const v = new TrackVoice(ctx, f, kindOf(u.track, u.kind), isFirstTrack(u.track) ? undefined : u.track, sound, tempo, sendFader(u.track, ctx));
  // every track goes out through a tap, so the canvas's guide hears each kind of part apart (all its voices through the one)
  tapStem(v.kind === "melody" ? "melody" : "chords", f, u.track);
  v.setTone(tone);
  // (it rests until its first note: a voice made ahead costs nothing until it plays)
  v.rest();
  voices.set(key, { v, track: u.track });
  if (!pumping) {
    pumping = true;
    // Pump: every track dips under each kick and swells back, like a sidechained compressor
    // (the reverb rooms the tracks share dip the same way, as each track's own room did)
    onKickHit((when, depth) => {
      const c = audioIfStarted();
      for (const duck of [...[...voices.values()].map((x) => x.v.rack.duck.gain), ...(c ? roomsOf(c).map((r) => r.duck.gain) : [])]) {
        duck.cancelScheduledValues(when);
        duck.setTargetAtTime(1 - 0.75 * Math.min(1, depth), when, 0.004);
        duck.setTargetAtTime(1, when + 0.03, 0.09);
      }
    });
  }
  return v;
}
/** Every live voice there is. */
const allVoices = () => [...voices.values()].map((x) => x.v);

/** Every slot a list of items plays (each track as each section has it), once each. */
export function slotsOf(items: PlayItem[]): SlotUse[] {
  const out = new Map<string, SlotUse>();
  const add = (u: SlotUse) => {
    const k = slotOf(u);
    if (!out.has(k)) out.set(k, u);
  };
  for (const it of items) {
    if (it.midi.length) add({ track: "chords", kind: "chord", tone: it.tone, sound: it.sound });
    if (it.tune) add({ track: "melody", kind: "melody", tone: it.tune.tone, sound: it.tune.sound });
    for (const c of it.extra?.chords ?? []) add({ track: c.track, kind: "chord", tone: c.tone, sound: c.sound });
    for (const t of it.extra?.tunes ?? []) add({ track: t.track, kind: "melody", tone: t.tune.tone, sound: t.tune.sound });
  }
  return [...out.values()];
}

export function getAudio(): AudioContext {
  return audioContext();
}

/** The song's tempo: a voice made or retuned on the page keeps its echo in time with it. */
export function setTempo(bpm: number) {
  tempo = bpm;
}

/**
 * Get a track ready on the instrument just chosen for it in the section on screen, before the
 * song says so: its voice takes the tone straight away and starts loading. Resolves when it can sound.
 */
export function warmSlot(u: SlotUse): Promise<void> {
  return voiceFor(u, heardOn[u.kind]?.track === u.track ? slotOf(heardOn[u.kind]!) : undefined).load();
}
/**
 * Get every slot that plays a piano or the synth ready to sound (a piano loads its recordings,
 * the synth its processor) before the music starts, so the first chord is heard. Resolves when
 * they all can, or after `ms` whatever happens (the rest then joins in as it arrives).
 */
export function readySlots(uses: SlotUse[], ms = 4000): Promise<void> {
  const loading = uses.map((u) => voiceFor(u)).filter((v) => !v.ready());
  if (!loading.length) return Promise.resolve();
  const all = Promise.all(loading.map((v) => v.load().catch(() => {}))).then(() => {});
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, ms))]);
}

/** How long a voice the song no longer uses is kept, in case it is used again (a change undone), before it is let go. */
const DROP_MS = 15000;
/**
 * What the song uses now: every slot of every section (`uses`), and its tracks (`trackIds`). A
 * voice of a track no longer in the song is let go at once (it fades out), with the track's drum
 * desk; one whose slot the song no longer uses is let go a little later, once it has rung out
 * (unless it is used again, or retuned in place, first). Voices the song will need are made now
 * and start resting, so a section's piano is loading long before the section comes.
 */
export function keepSlots(uses: SlotUse[], trackIds: string[]) {
  kept = new Set(uses.map(slotOf));
  for (const [key, x] of [...voices]) {
    if (isFirstTrack(x.track) || trackIds.includes(x.track)) {
      if (kept.has(key) || [heardOn.chord, heardOn.melody].some((h) => h && slotOf(h) === key)) clearTimeout(x.drop);
      else if (x.drop === undefined)
        x.drop = setTimeout(() => {
          const now = voices.get(key);
          if (now !== x || kept.has(key) || [heardOn.chord, heardOn.melody].some((h) => h && slotOf(h) === key)) return;
          voices.delete(key);
          x.v.dispose();
        }, DROP_MS);
      continue;
    }
    clearTimeout(x.drop);
    voices.delete(key);
    x.v.dispose();
    if (![...voices.values()].some((y) => y.track === x.track)) untapStem(x.track);
  }
  // (only on a context already running: nothing is made just to be ready)
  if (audioIfStarted())
    for (const u of uses)
      if (!voices.has(slotOf(u)) && u.tone && u.tone.inst !== "guitar") void voiceFor(u).load().catch(() => {});
  keepDrums(trackIds);
}

/** A note to get ready: for the chords or the melody, on that track's own strings or on those of the sound it is played with. */
export interface Prep {
  midi: number;
  tune?: boolean;
  as?: HarpString;
  /** the slot that plays it (see slotOf) */
  slot?: string;
}
let queue: Prep[] = [];
let queued = 0;
/** The voice a note is got ready on: its slot's, else the first track's. */
const prepVoice = (n: Prep): TrackVoice | undefined => (n.slot ? voices.get(n.slot)?.v : undefined) ?? [...voices.values()].find((x) => x.track === (n.tune ? "melody" : "chords"))?.v;
/** Get these notes ready in the background, one at a time, so playing never has to wait for them. */
export function prepareNotes(list: Prep[]) {
  queue = list;
  if (queued) return;
  const step = () => {
    queued = 0;
    const next = queue.find((n) => {
      const v = prepVoice(n);
      return !!v && !v.instrument && !v.harp.has(n.midi, n.as);
    });
    if (!next) return;
    prepVoice(next)!.harp.buffer(next.midi, next.as);
    queued = window.setTimeout(step, 0);
  };
  queued = window.setTimeout(step, 0);
}

/** The slot each page's notes played to be heard go to: the track it is editing, as it is set in the section on screen. */
const heardOn: Record<VoiceKind, SlotUse | null> = { chord: null, melody: null };
/** The page shows another track, or the one it shows was changed: what is played to be heard goes to it, as it is set now. */
export function hearOn(kind: VoiceKind, u: SlotUse | null) {
  const prev = heardOn[kind];
  heardOn[kind] = u;
  if (u && audioIfStarted()) voiceFor(u, prev && prev.track === u.track ? slotOf(prev) : undefined);
}
/** The track a note played to be heard goes to now (the first tracks: "chords" and "melody"). */
export const heardTrack = (kind: VoiceKind) => heardOn[kind]?.track ?? (kind === "chord" ? "chords" : "melody");
const chordVoice = () => voiceFor(heardOn.chord ?? { track: "chords", kind: "chord" });
const tuneVoice = () => voiceFor(heardOn.melody ?? { track: "melody", kind: "melody" });

/** Play a single note (on the melody track's instrument when `slot` is the melody's). */
export function playNote(midi: number, when?: number, velocity = 0.8, slot?: number, lengthSec = Infinity) {
  const tune = slot === TUNE_SLOT;
  const v = tune ? tuneVoice() : chordVoice();
  // a keyboard or a synth holds a note as long as the key is down: a tapped note is a short one
  const len = v.instrument && !Number.isFinite(lengthSec) ? 0.6 : lengthSec;
  const t0 = when ?? v.c.currentTime + 0.01;
  // a synth with a way of its own plays even a tapped note its way (an arp runs, a pulse repeats it), so the way is heard
  if (synthWay(v)) {
    for (const n of withSteps(playNotes([{ midi, start: t0, length: len, velocity }], v.synth.play, { bpm: tempo, origin: t0 }), v.synth.play, tempo)) v.note(n.midi, n.start, n.velocity, n.length, { slot: n.slot, step: n.step });
    return;
  }
  v.note(midi, t0, velocity, len, { slot, lift: tune ? TUNE_LIFT : 1 });
}

/** Roll a chord (the note on each string, null = not played), the way a harpist spreads one. On a synth, the synth's own way of playing. */
export function strum(midi: (number | null)[], opts: { when?: number; dir?: "down" | "up"; spread?: number; velocity?: number; length?: number } = {}) {
  const v = chordVoice();
  const strings = midi.map((m, s) => ({ m, s })).filter((x): x is { m: number; s: number } => x.m !== null);
  const t0 = opts.when ?? v.c.currentTime + 0.02;
  if (v.tone.inst === "synth") {
    const len = opts.length ?? 2;
    const notes: PlayNote[] = strings.map((x) => ({ midi: x.m, start: t0, length: len, velocity: opts.velocity ?? 0.78 }));
    for (const n of withSteps(playNotes(notes, v.synth.play, { bpm: tempo, origin: t0 }), v.synth.play, tempo)) v.note(n.midi, n.start, n.velocity, n.length, { slot: n.slot, step: n.step });
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
  for (const v of allVoices()) v.stopAll();
}

/** Play a scale / list of notes one after another. */
export function playSequence(midis: number[], noteSec = 0.28) {
  const v = chordVoice();
  if (!v.instrument) for (const m of new Set(midis)) v.harp.buffer(m);
  const t0 = v.c.currentTime + 0.05;
  midis.forEach((m, i) => v.note(m, t0 + i * noteSec, 0.75, noteSec * 1.6, { slot: v.instrument ? undefined : 0 }));
}

/** Every note a run of chords and its melodies will need, each on the sound and the voice it is played with. */
export function prepFor(items: PlayItem[], pattern: PatternId, beat: Beat | null = null, tune: PlayTune | null = null): Prep[] {
  const out: Prep[] = itemNotes(items, pattern, beat).map((n) => ({ midi: n.e.midi, as: items[n.item].sound, slot: slotOf({ track: "chords", tone: items[n.item].tone, sound: items[n.item].sound }) }));
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    origin = sectionStart(item, i, at, origin);
    const t = item.tune === undefined ? tune : item.tune;
    if (t && t.m.on !== false) for (const h of tuneBetween(t.m, t.bar, at - origin, at - origin + item.beats)) out.push({ midi: h.midi, tune: true, as: t.sound, slot: slotOf({ track: "melody", tone: t.tone, sound: t.sound }) });
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
  /** which list the index is in (see ProgressionPlayer.gen) */
  gen: number;
  /** the stretch the recorded takes were laid under (see TakeRuns.item), to look at again when they are edited */
  tk?: { s0: number; s1: number; until: number };
}

/** Where a list waiting to take over goes on (see ProgressionPlayer.queue). */
type Entry = (next: number) => number | { at: number; on: boolean };

/** A drums track on its own grid: the first one ("drums") and each one added on the Track page. */
interface Lane {
  anchors: Anchor[];
  cur: Anchor | null;
  step: number;
  div: number;
  /** the beat whose sound its desk was last set to */
  synced: Beat | null;
}

/**
 * Where each item's section starts (beats from the start of the list), how many beats are left to
 * its end, and which stretch of one section it is in (`group`: a new one where a section starts,
 * and where the music jumps, even if two bits of the song happen to count from the same beat).
 */
function sectionsOf(items: PlayItem[]): { origin: number[]; rest: number[]; group: number[] } {
  const origin: number[] = [];
  const group: number[] = [];
  let at = 0;
  let o = 0;
  items.forEach((item, i) => {
    o = sectionStart(item, i, at, o);
    group.push(i === 0 ? 0 : group[i - 1] + (item.jump || Math.abs(o - origin[i - 1]) > 1e-6 ? 1 : 0));
    origin.push(o);
    at += item.beats;
  });
  const rest = items.map(() => 0);
  for (let i = items.length - 1; i >= 0; i--) rest[i] = items[i].beats + (i + 1 < items.length && group[i + 1] === group[i] ? rest[i + 1] : 0);
  return { origin, rest, group };
}

export class ProgressionPlayer {
  private timer: number | null = null;
  private stepTimer: number | null = null;
  private startTime = 0;
  private items: PlayItem[] = [];
  private secs: { origin: number[]; rest: number[]; group: number[] } = { origin: [], rest: [], group: [] };
  private bpm = 90;
  private pattern: PatternId = "ring";
  private loop = true;
  private nextIndex = 0;
  private nextTime = 0;
  private passBeat = 0;
  private origin = 0;
  private endAt: number | null = null;
  private marks: { time: number; index: number; gen: number }[] = [];
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
  /** recorded takes: each one heard once, where it lies under the music (see TakeRuns) */
  private takes = new TakeRuns();
  /** the synth tracks' notes, section by section */
  private synthNotes: SynthCache = new Map();
  /**
   * The list being played, counted: every ▶ starts a new one, and so does a list that takes over
   * while playing (see `queue`). An index the player reports is an index in the list of its `gen`.
   */
  gen = 0;
  /** a list waiting for the end of the section that is playing, to take over from there */
  private pending: { items: PlayItem[]; loop: boolean; entry: Entry } | null = null;
  /** Is a list waiting to take over? */
  get queued(): boolean {
    return !!this.pending;
  }
  /** the lists played before the one playing took over, by their `gen` (their last chords may still be sounding) */
  private past = new Map<number, PlayItem[]>();
  onStep: (index: number, gen: number) => void = () => {};
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

  /** The item a chord's start is in: in the list playing, or (for the last moments of one before a list took over) in that one. */
  private itemOf(a: Anchor): PlayItem | undefined {
    return (a.gen === this.gen ? this.items : this.past.get(a.gen))?.[a.index];
  }

  /**
   * Another list takes over: the one playing is kept by its `gen` while anything booked from it may
   * still sound (an index always means an item of its own list), and lists nothing points into any
   * more are let go.
   */
  private retire() {
    this.past.set(this.gen, this.items);
    const live = new Set<number>();
    const see = (a: Anchor | null) => a && live.add(a.gen);
    this.spans.forEach(see);
    this.tAnchors.forEach(see);
    see(this.tCur);
    for (const lane of this.lanes.values()) {
      see(lane.cur);
      lane.anchors.forEach(see);
    }
    for (const g of [...this.past.keys()]) if (!live.has(g)) this.past.delete(g);
  }

  private tuneAt(a: Anchor): PlayTune | null {
    const own = this.itemOf(a)?.tune;
    return own === undefined ? this.tune : own;
  }

  /** How many beats into its section the music is right now (null when stopped). */
  sectionBeat(): number | null {
    return this.position()?.beat ?? null;
  }

  /** What is sounding right now: which item of which list (`gen`), and how many beats into its section (null when stopped). */
  position(): { index: number; beat: number; gen: number } | null {
    if (!this.playing) return null;
    const now = getAudio().currentTime;
    // (a song that does not go round: once its last beat has sounded, nothing is)
    if (this.endAt !== null && now >= this.endAt) return null;
    let at: Anchor | null = null;
    for (const s of this.spans) if (s.time <= now) at = s;
    return at ? { index: at.index, beat: at.beat - at.origin + (now - at.time) / at.spb, gen: at.gen } : null;
  }

  /** A drums track's beat under an item: the first track's (the item's own, or the player's), or an added track's. */
  private beatOf(track: string, a: Anchor): Beat | null {
    const item = this.itemOf(a);
    if (track === FIRST_DRUMS) return item?.drums ?? this.beat;
    return item?.extra?.drums.find((d) => d.track === track)?.beat ?? null;
  }

  private setItems(items: PlayItem[]) {
    this.items = items;
    this.secs = sectionsOf(items);
  }

  start(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, beat: Beat | null = null, fromIndex = 0, tune: PlayTune | null = null) {
    this.stop();
    this.gen++;
    tempo = bpm;
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
    // the first chords are made ready before the clock starts (each on its section's voice), the rest while they play
    const need = itemNotes(list, pattern, beat);
    for (const n of need)
      if (n.item <= fromIndex + 1 && n.item >= fromIndex) {
        const v = voiceFor({ track: "chords", kind: "chord", tone: list[n.item].tone, sound: list[n.item].sound });
        if (!v.instrument) v.harp.buffer(n.e.midi, list[n.item].sound);
      }
    prepareNotes(prepFor(list, pattern, beat, tune));
    this.startTime = c.currentTime + 0.08;
    for (const x of allVoices()) x.sync(this.startTime);
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
    // (a list waiting to take over is the one these items are: the one playing keeps its own until then)
    if (this.pending) {
      this.pending.items = this.fill(items);
      this.pending.loop = loop || !items.length;
      items = this.items;
      loop = this.loop;
    } else this.setItems(this.fill(items));
    // a new tempo: every drums track's desk (its echo) follows at once, not only when its beat changes
    if (bpm !== this.bpm) for (const [track, lane] of this.lanes) if (lane.synced) syncDrums(lane.synced, bpm, track);
    this.bpm = bpm;
    tempo = bpm;
    this.pattern = pattern;
    this.loop = loop || !items.length;
    // the first track's noise bed follows the section that is playing, not the one on the page
    const lane = this.lanes.get(FIRST_DRUMS);
    setBedPlaying(this.playing, lane?.cur ? this.beatOf(FIRST_DRUMS, lane.cur) : beat, FIRST_DRUMS, lane?.cur?.time);
    // chords were removed while playing: start over. (Exactly at the end is left alone, so a song that is not looping can finish.)
    if (this.nextIndex > this.items.length) this.nextIndex = 0;
    // a clip edited (deleted, trimmed, moved, another take used, an edit undone) or a take just read from disk: heard at once
    this.retake();
  }

  /**
   * The list playing changed shape (a section removed, made shorter or longer, a chord added or taken
   * out): it plays from now on, with no wait and no gap, from where `at` says the item the old list
   * would have played next is in it. What is already booked plays on as the old list has it (its
   * anchors keep their own `gen`, so a drum pattern or a mark never reads another section's item).
   * Use `update` for a list of the same shape. Returns the new list's `gen`.
   */
  relist(items: PlayItem[], loop: boolean, at: (next: number) => number): number {
    const list = this.fill(items);
    if (!this.playing || this.pending || !list.length) {
      if (this.pending) this.pending.items = list;
      else this.setItems(list);
      return this.pending ? this.gen + 1 : this.gen;
    }
    const want = at(this.nextIndex);
    this.retire();
    this.gen++;
    this.setItems(list);
    this.loop = loop || !items.length;
    const i = Math.max(0, Math.min(list.length, Math.round(want)));
    this.nextIndex = i;
    this.passBeat = list.slice(0, i).reduce((a, x) => a + x.beats, 0);
    // (it goes on where its section is: the drums and the melody count from that section's start)
    this.origin = this.secs.origin[i] ?? this.passBeat;
    return this.gen;
  }

  /**
   * The recorded takes under what is sounding and what is already booked, looked at again with
   * the items as they are now: whatever changed is heard a moment from now, not only from the
   * next item (which, in a section with no chords, is the whole section away).
   */
  private retake() {
    if (!this.playing) return;
    const c = getAudio();
    const now = c.currentTime;
    const spans: { takes: PlayTake[] | undefined; o: TakeSpan }[] = [];
    for (const a of this.spans) {
      const item = this.itemOf(a);
      // (an item that is over, or one whose list changed shape since: left as it was)
      if (!a.tk || !item || a.time + (a.tk.s1 - a.tk.s0) * a.spb <= now || Math.abs(item.beats - (a.tk.s1 - a.tk.s0)) > 1e-6) continue;
      // booked at another tempo: the items now place the clips for the new one (a clip's place in beats moves with the tempo),
      // so nothing is looked at again; the new tempo is heard from the next item, as everything else is
      if (Math.abs(a.spb - 60 / this.bpm) > 1e-9) return;
      spans.push({ takes: item.extra?.takes, o: { t: a.time, ...a.tk, spb: a.spb, now } });
    }
    this.takes.again(c, spans);
  }

  /**
   * Another list to play (the loop changed while playing), from the end of the section that is
   * playing now: what is sounding plays on to that end, and the new list goes on from there with
   * no gap, in time. `entry` says where in the new list, given the item the old one would have played
   * next (its length: it came round), and whether that follows straight on in the song (`on`; a bare
   * index: it jumps). Where it jumps, recorded takes still sounding stop there. An index at the new
   * list's end, for a list that does not go round: the music ends there. Returns the `gen` the new list will have.
   */
  queue(items: PlayItem[], loop: boolean, entry: Entry): number {
    this.pending = { items: this.fill(items), loop: loop || !items.length, entry };
    return this.gen + 1;
  }

  /** Is the next item to schedule the start of a section (or past the end of the list)? */
  private atBoundary(): boolean {
    const i = this.nextIndex;
    return i <= 0 || i >= this.items.length || this.secs.group[i] !== this.secs.group[i - 1];
  }

  /** The list that was waiting takes over, from where its `entry` says. */
  private takeOver() {
    const p = this.pending!;
    this.pending = null;
    const e = p.entry(this.nextIndex);
    const want = typeof e === "number" ? e : e.at;
    const at = Math.max(0, Math.min(p.items.length - (p.loop ? 1 : 0), Math.round(want)));
    // (where the music jumps, a take sung over what came before stops there, and where it goes straight on, one
    // under way carries on: the next item scheduled says which takes lie under it, and where)
    this.retire();
    this.gen++;
    this.setItems(p.items);
    this.loop = p.loop;
    this.nextIndex = at;
    this.passBeat = p.items.slice(0, at).reduce((a, x) => a + x.beats, 0);
    // (it may go on in the middle of a section: the drums and the melody count from that section's start)
    this.origin = this.secs.origin[at] ?? this.passBeat;
  }

  private schedule() {
    const c = getAudio();
    const horizon = c.currentTime + 0.25;
    const spb = 60 / this.bpm;
    while (this.playing && this.nextTime < horizon) {
      if (this.endAt !== null) {
        // the end is booked (it is a moment ahead): the player plays on until it comes (see `tick`), and an
        // edit made in that last moment that goes on past it (a loop set, a list waiting to take over, more
        // of the song) still has the music go on, in time
        const on = this.pending || (this.loop && this.items.length) || this.nextIndex < this.items.length;
        if (!on || c.currentTime >= this.endAt) break;
        this.endAt = null;
        this.marks = this.marks.filter((m) => m.index !== -1);
      }
      if (this.pending && this.atBoundary()) this.takeOver();
      if (this.nextIndex >= this.items.length) {
        if (!this.loop || !this.items.length) {
          // (what is booked plays out: the player is over when the end comes, not when it is booked)
          this.endAt = this.nextTime;
          this.marks.push({ time: this.nextTime, index: -1, gen: this.gen });
          break;
        }
        this.nextIndex = 0;
        this.passBeat = 0;
      }
      const i = this.nextIndex;
      const item = this.items[i];
      const t = this.nextTime;
      this.origin = sectionStart(item, i, this.passBeat, this.origin);
      this.marks.push({ time: t, index: i, gen: this.gen });
      const s0 = this.passBeat - this.origin;
      // where this item's section started, on the clock: the synth plays a whole section its way
      const t0 = t - s0 * spb;
      const groups = this.secs.group;
      const firstOf = (from: number) => {
        let a = from;
        while (a > 0 && groups[a - 1] === groups[from]) a--;
        return a;
      };
      const run = s0 - this.items.slice(firstOf(i), i).reduce((a, x) => a + x.beats, 0);
      const anchor: Anchor = { time: t, beat: this.passBeat, spb, index: i, origin: this.origin, end: t + (this.secs.rest[i] ?? item.beats) * spb, run, gen: this.gen };
      this.tAnchors.push(anchor);
      this.spans.push(anchor);
      if (this.spans.length > 24) this.spans.shift();
      const items = this.items;
      // each section's chords on its own voice: the track as that section has it
      playChord(voiceFor({ track: "chords", kind: "chord", tone: item.tone, sound: item.sound }), item, t, spb, this.pattern, s0, this.beat, this.synthNotes, () => {
        const chords: SecChord[] = [];
        let at = s0 - items.slice(firstOf(i), i).reduce((a, x) => a + x.beats, 0);
        for (let j = firstOf(i); j < items.length && groups[j] === groups[i]; j++) {
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
            playChord(voiceFor({ track: ch.track, kind: "chord", tone: ch.tone, sound: ch.sound }), { midi: ch.midi, beats: ch.beats, style: ch.style, feel: ch.feel, sound: ch.sound, tone: ch.tone, drums: item.drums, meter: item.meter }, t + (ch.at - s0) * spb, spb, this.pattern, ch.at, this.beat, this.synthNotes, () => ({
              key: `${ch.track}@${t0.toFixed(4)}`,
              t0,
              chords: run.filter((x) => x.track === ch.track),
            }));
      }
      // recorded takes: whatever lies under this item, each heard once, in its place; going round, none runs past
      // where the loop ends (the next time round starts it again), nor past where the music jumps
      let ahead = 0;
      for (let j = i; j < items.length && (j === i || !items[j].jump); j++) ahead += items[j].beats;
      anchor.tk = { s0, s1: s0 + item.beats, until: this.loop ? t + ahead * spb : Infinity };
      this.takes.item(c, ex?.takes, { t, ...anchor.tk, spb, now: c.currentTime });
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
      const tunes: { id: string; t: PlayTune }[] = [...(t ? [{ id: "melody", t }] : []), ...(this.itemOf(cur)?.extra?.tunes ?? []).map((x) => ({ id: x.track, t: x.tune }))];
      for (const { id, t: tune } of tunes) {
        if (tune.m.on === false || !tune.m.notes.length) continue;
        const v = voiceFor({ track: id, kind: "melody", tone: tune.tone, sound: tune.sound });
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
    const t = this.tuneAt(a);
    const tunes = [...(t ? [{ track: "melody", tune: t }] : []), ...(this.itemOf(a)?.extra?.tunes ?? [])];
    for (const x of tunes) voices.get(slotOf({ track: x.track, tone: x.tune.tone, sound: x.tune.sound }))?.v.repedal(a.time);
  }

  /** Every drums track, each on its own short look-ahead, so edits to a grid are heard on the very next step. */
  private scheduleDrums(horizon: number) {
    // first grid step at or after a chord's start, counted from where the pattern started
    const firstStep = (a: Anchor, div: number) => Math.ceil((a.beat - a.origin) * div - 1e-6);
    const now = getAudio().currentTime;
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
          // a hit whose moment has passed (the page was held up) is left out, not piled onto the next (see late.ts)
          const late = t < now - DRUM_LATE;
          for (const id of DRUM_IDS) {
            const lv = levelAt(b.rows, id, step);
            if (!lv) continue;
            if (late) lateCount.drums++;
            else playStep(b, id, lv, t, track);
          }
          if (main) this.drumMarks.push({ time: t, step });
        }
        lane.step++;
      }
    }
  }

  /**
   * A drums track reaches a chord whose section has other drums (another rhythm, or none): its desk
   * and its noise bed follow from where the section starts. The kit is the track's, the same in every
   * section. (Only when the beat changed, so it is cheap.)
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
      this.onStep(m.index, m.gen);
    }
  }

  stop() {
    this.playing = false;
    this.pending = null;
    this.past.clear();
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
    this.takes.stopAll();
    this.drumMarks = [];
    this.onDrumStep(-1);
    dropPulses();
    setBedPlaying(false, null);
    for (const r of roomsOf(getAudio())) {
      r.duck.gain.cancelScheduledValues(0);
      r.duck.gain.setValueAtTime(1, getAudio().currentTime);
    }
    // (each voice keeps its own sound: it is the one its sections have)
    for (const v of allVoices()) {
      v.rack.duck.gain.cancelScheduledValues(0);
      v.rack.duck.gain.setValueAtTime(1, getAudio().currentTime);
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
  // the master's safety limiter, loaded before anything is made, so the render goes through it from its first sample as playing does
  await loadSafety(off);
  const made = new Map<string, TrackVoice>();
  withContext(off, () => {
    // a voice for every way a track is played (see slotOf): each made on its own sound and instrument,
    // so a section's first note is on its own from its very start, and nothing is changed mid-render
    const voice = (id: string, kind: VoiceKind, sound?: HarpSound, tone?: Tone) => {
      const key = slotOf({ track: id, tone, sound });
      let v = made.get(key);
      if (!v) {
        v = new TrackVoice(off, fader(id, off), kind, isFirstTrack(id) ? undefined : id, sound ?? SOUND_DEFAULT, o.bpm, sendFader(id, off));
        v.setTone(tone ?? GUITAR);
        made.set(key, v);
      }
      return v;
    };
    const cache: SynthCache = new Map();
    const takes = new TakeRuns();
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
      playChord(voice("chords", "chord", item.sound, item.tone), item, t, spb, o.pattern, s0, o.beat, cache, () => {
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
        const v = voice(id, "melody", tune.sound, tune.tone);
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
          playChord(voice(ch.track, "chord", ch.sound, ch.tone), { midi: ch.midi, beats: ch.beats, style: ch.style, feel: ch.feel, sound: ch.sound, tone: ch.tone, drums: item.drums, meter: item.meter }, t + (ch.at - s0) * spb, spb, o.pattern, ch.at, o.beat, cache, () => ({
            key: `${ch.track}@${t0.toFixed(4)}`,
            t0,
            chords: run.filter((x) => x.track === ch.track),
          }));
      // every drums track on its own desk, each section's rhythm from where the section starts
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
      takes.item(off, ex?.takes, { t, s0, s1, spb, now: 0, until: o.fold === false ? Infinity : beats * spb, skip: o.skip });
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

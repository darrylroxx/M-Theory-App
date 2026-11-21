// A song of tracks and clips as the list the player, the WAV render and the MIDI writer take.
//
// The song is cut into stretches (see cuts.ts). Each stretch becomes a run of silent items that only mark time: one for
// each chord of the lead chords track, and "pad" items where that track is silent. Everything that sounds (every chords,
// melody, bass, drums and audio track, the lead ones too) rides on the items' `extra`, counted from the stretch's
// start. The engine itself is not changed: it plays these as it plays the tracks added on the old Track page.
//
// Each stretch is worked out on its own and kept while the clips and tracks it read are the same objects, so an edit
// rebuilds only what it touched.
import { DRUM_IDS, type DrumId } from "../audio/drums";
import { lenOf, onKit, type Beat, type DrumKit } from "../audio/beats";
import type { ExtraPlay, PlayItem, PlayTune } from "../audio/patterns";
import { reviveSound, type HarpSound } from "../audio/rack";
import type { PlayTake } from "../audio/takeplay";
import { keysVoicings, onKeys, type Tone } from "../audio/tone";
import type { Voicing } from "../guitar/voicings";
import { playedNotes } from "../song/chordnotes";
import { inFrame, sliceItems } from "../song/frame";
import type { MelodyNote } from "../song/melody";
import { isCompound } from "../song/meter";
import type { ArrangeSettings, ProgChord } from "../ui/state";
import { barMap } from "./bars";
import { barOwner, drumsClipsOf, leadFeel, stretches } from "./cuts";
import { songEnd } from "./edit";
import { clipEnd, contentBeats, cycles, frameCycles, framesToBeats, mod, rateOf, zeroBeat } from "./model";
import type { AudioClip, AudioTrack, ChordsClip, ChordsContent, ChordsTrack, DrumsClip, MelodyClip, Region, Take5, TimelineSong, TuneTrack } from "./model";

export interface FlattenCtx {
  /** guitar shapes for a clip's chords (needs the tuning, the capo and the user's shapes: see voicing.ts) */
  voicingsOf(chords: ProgChord[], arrange: ArrangeSettings | undefined): (Voicing | undefined)[];
  /** a take's decoded audio, when it is loaded (`dry`: the file as it was sung, without the vocal sound) */
  buffer(take: Take5, dry?: boolean): AudioBuffer | undefined;
  /** tracks to be heard without their effects (a sound window's bypass); never stored */
  bypass?: ReadonlySet<string>;
}
export interface Range {
  /** the stretches to play, in song order (one for plain play; the loop's regions when looping) */
  spans: Region[];
  loop: boolean;
  /** make sure an item starts exactly on this beat, and give it `from` (to start inside a loop, and to carry on in a new list while playing) */
  cut?: number;
}
export interface Flat {
  items: PlayItem[];
  /** the song beat each item starts on */
  at: number[];
  /** the song beat on which each item's stretch starts (what the engine counts its drums, melodies and styles from) */
  origin: number[];
  loop: boolean;
  /** is there anything to hear? */
  any: boolean;
  /** where the song ends */
  end: number;
}

/** Where the music is on the song line, from the player's own report. */
export const songBeat = (flat: Flat, pos: { index: number; beat: number }): number => flat.origin[pos.index] + pos.beat;

const EPS = 1e-6;

// ── things kept between calls ───────────────────────────────

/** A result kept while what it was made from is the same (the same objects, the same numbers). */
class Memo {
  private map = new Map<string, { deps: readonly unknown[]; v: unknown }>();
  get<T>(key: string, deps: readonly unknown[], make: () => T): T {
    const e = this.map.get(key);
    if (e && e.deps.length === deps.length && e.deps.every((d, i) => d === deps[i])) return e.v as T;
    const v = make();
    this.map.delete(key);
    this.map.set(key, { deps, v });
    // (a song has a few hundred stretches at most: what has not been asked for in a long while is let go)
    if (this.map.size > 6000) for (const k of [...this.map.keys()].slice(0, 2000)) this.map.delete(k);
    return v;
  }
}
/** What was worked out for the shapes in use: let go with them (another tuning, capo or chosen shape gives new ones). */
const stores = new WeakMap<object, Memo>();
function storeOf(ctx: FlattenCtx): Memo {
  let s = stores.get(ctx.voicingsOf);
  if (!s) stores.set(ctx.voicingsOf, (s = new Memo()));
  return s;
}

/** The sound a track plays with, made whole: the same object while the track's own `sound` is the same object. */
const sounds = new WeakMap<object, HarpSound>();
const PLAIN_SOUND = reviveSound(undefined);
function soundOf(raw: Partial<HarpSound> | undefined): HarpSound {
  if (!raw) return PLAIN_SOUND;
  let s = sounds.get(raw);
  if (!s) sounds.set(raw, (s = reviveSound(raw)));
  return s;
}
/** A sound with every effect at nothing (the strings and the level stay): what a bypassed track plays with. */
const drys = new WeakMap<HarpSound, HarpSound>();
export function drySound(s: HarpSound): HarpSound {
  let d = drys.get(s);
  if (!d) drys.set(s, (d = { ...s, drive: 0, squeeze: 0, tone: 0, chorus: 0, phaser: 0, trem: 0, wobble: 0, echo: 0, space: 0, shimmer: 0 }));
  return d;
}
/** A drum kit with every effect at nothing (the machine, each drum's sound and the drum mixer stay). */
const dryKits = new WeakMap<DrumKit, DrumKit>();
export function dryKit(k: DrumKit): DrumKit {
  let d = dryKits.get(k);
  if (!d) dryKits.set(k, (d = { ...k, space: 0, echo: 0, grit: 0, tape: 0, tone: 0, glue: 0, human: 0, sampler: "off", noise: "off", pump: 0 }));
  return d;
}

/**
 * The notes each chord of a clip's content plays on a track's instrument: a rest plays none; a chord written as exact
 * notes plays those; on the keys the chords are laid out together; on the guitar each plays its shape, without the
 * strings that are not played. (The rule the old view had.) Worked out once for a content and a tone.
 */
const chordNotes = new WeakMap<ChordsContent, WeakMap<Tone, { by: unknown; midi: (number | null)[][] }>>();
function notesOf(content: ChordsContent, tone: Tone, ctx: FlattenCtx): (number | null)[][] {
  let per = chordNotes.get(content);
  if (!per) chordNotes.set(content, (per = new WeakMap()));
  const kept = per.get(tone);
  if (kept && kept.by === ctx.voicingsOf) return kept.midi;
  const kv = onKeys(tone) ? keysVoicings(content.chords, tone) : null;
  const vs = kv ? null : ctx.voicingsOf(content.chords, content.arrange);
  const midi = content.chords.map((c, i) => (c.rest ? [] : playedNotes(c) ?? (kv ? kv[i] : vs![i]?.midi?.filter((m): m is number => m !== null)) ?? []));
  per.set(tone, { by: ctx.voicingsOf, midi });
  return midi;
}

// ── one stretch ─────────────────────────────────────────────

/** One stretch as it plays: its items, and how far into it each starts. */
interface Part {
  from: number;
  to: number;
  items: PlayItem[];
  starts: number[];
  any: boolean;
}
type Stretch = { from: number; to: number; bar: number; bars: number };

/** A chord of a clip as it lies in the song: from where to where (song beats), and which chord of the content it is. */
interface Lie { a: number; b: number; i: number }

/** Every chord a clip plays inside a stretch, each cycle of its content in turn, cut at the clip's and the stretch's edges. */
function liesOf(c: ChordsClip, s: Stretch): Lie[] {
  const out: Lie[] = [];
  const size = contentBeats(c);
  // where each chord of the content lies in it (past the frame, never played)
  const inside: { a: number; b: number; i: number }[] = [];
  let at = 0;
  for (const { item, index } of inFrame(c.content.chords, size)) {
    inside.push({ a: at, b: at + item.beats, i: index });
    at += item.beats;
  }
  for (const cy of cycles(c)) {
    // the song beat on which this round of the content would start
    const base = c.start + cy.at - cy.from;
    if (base + cy.to <= s.from + EPS || base + cy.from >= s.to - EPS) continue;
    for (const x of inside) {
      const a = Math.max(base + Math.max(x.a, cy.from), s.from);
      const b = Math.min(base + Math.min(x.b, cy.to), s.to);
      if (b - a > EPS) out.push({ a, b, i: x.i });
    }
  }
  return out;
}

/** A stretch of time without the spans given: the pieces that are left. */
function without(a: number, b: number, spans: readonly [number, number][]): [number, number][] {
  let left: [number, number][] = [[a, b]];
  for (const [x, y] of spans) left = left.flatMap(([p, q]): [number, number][] => (y <= p + EPS || x >= q - EPS ? [[p, q]] : [[p, Math.min(q, x)], [Math.max(p, y), q]]));
  return left.filter(([p, q]) => q - p > EPS);
}

const reaches = (start: number, end: number, s: Stretch) => start < s.to - EPS && end > s.from + EPS;

type Chord = ExtraPlay["chords"][number];

function build(song: TimelineSong, ctx: FlattenCtx, s: Stretch, store: Memo): Part {
  const key = `${s.from}|${s.to}|${s.bar}`;
  const bypass = ctx.bypass;
  const sig = barMap(song).sigAt(s.from + EPS);
  const tracks = song.tracks;
  const here = song.clips.filter((c) => !c.mute && reaches(c.start, c.kind === "audio" ? clipEnd(c, song) : c.start + c.len, s));
  const on = (track: string) => here.filter((c) => c.track === track);

  // the bars, as the items say them: how long, whether each beat divides in three, and whose swing is followed
  const lead = tracks.filter((t) => t.kind === "drums" && t.lead).map((t) => drumsClipsOf(song, t.id));
  const feel = leadFeel(lead, s.from, Math.min(s.to, s.from + s.bar), isCompound(sig));
  const meter = store.get(`meter|${key}`, [sig, feel.triplet, feel.swing], () => ({ bar: s.bar, triplet: feel.triplet, sig, swing: feel.swing }));

  // ── chords ──
  // a clip written to play instead of a chords track silences that track over its own span, while its own track is
  // not muted and it has a chord that sounds
  const quiet = new Map<string, [number, number][]>();
  for (const c of here)
    if (c.kind === "chords" && c.instead && !song.mix?.[c.track]?.mute && c.content.chords.some((x) => !x.rest)) {
      const list = quiet.get(c.instead) ?? [];
      list.push([c.start, c.start + c.len]);
      quiet.set(c.instead, list);
    }
  const chords: Chord[][] = [];
  /** the chords of the lead chords tracks, as they lie (silenced or not): the items follow them */
  const leadLies: Lie[] = [];
  for (const t of tracks) {
    if (t.kind !== "chords") continue;
    const clips = on(t.id).filter((c): c is ChordsClip => c.kind === "chords");
    if (!clips.length) continue;
    if (t.lead) for (const c of clips) leadLies.push(...liesOf(c, s));
    const gone = quiet.get(t.id) ?? [];
    chords.push(store.get(`chords|${t.id}|${key}`, [t.tone, t.sound, ctx.voicingsOf, !!bypass?.has(t.id), JSON.stringify(gone), ...clips], () => chordsOf(t, clips, s, gone, ctx)));
  }

  // ── melodies and basses ──
  const tunes: ExtraPlay["tunes"] = [];
  /** a melody here plays a piano with the pedal on; one plays the keys or the synth */
  let pedalled = false;
  let keyed = false;
  for (const t of tracks) {
    if (t.kind !== "melody" && t.kind !== "bass") continue;
    const clips = on(t.id).filter((c): c is MelodyClip => c.kind === "melody" && c.content.notes.length > 0);
    if (!clips.length) continue;
    const tune = store.get(`tune|${t.id}|${key}`, [t.tone, t.sound, feel.swing, !!bypass?.has(t.id), ...clips], () => tuneOf(t, clips, s, feel.swing, !!bypass?.has(t.id)));
    tunes.push(store.get(`tuneOn|${t.id}|${key}`, [tune], () => ({ track: t.id, tune })));
    if (t.tone.inst === "piano" && t.tone.pedal) pedalled = true;
    if (onKeys(t.tone)) keyed = true;
  }

  // ── drums ──
  const drums: ExtraPlay["drums"] = [];
  for (const t of tracks) {
    if (t.kind !== "drums") continue;
    const clips = on(t.id).filter((c): c is DrumsClip => c.kind === "drums").sort((a, b) => a.start - b.start);
    if (!clips.length) continue;
    const kit = bypass?.has(t.id) ? dryKit(t.kit) : t.kit;
    const beat = store.get(`drums|${t.id}|${key}`, [kit, ...clips], () => beatOf(kit, clips, s));
    if (beat) drums.push(store.get(`drumsOn|${t.id}|${key}`, [beat], () => ({ track: t.id, beat })));
  }

  // ── recorded takes ──
  const made: PlayTake[] = [];
  for (const t of tracks) {
    if (t.kind !== "vocals" && t.kind !== "audio") continue;
    for (const c of on(t.id)) if (c.kind === "audio") made.push(...takesOf(song, t, c, s, ctx));
  }
  // (the same list back while every take in it is the same: the player looks at an item's takes again on every update)
  const takeKey = made.map((k) => [k.track, k.id, k.at, k.offset, k.dur, k.joined ? 1 : 0].join(",")).join(";");
  const takes = store.get(`takes|${key}`, [takeKey, ...made.map((k) => k.buffer)], () => made);

  // ── the items: the time grid ──
  const padWhole = pedalled || (feel.swing > 0 && keyed);
  const gridKey = leadLies.map((l) => `${l.a}:${l.b}`).join(",");
  return store.get(`part|${key}`, [meter, padWhole, gridKey, takes, ...chords, ...tunes, ...drums], () => {
    const flat = chords.flat();
    const extra: ExtraPlay | undefined = flat.length || tunes.length || drums.length || takes.length ? { chords: flat, tunes, drums, ...(takes.length ? { takes } : {}) } : undefined;
    const edges = [...new Set([s.from, s.to, ...leadLies.flatMap((l) => [l.a, l.b])])].sort((a, b) => a - b);
    const items: PlayItem[] = [];
    const starts: number[] = [];
    const push = (a: number, b: number, pad: boolean) => {
      if (b - a < EPS) return;
      starts.push(a - s.from);
      items.push({ midi: [], beats: b - a, tune: null, ...(items.length ? {} : { section: true }), ...(pad ? { pad: true } : {}), ...(extra ? { extra } : {}), meter });
    };
    for (let k = 0; k + 1 < edges.length; k++) {
      const a = edges[k];
      const b = edges[k + 1];
      if (b - a < EPS) continue;
      const mid = (a + b) / 2;
      if (leadLies.some((l) => l.a < mid && l.b > mid)) push(a, b, false);
      else if (padWhole) push(a, b, true);
      else {
        // a silence is cut at every bar line, so a change is heard from the next bar
        let x = a;
        for (let line = s.from + (Math.floor((a - s.from) / s.bar + EPS) + 1) * s.bar; line < b - EPS; line += s.bar) {
          push(x, line, true);
          x = line;
        }
        push(x, b, true);
      }
    }
    const any = flat.some((c) => c.midi.length > 0) || tunes.length > 0 || drums.length > 0 || takes.length > 0;
    return { from: s.from, to: s.to, items, starts, any };
  });
}

/** What one chords track plays in a stretch: every chord of its clips there, with where it starts and how it is played. */
function chordsOf(t: ChordsTrack, clips: ChordsClip[], s: Stretch, gone: readonly [number, number][], ctx: FlattenCtx): Chord[] {
  const sound = ctx.bypass?.has(t.id) ? drySound(soundOf(t.sound)) : soundOf(t.sound);
  const out: Chord[] = [];
  for (const c of clips) {
    const midi = notesOf(c.content, t.tone, ctx);
    for (const l of liesOf(c, s))
      for (const [a, b] of without(l.a, l.b, gone))
        out.push({ track: t.id, at: a - s.from, beats: b - a, midi: midi[l.i] ?? [], style: c.content.style, ...(c.content.feel ? { feel: c.content.feel } : {}), sound, tone: t.tone });
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * What one melody or bass track plays in a stretch: every note of every round of its clips that falls inside both the
 * clip and the stretch, counted in twelfths of a beat from the stretch's start. A note that would be held past the end
 * of its clip is given a length that ends there.
 */
function tuneOf(t: TuneTrack, clips: MelodyClip[], s: Stretch, swing: number, dry: boolean): PlayTune {
  const len = Math.round((s.to - s.from) * 12);
  const got: { at: number; midi: number; len?: number; end: number; k: number }[] = [];
  let k = 0;
  for (const c of clips) {
    const end = Math.round((c.start + c.len - s.from) * 12);
    for (const cy of cycles(c)) {
      const base = Math.round((c.start + cy.at - cy.from - s.from) * 12);
      const a = Math.round(cy.from * 12);
      const b = Math.round(cy.to * 12);
      for (const n of c.content.notes) {
        if (n.at < a || n.at >= b) continue;
        const at = base + n.at;
        if (at < 0 || at >= len) continue;
        got.push({ at, midi: n.midi, ...(n.len !== undefined ? { len: n.len } : {}), end, k: k++ });
      }
    }
  }
  // (notes struck together keep the order they were written in: each has its own string, in that order)
  got.sort((x, y) => x.at - y.at || x.k - y.k);
  const notes: MelodyNote[] = got.map((n, i) => {
    let next = len;
    for (let j = i + 1; j < got.length; j++)
      if (got[j].at > n.at) {
        next = got[j].at;
        break;
      }
    const own = n.len !== undefined ? Math.min(n.len, n.end - n.at) : next > n.end ? n.end - n.at : undefined;
    return { at: n.at, midi: n.midi, ...(own !== undefined ? { len: Math.max(1, own) } : {}) };
  });
  const sound = dry ? drySound(soundOf(t.sound)) : soundOf(t.sound);
  return { m: { div: 4, bars: s.bars, notes }, bar: s.bar, swing, sound, tone: t.tone };
}

/**
 * What one drums track plays in a stretch: its clips' rhythms written out step by step over the whole stretch (each
 * round of each clip in its place, silence elsewhere), on the track's kit. Nothing when its clips there have no grid in common.
 */
function beatOf(kit: DrumKit, clips: DrumsClip[], s: Stretch): Beat | null {
  let div = 0;
  let swing = 0;
  const owners: (DrumsClip | undefined)[] = [];
  for (let j = 0; j < s.bars; j++) {
    const c = barOwner(clips, s.from + j * s.bar, s.from + (j + 1) * s.bar);
    owners.push(c);
    if (c && !div) {
      div = c.content.div;
      swing = c.content.swing || 0;
    }
  }
  if (!div) return null;
  const steps = Math.round(s.bar * div);
  const rows = {} as Record<DrumId, string>;
  for (const id of DRUM_IDS) {
    let row = "";
    for (let j = 0; j < s.bars; j++) {
      const c = owners[j];
      for (let k = 0; k < steps; k++) {
        const x = s.from + j * s.bar + k / div;
        // (a clip on another grid than the stretch's is not played: the cuts keep one grid to a stretch)
        if (!c || c.content.div !== div || x < c.start - EPS || x >= c.start + c.len - EPS) row += "0";
        else row += c.content.rows[id]?.[mod(Math.round((c.off + (x - c.start)) * div), lenOf(c.content))] ?? "0";
      }
    }
    rows[id] = row;
  }
  return onKit({ steps, div, bars: s.bars, swing, rows, on: true, patternId: null, name: "" } as unknown as Beat, kit);
}

/** What one audio clip plays in a stretch: one take for each round of it, each with where it starts and which part of the file plays. */
function takesOf(song: TimelineSong, t: AudioTrack, c: AudioClip, s: Stretch, ctx: FlattenCtx): PlayTake[] {
  const take = t.takes.find((k) => k.id === c.take);
  const buffer = take && ctx.buffer(take, !!ctx.bypass?.has(t.id));
  if (!take || !buffer) return [];
  const rate = rateOf(song, c);
  const spb = 60 / song.bpm;
  /** half a frame, in beats: two places closer than this are one place */
  const tol = framesToBeats(0.5, rate, song.bpm);
  // the next clip on the track: after a change of tempo this one may run into it, and is then cut where that one starts
  let next = Infinity;
  for (const x of song.clips) if (x !== c && x.track === c.track && x.start > c.start + tol && x.start < next) next = x.start;
  // the second piece of a split: it starts where another clip of the same take ends, in the song and in the take
  const zero = zeroBeat(c, song.bpm, rate);
  const joined = song.clips.some((x) => x !== c && x.kind === "audio" && x.take === c.take && Math.abs(x.from + x.off + x.frames - (c.from + c.off)) < 0.5 && Math.abs(zeroBeat(x, song.bpm, rateOf(song, x)) - zero) < tol);
  const out: PlayTake[] = [];
  frameCycles(c).forEach((cy, k) => {
    const start = c.start + framesToBeats(cy.at, rate, song.bpm);
    let dur = (cy.to - cy.from) / rate;
    if (next < start + dur / spb - tol) dur = (next - start) * spb;
    if (!(dur > 0) || !reaches(start, start + dur / spb, s)) return;
    out.push({ track: t.id, buffer, at: start - s.from, offset: cy.from / rate, dur, id: k ? `${c.id}#${k}` : c.id, ...(joined && k === 0 ? { joined: true } : {}) });
  });
  return out;
}

// ── the whole song, or a range of it ────────────────────────

/**
 * The song as items to play. With no range, the whole song from its first beat to its end. With a range, only the
 * stretches named, one after another: the first item of each says how far into its stretch of the song it starts
 * (`from`), so whatever is under way there is heard from there; the first item of each one after the first also says
 * the music jumps (`jump`).
 */
export function flatten(song: TimelineSong, ctx: FlattenCtx, range?: Range): Flat {
  const end = songEnd(song);
  const store = storeOf(ctx);
  const parts = stretches(song).map((s) => build(song, ctx, s, store));
  const items: PlayItem[] = [];
  const at: number[] = [];
  const origin: number[] = [];
  const spans = range?.spans.length ? range.spans : null;
  if (!spans) {
    for (const p of parts)
      p.items.forEach((item, i) => {
        items.push(item);
        at.push(p.from + p.starts[i]);
        origin.push(p.from);
      });
  } else {
    spans.forEach((span, n) => {
      const a = Math.max(0, span.from);
      const b = Math.min(end, span.to);
      let first = true;
      for (const p of parts) {
        if (p.to <= a + EPS || p.from >= b - EPS) continue;
        for (const c of sliceItems(p.items, Math.max(a, p.from) - p.from, Math.min(b, p.to) - p.from)) {
          items.push(first ? { ...c.item, section: true, from: c.from, ...(n > 0 ? { jump: true } : {}) } : c.item);
          at.push(p.from + c.from);
          origin.push(p.from);
          first = false;
        }
      }
    });
  }
  const cut = range?.cut;
  if (cut !== undefined) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (Math.abs(at[i] - cut) < EPS) {
        if (item.from === undefined) items[i] = { ...item, from: at[i] - origin[i] };
        break;
      }
      if (at[i] < cut && at[i] + item.beats > cut + EPS) {
        // the item the beat lies in becomes two: the second starts on the beat, and says where in its stretch that is
        const { section: _s, jump: _j, from: _f, ...rest } = item;
        items.splice(i, 1, { ...item, beats: cut - at[i] }, { ...rest, beats: at[i] + item.beats - cut, from: cut - origin[i] });
        at.splice(i + 1, 0, cut);
        origin.splice(i + 1, 0, origin[i]);
        break;
      }
    }
  }
  return { items, at, origin, loop: !!range?.loop, any: parts.some((p) => p.any), end };
}

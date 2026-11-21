// An old song (sections, each with its tracks) as tracks and clips.
//
// It reads a song that is fully loaded and settled the old way (repeats written out, drums fitted to their bars, the
// time signature known), and never the stored text. Every id is made from the old ids, so the same old song gives the
// same new song on every device. Nothing here changes what is heard: a row that sounded different from section to
// section becomes one track for each sound, and a vocal row whose recordings overlapped becomes one track for each layer.
// A row the old engine ran several voices for was heard with more reverb than its knob said: its tracks are given the
// Reverb it was heard with (see `keepReverb`).
import { DEFAULT_BEAT, barsOf, grooveOf, kitOfBeat, kitSig, type Beat } from "../audio/beats";
import { MAX_DB, type Mix, type TrackMix } from "../audio/mix";
import { reviveSound, verbSendOf, type HarpSound } from "../audio/rack";
import { roomKey } from "../audio/rooms";
import { synthOf, toneOf, voicingOf, type Tone } from "../audio/tone";
import { rackForPlay } from "../audio/trackvoice";
import { FX_DEFAULT } from "../audio/vocalfx";
import { placedClips } from "../song/clips";
import { barsOr, inFrame } from "../song/frame";
import { hasTune, inBars, type Melody } from "../song/melody";
import { sameSig, sigBeats, type TimeSig } from "../song/meter";
import { drumsIn, sections, soloSection, type Section } from "../song/structure";
import { PLAIN_STYLE, allTracks, insteadHere, insteadIn, markIn, normalize, type HarmonyOf, type Track as OldTrack } from "../song/tracks";
import { sigOf } from "../song/unity";
import { reviveSynth } from "../synth/params";
import type { ArrangeSettings, ProgChord, Progression } from "../ui/state";
import type { Feel, PatternId } from "../audio/patterns";
import type { AudioClip, AudioTrack, ChordsTrack, Clip, DrumsTrack, HarmonyMark5, Marker, Take5, TimelineSong, Track, TuneTrack } from "./model";

/** A converted song, and which new tracks each old track became (old track id → new track ids, the one that kept the name first). */
export interface Converted { song: TimelineSong; ids: Record<string, string[]>; }

/** The ids the old first tracks get (the engine keeps "chords", "melody" and "drums" for itself). */
export const FIRST_IDS: Record<string, string> = { chords: "t-chords", melody: "t-melody", drums: "t-drums" };
/** The block id a song with no sections is given. */
export const SOLO_BLOCK = "a";

const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * What of a tone is heard: only the settings the instrument in use plays with, each at its real value. (A tone also
 * remembers the settings of the instruments it is not playing, so going back finds them; those never split a track.)
 */
export function heardTone(t: Tone, kind: "chords" | "melody"): unknown {
  if (t.inst === "piano") return { inst: "piano", keys: t.keys ?? "grand", bright: t.bright ?? 0.5, pedal: !!t.pedal, voicing: voicingOf(t), register: t.register ?? null };
  if (t.inst === "synth") return { inst: "synth", synth: reviveSynth(synthOf(t, kind)), voicing: voicingOf(t), register: t.register ?? null };
  return { inst: "guitar" };
}
/** A chords or melody track's sound as one string: the same for the same sound. */
export const soundKey = (tone: Tone, sound: Partial<HarpSound> | undefined, kind: "chords" | "melody"): string => JSON.stringify([heardTone(tone, kind), reviveSound(sound)]);

// ── the reverb a converted track is given ──
//
// The old engine gave every way a row was played a voice of its own (synth.ts: a "slot"), and every voice of a row
// sent to its room through the row's one send (mix.ts sendFader). Each voice joined that send to its own room
// (rack.ts), so with N voices on one room the send was joined to it N times, and every note of the row was heard
// with N times the reverb its knob said. With voices on different rooms, every note also went to the rooms of the
// row's other voices. A converted track has one voice, one room and one join. So that a song keeps the reverb it was
// heard with, a track made from a row that had several voices gets its Reverb turned up to what it was heard at.

/** A number as it is stored: four decimals, so every device writes the same one. */
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
/** Where a rising curve reaches `want` between `lo` and `hi` (`hi`, when it never gets there). */
function reach(f: (x: number) => number, want: number, lo: number, hi: number): number {
  if (!(f(hi) > want)) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/**
 * Two curves of the effects rack (rack.ts `set`, which keeps them to itself): how far a sound's own mix, and what it
 * sends to its room, are turned down as its Reverb comes up; and the volume its Level gives. (The Reverb knob's own
 * curve is `verbSendOf`. The tests read all three off the rack itself: one changed there fails here.)
 */
const dryOf = (space: number): number => Math.pow(10, (-7 * Math.pow(space, 1.6)) / 20);
const volOf = (level: number): number => level * level * 1.25;

/** A track's sound with the reverb it was heard with, and how close that comes. */
export interface KeptReverb {
  /** the sound to give the track: the very one passed in, when nothing is to change */
  sound: Partial<HarpSound> | undefined;
  /** the track's fader (dB), when the Level knob alone could not keep the track's own sound where it was */
  db?: number;
  /** how much of the old reverb is reached, and of the old level of the track's own sound (1 = all of it) */
  wet: number;
  dry: number;
}

/**
 * A sound whose reverb was heard `times` as loud as its Reverb knob says (the old engine: see above), set so that one
 * voice sends that much: the Reverb knob up, by its own curve. More Reverb also turns the sound's own mix down (and
 * what it sends with it), so the Level knob comes up by as much, and what Level cannot give (it ends at 1) goes on
 * the track's fader, in the tenths of a dB a fader is stored in, up to its top. The shimmer goes to the room past the
 * Reverb knob, so on the strings it is turned up `times` too.
 *
 * What cannot be kept: a Reverb that would pass the top of its knob stays there, and behind a synth's arpeggio or
 * pulse the track's Reverb counts only up to a small amount (trackvoice.ts `rackForPlay`), which more Reverb does not
 * pass. `wet` and `dry` say how much is reached. A Reverb at nothing stays at nothing.
 */
export function keepReverb(sound: Partial<HarpSound> | undefined, tone: Tone, kind: "chords" | "melody", times: number, db = 0): KeptReverb {
  if (!(times > 1 + 1e-9)) return { sound, wet: 1, dry: 1 };
  const s = reviveSound(sound);
  const play = tone.inst === "synth" ? reviveSynth(synthOf(tone, kind)).play : null;
  /** the Reverb that is heard at a setting of the knob */
  const heard = (space: number): number => rackForPlay({ ...s, space }, play).space;
  const sendOf = (space: number): number => verbSendOf({ space, verb: s.verb });
  const was = heard(s.space);
  const top = heard(1);
  const now = Math.min(top, r4(reach(sendOf, times * sendOf(was), was, top)));
  const more = now > was + 1e-9;
  const space = more ? now : s.space;
  // the sound's own mix came down with the Reverb: the volume that puts it back
  let level = s.level;
  let lift = 0;
  let dry = 1;
  if (more && s.level > 0) {
    const want = (volOf(s.level) * dryOf(was)) / dryOf(now);
    if (volOf(1) < want) {
      const over = 20 * Math.log10(want / volOf(1));
      const room = Math.max(0, Math.floor((MAX_DB - db) * 10 + 1e-6) / 10);
      lift = Math.min(room, Math.ceil(over * 10 - 1e-6) / 10);
    }
    const gain = Math.pow(10, lift / 20);
    level = r4(reach(volOf, want / gain, 0, 1));
    dry = (volOf(level) * gain) / want;
  }
  const shimmer = tone.inst !== "piano" && tone.inst !== "synth" ? Math.min(1, r4(s.shimmer * times)) : s.shimmer;
  const wet = was > 0 ? (sendOf(more ? now : was) / (times * sendOf(was))) * dry : 1;
  const change: Partial<HarpSound> = { ...(space !== s.space ? { space } : {}), ...(level !== s.level ? { level } : {}), ...(shimmer !== s.shimmer ? { shimmer } : {}) };
  if (!Object.keys(change).length) return { sound, wet, dry };
  return { sound: { ...clone(sound), ...change }, ...(lift > 0 ? { db: Math.round((db + lift) * 10) / 10 } : {}), wet, dry };
}

/** The voice the old engine played a tone and a sound on: its name (synth.ts `slotOf`, without the track). */
const voiceKey = (tone: Tone, sound: HarpSound): string => `${JSON.stringify(tone)}|${JSON.stringify(sound)}`;

/**
 * How many times as loud as its knob says the reverb of a sound was heard, on a row the old engine ran these voices
 * for (each with its sound; the sound's own voice among them). Every voice on the sound's own room is one more join
 * to it: they add up. What went to the other rooms cannot be sent there by one voice: it is counted as that much more
 * of the track's own room, as loud as it was heard (rooms ring apart, so their loudness adds as power; a kind of room
 * that gives back less of what it is sent counts for less).
 */
export function reverbTimes(own: HarpSound, voices: HarpSound[]): number {
  const rooms = new Map<string, { n: number; verb: HarpSound["verb"] }>();
  for (const v of voices) {
    const k = roomKey(v.verb, v.size);
    const r = rooms.get(k) ?? { n: 0, verb: v.verb };
    r.n++;
    rooms.set(k, r);
  }
  const mine = roomKey(own.verb, own.size);
  const back = (verb: HarpSound["verb"]): number => verbSendOf({ space: 1, verb });
  let power = 0;
  for (const [k, r] of rooms) power += Math.pow(k === mine ? r.n : (r.n * back(own.verb)) / back(r.verb), 2);
  return Math.sqrt(power);
}

/** Does a drum rhythm have a hit anywhere? */
const hasHits = (b: Beat): boolean => Object.values(b.rows ?? {}).some((r) => /[1-9]/.test(r ?? ""));

/** What one old row holds in one section, when it gets a clip there. */
type Cell =
  | { kind: "chords"; chords: ProgChord[]; style: PatternId; feel?: Partial<Feel>; arrange?: ArrangeSettings; sound?: Partial<HarpSound>; tone: Tone; key: string }
  | { kind: "melody"; melody: Melody; mute: boolean; sound?: Partial<HarpSound>; tone: Tone; key: string }
  | { kind: "drums"; beat: Beat; mute: boolean; key: string };

/** A fully loaded old song as tracks and clips. Pure: the same song in gives the same song out. */
export function toTimeline(p: Progression): Converted {
  const np = normalize(p);
  const songSig = sigOf(p);
  const secs = sections(p);
  const row: Section[] = secs.length ? secs : [soloSection(np)];
  const blockOf = (sec: Section) => sec.blockId || SOLO_BLOCK;

  // ── sections in running order: the bar map, the length, the markers ──
  const lay: { sec: Section; sig: TimeSig; bar: number; bars: number; beats: number; at: number; firstBar: number }[] = [];
  let at = 0;
  let firstBar = 0;
  for (const sec of row) {
    const sig = sec.meter ?? songSig;
    const bar = sigBeats(sig);
    const bars = barsOr(sec.bars);
    lay.push({ sec, sig, bar, bars, beats: bars * bar, at, firstBar });
    at += bars * bar;
    firstBar += bars;
  }
  const end = at;
  const sigs: { bar: number; sig: TimeSig }[] = [];
  for (let k = 1; k < lay.length; k++) if (!sameSig(lay[k].sig, lay[k - 1].sig)) sigs.push({ bar: lay[k].firstBar, sig: lay[k].sig });
  const markers: Marker[] = secs.length ? lay.map((x) => ({ id: blockOf(x.sec), beat: x.at, name: x.sec.label, color: x.sec.color })) : [];

  // ── what each row holds in each section ──
  const rows = allTracks(np);
  const cellOf = (t: OldTrack, sec: Section): Cell | null => {
    const first = t.id === t.kind;
    const l = first ? undefined : sec.layers?.[t.id];
    if (!first && !l) return null;
    if (t.kind === "chords") {
      const chords = first ? sec.chords : l!.chords ?? [];
      if (!chords.length) return null;
      const tone = toneOf(sec, t.id);
      const sound = first ? sec.sound : l!.sound;
      return tidy({ kind: "chords" as const, chords, style: (first ? sec.style : l!.pattern) ?? PLAIN_STYLE, feel: first ? sec.feel : l!.feel, arrange: first ? sec.arrange : l!.arrange, sound, tone, key: soundKey(tone, sound, "chords") });
    }
    if (t.kind === "melody") {
      const melody = first ? sec.melody : l!.melody;
      if (!melody?.notes.length) return null;
      const tone = toneOf(sec, t.id);
      const sound = first ? sec.tuneSound : l!.tuneSound;
      return tidy({ kind: "melody" as const, melody, mute: melody.on === false, sound, tone, key: soundKey(tone, sound, "melody") });
    }
    if (t.kind === "drums") {
      const beat = first ? drumsIn(sec) : l!.beat;
      if (!beat) return null;
      const key = kitSig(kitOfBeat(beat));
      // drums that were never used: off, not edited, still on the rhythm a new idea starts with
      if (!beat.on && !beat.edited && beat.patternId === DEFAULT_BEAT.patternId) return null;
      if (hasHits(beat)) return { kind: "drums", beat, mute: !beat.on, key };
      // the first drums, on but empty: the chord styles and the melodies still follow their swing and their triplet grid
      if (first && beat.on && (beat.swing > 0 || beat.div === 3)) return { kind: "drums", beat, mute: false, key };
      return null;
    }
    return null;
  };

  /**
   * Every voice the old engine made for a chords or melody row, over the whole song, each with its sound (as the old
   * plan listed them and the old player and render asked for them). The first chords: one in every section, silent
   * ones too (the player asked for the voice before it looked whether there was a chord). An added chords row: where
   * it has a chord that sounds, and no harmony plays instead of it. A melody: where it has notes and is on.
   */
  const voicesOf = (t: OldTrack): Map<string, HarpSound> => {
    const out = new Map<string, HarpSound>();
    const first = t.id === t.kind;
    for (const x of lay) {
      const l = first ? undefined : x.sec.layers?.[t.id];
      let sound: Partial<HarpSound> | undefined;
      if (t.kind === "chords") {
        if (first) sound = x.sec.sound;
        else {
          if (!l?.chords?.length || insteadIn(x.sec.partId, x.sec.layers, np.tracks, np.mix).has(t.id)) continue;
          if (!inFrame(l.chords, x.beats).some((c) => !c.item.rest)) continue;
          sound = l.sound;
        }
      } else {
        if (!hasTune(first ? x.sec.melody : l?.melody)) continue;
        sound = first ? x.sec.tuneSound : l?.tuneSound;
      }
      const s = reviveSound(sound);
      out.set(voiceKey(toneOf(x.sec, t.id), s), s);
    }
    return out;
  };

  const tracks: Track[] = [];
  const clips: Clip[] = [];
  const ids: Record<string, string[]> = {};
  /** the faders moved to keep a track's level (see `keepReverb`): new track id → dB */
  const faders = new Map<string, number>();
  /** the new track that holds an old row's clip in a block */
  const holder = new Map<string, string>();
  const holderOf = (old: string, block: string): string => holder.get(`${block}\n${old}`) ?? ids[old]?.[0] ?? FIRST_IDS[old] ?? old;
  const cur = row.find((s) => s.current) ?? row[0];

  for (const t of rows) {
    if (t.kind === "vocals") continue;
    const base = FIRST_IDS[t.id] ?? t.id;
    const cells = lay.map((x) => cellOf(t, x.sec));
    // one sound to a track: the sections it has music in, grouped by how it is heard there
    const groups: { key: string; at: number[]; bars: number }[] = [];
    cells.forEach((c, k) => {
      if (!c) return;
      let g = groups.find((x) => x.key === c.key);
      if (!g) groups.push((g = { key: c.key, at: [], bars: 0 }));
      g.at.push(k);
      g.bars += lay[k].bars;
    });
    // the one that covers the most bars keeps the row's name and id (the first, on a tie)
    const main = groups.reduce<(typeof groups)[number] | null>((m, g) => (!m || g.bars > m.bars ? g : m), null);
    const order = main ? [main, ...groups.filter((g) => g !== main)] : [];
    const role = t.role ? { role: t.role } : {};
    const harmony = t.harmony ? { harmony: { from: FIRST_IDS[t.harmony.from] ?? t.harmony.from, option: t.harmony.option } } : {};
    const lead = t.id === "chords" || t.id === "drums" ? { lead: true as const } : {};
    const split = order.length > 1 ? { group: base } : {};
    ids[t.id] = [];
    // the voices the old engine ran for the row: more than one, and its reverb was heard louder than its knob says
    const voices = t.kind === "chords" || t.kind === "melody" ? voicesOf(t) : null;
    const make = (id: string, name: string, cell: Cell | null, tone: Tone | undefined): Track => {
      if (t.kind === "drums") return { id, kind: "drums", name, ...split, kit: clone(kitOfBeat(cell?.kind === "drums" ? cell.beat : restBeat(t, cur, row))), ...lead } as DrumsTrack;
      const kind = t.kind === "chords" ? ("chords" as const) : ("melody" as const);
      let sound = clone(cell && cell.kind !== "drums" ? cell.sound : restSound(t, cur));
      if (cell && cell.kind !== "drums" && voices) {
        // (the track's own voice counts, also where the old engine never made it: a melody that is off)
        const own = reviveSound(cell.sound);
        const all = new Map(voices).set(voiceKey(cell.tone, own), own);
        const kept = keepReverb(sound, tone ?? cell.tone, kind, reverbTimes(own, [...all.values()]), np.mix?.[t.id]?.db ?? 0);
        sound = kept.sound;
        if (kept.db !== undefined) faders.set(id, kept.db);
      }
      const head = { id, kind, name, ...split, tone: clone(tone ?? toneOf(cur, t.id)), sound };
      return (kind === "chords" ? tidy({ ...head, ...lead, ...role, ...harmony }) : tidy({ ...head, ...role, ...harmony })) as ChordsTrack | TuneTrack;
    };
    if (!order.length) {
      tracks.push(make(base, t.name, null, undefined));
      ids[t.id].push(base);
    }
    order.forEach((g, n) => {
      const id = n === 0 ? base : `${base}~${n + 1}`;
      const firstAt = g.at[0];
      const name = n === 0 ? t.name : `${t.name} · ${lay[firstAt].sec.label}`;
      // the fullest tone of the group: nothing an instrument remembers is lost
      let tone: Tone | undefined;
      for (const k of g.at) {
        const c = cells[k]!;
        if (c.kind !== "drums" && (!tone || Object.keys(c.tone).length > Object.keys(tone).length)) tone = c.tone;
      }
      tracks.push(make(id, name, cells[firstAt], tone));
      ids[t.id].push(id);
      for (const k of g.at) {
        const x = lay[k];
        const c = cells[k]!;
        const block = blockOf(x.sec);
        holder.set(`${block}\n${t.id}`, id);
        const head = { id: `${block}.${t.id}`, track: id, start: x.at, len: x.beats, off: 0, sig: x.sig };
        if (c.kind === "chords") clips.push({ ...head, kind: "chords", content: tidy({ chords: clone(c.chords), bars: x.bars, style: c.style, feel: clone(c.feel), arrange: clone(c.arrange) }) });
        else if (c.kind === "melody") {
          const { on: _on, ...m } = inBars(c.melody, x.bars);
          clips.push({ ...head, kind: "melody", content: clone(m), ...(c.mute ? { mute: true } : {}) });
        } else {
          const { on: _on, ...g5 } = grooveOf(c.beat);
          clips.push({ ...head, kind: "drums", content: clone({ ...g5, bars: barsOf(c.beat) }), ...(c.mute ? { mute: true } : {}) });
        }
      }
    });
  }

  // ── harmony records: each section's record goes onto the clip made there; "plays instead" onto the clip that does ──
  const byId = new Map(clips.map((c) => [c.id, c]));
  for (const t of rows) {
    if (t.kind !== "chords" && t.kind !== "melody") continue;
    for (const x of lay) {
      const block = blockOf(x.sec);
      const c = byId.get(`${block}.${t.id}`);
      if (!c || c.kind === "drums" || c.kind === "audio") continue;
      const mark = markOf(np, t.harmony, x.sec.partId, (old) => holderOf(old, block));
      if (mark) c.harmony = mark;
      if (c.kind === "chords" && t.id !== "chords") {
        const target = insteadHere(t, np.tracks ?? [], x.sec.partId);
        if (target) c.instead = holderOf(target, block);
      }
    }
  }

  // ── vocal tracks: takes at their beat, clips where they sound, layers that overlapped as tracks of their own ──
  const spb = 60 / Math.max(1, np.bpm);
  const where = new Map(lay.map((x) => [x.sec.blockId, x]));
  for (const t of rows) {
    if (t.kind !== "vocals") continue;
    const input = t.input === 2 ? { input: { ch: 1 } } : {};
    const fx = clone(t.fx ?? FX_DEFAULT);
    /** takes whose bar is no longer in their section: their clips are kept, silent */
    const gone = new Set<string>();
    const takes: Take5[] = (t.takes ?? []).map((k) => {
      const x = where.get(k.at.block);
      const { at: _at, ...rest } = k;
      if (!x) return { ...clone(rest), at: null };
      if (!(k.at.bar >= 0 && k.at.bar * x.bar < x.beats - 1e-6)) gone.add(k.id);
      return { ...clone(rest), at: x.at + k.at.bar * x.bar };
    });
    const takeOf = new Map(takes.map((k) => [k.id, k]));
    const made: { clip: AudioClip; end: number }[] = [];
    for (const { clip, take } of placedClips(t)) {
      const k = takeOf.get(take.id);
      if (!k || k.at === null || !(take.rate > 0) || !(clip.to > clip.from)) continue;
      let start = k.at + ((clip.from + (clip.move ?? 0)) / take.rate) / spb;
      let off = clip.from;
      let frames = clip.to - clip.from;
      let mute = gone.has(take.id);
      if (start < 0) {
        // it began before the song does: the part from the song's first beat on is what plays (nothing of it, if it was over by then)
        const cut = -start * spb * take.rate;
        if (cut < frames - 1e-6) {
          off += cut;
          frames -= cut;
        } else mute = true;
        start = 0;
      }
      const id = made.some((m) => m.clip.id === clip.id) || byId.has(clip.id) ? `${t.id}.${clip.id}` : clip.id;
      made.push({ clip: { id, track: t.id, kind: "audio", take: take.id, from: 0, to: take.frames, off, frames, start, ...(mute ? { mute: true } : {}) }, end: start + frames / take.rate / spb });
    }
    // lay them into layers: each clip into the first where it overlaps nothing (the two pieces of a split touch, and do not overlap)
    const lanes: { clip: AudioClip; end: number }[][] = [];
    for (const m of [...made].sort((a, b) => a.clip.start - b.clip.start)) {
      const rate = takeOf.get(m.clip.take)!.rate;
      const tol = 0.5 / rate / spb;
      let lane = lanes.find((l) => l.every((o) => o.end <= m.clip.start + tol || o.clip.start >= m.end - tol));
      if (!lane) lanes.push((lane = []));
      lane.push(m);
    }
    ids[t.id] = [];
    const count = Math.max(1, lanes.length);
    for (let n = 0; n < count; n++) {
      const id = n === 0 ? t.id : `${t.id}~${n + 1}`;
      const mine = (lanes[n] ?? []).map((m) => ({ ...m.clip, track: id }));
      const used = new Set(mine.map((c) => c.take));
      const track: AudioTrack = { id, kind: "vocals", name: n === 0 ? t.name : `${t.name} · ${n + 1}`, ...(count > 1 ? { group: t.id } : {}), ...input, fx: n === 0 ? fx : clone(fx), takes: n === 0 ? takes : takes.filter((k) => used.has(k.id)).map((k) => clone(k)) };
      tracks.push(track);
      ids[t.id].push(id);
      clips.push(...mine);
    }
  }

  // ── the mixer: every track an old row became gets that row's entry ──
  let mix: Mix | undefined;
  for (const [old, m] of Object.entries(np.mix ?? {})) {
    if (!m) continue;
    const { instead: _instead, ...rest } = m;
    for (const id of ids[old] ?? []) (mix ??= {})[id] = { ...rest } as TrackMix;
  }
  for (const [id, db] of faders) (mix ??= {})[id] = { ...mix[id], db };

  const song: TimelineSong = { v: 5, bpm: np.bpm, meter: lay[0].sig, ...(sigs.length ? { sigs } : {}), tracks, clips, ...(mix ? { mix } : {}), ...(markers.length ? { markers } : {}), end };
  return { song, ids };
}

/** The sound a row with no music anywhere is given: the one it has in the section on screen. */
function restSound(t: OldTrack, cur: Section): Partial<HarpSound> | undefined {
  if (t.id === "chords") return cur.sound;
  if (t.id === "melody") return cur.tuneSound;
  const l = cur.layers?.[t.id];
  return t.kind === "chords" ? l?.sound : l?.tuneSound;
}
/** The drums a row with no rhythm anywhere is given: as in the section on screen, else in the first section that has the row. */
function restBeat(t: OldTrack, cur: Section, row: Section[]): Beat {
  if (t.id === "drums") return drumsIn(cur);
  return cur.layers?.[t.id]?.beat ?? row.map((s) => s.layers?.[t.id]?.beat).find((b) => !!b) ?? DEFAULT_BEAT;
}

/** What Harmonize wrote in one section, as the record a clip carries: the source is named by the track that holds it there. */
function markOf(p: Progression, h: HarmonyOf | undefined, part: string, holder: (old: string) => string): HarmonyMark5 | undefined {
  const m = markIn(p, h, part);
  if (!h || !m) return undefined;
  return tidy({ from: holder(m.from ?? h.from), option: m.option ?? h.option, shape: m.shape, src: m.src, out: m.out, along: m.along });
}

/** How many of a converted song's recordings lie nowhere (their section was deleted before): they are in the take list, to be laid again. */
export const unplacedTakes = (song: TimelineSong): number => song.tracks.reduce((n, t) => n + (t.kind === "vocals" || t.kind === "audio" ? t.takes.filter((k) => k.at === null).length : 0), 0);

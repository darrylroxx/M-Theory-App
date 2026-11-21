// Frozen copy of GuitarView.tsx:204-307 at commit 0f436e9. The reference a converted song is compared with. Do not improve it.
//
// The original is worked out inside the big view, from its hooks. Here the same lines are a plain function, so a test
// can call them. What differs from the original, and nothing else:
//  - the song passed in is the song heard: there is no audition, so `heard` and `prog` are both `p`
//  - the shapes come from `voicingsFor(ctx)`, also for the section on screen
//  - a take's sound comes from `buffer`, which the caller hands in
//  - what only the screen read (each section's shapes and lengths) is not worked out
import type { Beat } from "../audio/beats";
import type { ExtraPlay, PlayItem, PlayTune } from "../audio/patterns";
import { reviveSound } from "../audio/rack";
import { keysVoicings, onKeys, toneOf } from "../audio/tone";
import { voicingsFor, type VoicingCtx } from "../timeline/voicing";
import type { Progression } from "../ui/state";
import { playedNotes } from "./chordnotes";
import { layClips, placedClips } from "./clips";
import { barsOr, frameBeats, inFrame, sliceItems, type LoopSpan } from "./frame";
import { hasTune, inBars } from "./melody";
import { isCompound, sigBeats } from "./meter";
import { drumsIn, sections, soloSection, type Section } from "./structure";
import type { Take } from "./takes";
import { PLAIN_STYLE, drumsOf, insteadIn, normalize } from "./tracks";
import { sigOf } from "./unity";

/** One section as it plays: which it is, what it is called and its colour, its bars, how long a bar is, its items from start to end, and which chord each item is (−1 = none). */
export type SecPlan = { block: string; partId: string; label: string; color: number; bars: number; bar: number; items: PlayItem[]; idx: number[] };

/** The whole song as the old view plays it, section after section: the items, which chord each one is, every section on its own, and whether there is anything to hear. */
export function legacyPlan(p: Progression, ctx: VoicingCtx, buffer: (t: Take) => AudioBuffer | undefined): { items: PlayItem[]; map: { block: string; idx: number }[]; per: SecPlan[]; any: boolean } {
  const voicingsOf = voicingsFor(ctx);
  const songSig = sigOf(p);
  // The whole song, section after section. A section with no chords is one bar of the beat on its own.
  const secs = sections(p);
  // Each section plays its own music, and only its own tracks, each with its sound in that section.
  const list: PlayItem[] = [];
  const map: { block: string; idx: number }[] = [];
  /** every section on its own: what it plays, start to end, and which chord each item is */
  const per: SecPlan[] = [];
  /** is there anything in the song to hear? */
  let any = false;
  // with no song yet, what is on the page is section A (every track in its place: a page may be editing an added track)
  const np = normalize(p);
  const row: Section[] = secs.length ? secs : [soloSection(np)];
  // every clip of the vocal tracks (a stretch of a take, as edited on the Vocals lane), laid in the song where it
  // plays: one over a stretch of several sections is listed in each, at where it starts counted from that section's
  // start (before it, for the sections after the first), so the player knows its place wherever the music is
  const laid = layClips(
    row.map((sec) => {
      const secBar = sigBeats(sec.meter ?? songSig);
      return { block: sec.blockId, bar: secBar, beats: frameBeats(sec.bars, secBar) };
    }),
    (np.tracks ?? []).flatMap((t) => (t.kind === "vocals" ? placedClips(t).map(({ clip, take }) => ({ clip, take: { ...take, track: t.id } })) : [])),
    np.bpm,
  );
  // what plays each track, and how it sounds, in each section: the item carries it, so the player,
  // the WAV and the backing all play the same. (Sections that sound the same share the same objects.)
  const shared = new Map<string, unknown>();
  const one = <T,>(x: T): T => {
    const k = JSON.stringify(x);
    if (!shared.has(k)) shared.set(k, x);
    return shared.get(k) as T;
  };
  /** What the tracks added in a section play there. */
  const extrasOf = (sec: Section, len: number, secBar: number, swing: number, quiet: ReadonlyMap<string, string>): ExtraPlay | undefined => {
    const ex: ExtraPlay = { chords: [], tunes: [], drums: [] };
    for (const t of np.tracks ?? []) {
      const l = sec.layers?.[t.id];
      if (!l) continue;
      if (t.kind === "chords" && l.chords?.length && !quiet.has(t.id)) {
        const tone = one(toneOf(sec, t.id));
        const sound = one(reviveSound(l.sound));
        const feel = l.feel && one(l.feel);
        const vs = voicingsOf(l.chords, l.arrange);
        const kv = onKeys(tone) ? keysVoicings(l.chords, tone) : null;
        let at = 0;
        for (const { item: c, index: i } of inFrame(l.chords, len)) {
          ex.chords.push({ track: t.id, at, beats: c.beats, midi: c.rest ? [] : playedNotes(c) ?? (kv ? kv[i] : vs[i]?.midi?.filter((m): m is number => m !== null)) ?? [], style: l.pattern ?? PLAIN_STYLE, feel, sound, tone });
          at += c.beats;
        }
      } else if (t.kind === "melody" && hasTune(l.melody)) ex.tunes.push({ track: t.id, tune: { m: inBars(l.melody, barsOr(sec.bars)), bar: secBar, swing, sound: one(reviveSound(l.tuneSound)), tone: one(toneOf(sec, t.id)) } });
      else if (t.kind === "drums" && l.beat?.on) ex.drums.push({ track: t.id, beat: drumsOf(l)! });
    }
    // the clips that lie under this section (the buffer holds just the take: a clip plays its stretch of it)
    for (const { clip, take: tk, at, offset, dur, joined } of laid[sec.blockId] ?? []) {
      const buf = buffer(tk);
      if (buf) (ex.takes ??= []).push({ track: tk.track, buffer: buf, at, offset, dur, id: clip.id, ...(joined ? { joined } : {}) });
    }
    return ex.chords.length || ex.tunes.length || ex.drums.length || ex.takes?.length ? ex : undefined;
  };
  for (const sec of row) {
    // the first tracks' sound in this section
    const firstTone = one(toneOf(sec, "chords"));
    const tuneTone = one(toneOf(sec, "melody"));
    const style = sec.style ?? PLAIN_STYLE;
    const feel = sec.feel && one(sec.feel);
    const harp = one(reviveSound(sec.sound));
    const tuneHarp = one(reviveSound(sec.tuneSound));
    // (a chords track a harmony plays instead of, in this section, is not heard here)
    const quiet = insteadIn(sec.partId, sec.layers, np.tracks, np.mix);
    // (the view takes the page's own shapes for the section on screen: for a settled song they are these same shapes)
    const vs = voicingsOf(sec.chords, sec.arrange);
    const kv = onKeys(firstTone) ? keysVoicings(sec.chords, firstTone) : null;
    // the first drums track: its kit and rhythm in this section
    const drums: Beat = one(drumsIn(sec));
    // every section plays in its own time signature (the song's, unless it has one of its own)
    const secSig = sec.meter ?? songSig;
    const secBar = sigBeats(secSig);
    const secMeter = { bar: secBar, triplet: isCompound(secSig), sig: secSig };
    const secTune: PlayTune | null = hasTune(sec.melody) ? { m: inBars(sec.melody, barsOr(sec.bars)), bar: secBar, swing: drums.on && drums.div === 4 ? drums.swing : 0, sound: tuneHarp, tone: tuneTone } : null;
    // the section's frame: everything in it plays in its own bar, for exactly this long
    const len = frameBeats(sec.bars, secBar);
    const inside = inFrame(sec.chords, len);
    const extra = extrasOf(sec, len, secBar, drums.on && drums.div === 4 ? drums.swing : 0, quiet);
    const own: PlayItem[] = [];
    const idx: number[] = [];
    inside.forEach(({ item: c, index: i }, k) => {
      own.push({ midi: c.rest || quiet.has("chords") ? [] : playedNotes(c) ?? (kv ? kv[i] : vs[i]?.midi?.filter((m): m is number => m !== null)) ?? [], beats: c.beats, drums, style, feel, sound: harp, tone: firstTone, tune: secTune, section: k === 0, extra, meter: secMeter });
      idx.push(i);
    });
    // after the last chord the section goes on to the end of its last bar: drums and melody carry on, the harp is silent
    const played = inside.reduce((a, x) => a + x.item.beats, 0);
    if (played < len - 1e-6) {
      own.push({ midi: [], beats: len - played, drums, style, sound: harp, tone: firstTone, tune: secTune, section: !inside.length, pad: true, extra, meter: secMeter });
      idx.push(-1);
    }
    per.push({ block: sec.blockId, partId: sec.partId, label: sec.label, color: sec.color, bars: barsOr(sec.bars), bar: secBar, items: own, idx });
    list.push(...own);
    map.push(...idx.map((i) => ({ block: sec.blockId, idx: i })));
    if (sec.chords.some((c) => !c.rest) || drums.on || secTune || extra) any = true;
  }
  return { items: list, map, per, any };
}

/** The bars of a run of the loop, as items to play (or to render for the recording engine). (GuitarView.tsx:327-343, copied the same way.) */
export function legacySlice(per: SecPlan[], loop: LoopSpan): { items: PlayItem[]; map: { block: string; idx: number }[]; loop: true } {
  const a = per.findIndex((x) => x.block === loop.from.block);
  const b = per.findIndex((x) => x.block === loop.to.block);
  const items: PlayItem[] = [];
  const map: { block: string; idx: number }[] = [];
  for (let k = a; k <= b; k++) {
    const x = per[k];
    const from = k === a ? loop.from.bar * x.bar : 0;
    const to = k === b ? (loop.to.bar + 1) * x.bar : x.bars * x.bar;
    // every item says how far into its section it starts, so the drums, the melody and the style pick up at the right bar
    sliceItems(x.items, from, to).forEach((c, n) => {
      items.push({ ...c.item, from: c.from, section: n === 0 });
      map.push({ block: x.block, idx: x.idx[c.index] });
    });
  }
  return { items, map, loop: true };
}

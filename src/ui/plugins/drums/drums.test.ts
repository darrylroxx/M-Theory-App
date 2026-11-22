// The Drums plugin: the drum machine as a composer and as a sound window of one drums track.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BEAT_GROUPS, BEAT_LIBRARY, BUILTIN_KITS, DEFAULT_BEAT, NOISE_BEDS, VERBS, VIBES, applyKit, grooveOf, kitOfBeat, kitSig, onKit, reviveKit, type Beat, type BeatPattern, type Groove } from "../../../audio/beats";
import { DRUM_IDS, DRUM_LABEL, KITS, SAMPLERS } from "../../../audio/drums";
import { SAT_TYPES } from "../../../audio/saturation";
import { RECIPES } from "../../../audio/voices";
import { getTuning } from "../../../guitar/tunings";
import { sigBeats } from "../../../song/meter";
import { contentBars, openOf } from "../../../timeline/content";
import { reviveSong5 } from "../../../timeline/library5";
import type { DrumsClip, DrumsTrack, TimelineSong } from "../../../timeline/model";
import { SIG34, SIG68, bandSong, drumsClip, drumsTrack, songOf } from "../../../timeline/testsongs";
import { DrumMachine } from "../../components/DrumMachine";
import { AppCtx, DEFAULT_STATE, type AppState, type Ctx, type Progression } from "../../state";
import { beatOf, controlOf, pickRhythm, rhythmOf, soundBeat, writeBeat } from "./beat";
import { hasModelNumber, plainName } from "./names";
import { drumView, dropDrumView, setDrumView } from "./store";

/** The old pages' context with a state, and nothing that does anything. */
function ctxOf(state: AppState): Ctx {
  const no = () => {};
  return {
    state, set: no, tuning: getTuning("standard"), sheet: null, openSheet: no, toast: no, audition: no, shapeOf: () => undefined, setShape: no, addChord: no,
    idea: null, dirty: false, saveIdea: () => "nothing", openIdea: no, newIdea: no, opened: 0, renameIdea: no, deleteIdea: no, importIdeas: () => 0,
    cloud: "local", syncNow: no, recordingTo: null, setRecordingTo: no,
  } as unknown as Ctx;
}
/** A song whose "section on screen" must not be asked for: reading `focus` or `song` fails. */
const guarded = (): Progression => new Proxy({ ...DEFAULT_STATE.progression }, {
  get(t, k, r) {
    if (k === "focus" || k === "song") throw new Error(`read ${String(k)}`);
    return Reflect.get(t, k, r);
  },
});
const beat: Beat = { ...DEFAULT_BEAT, on: true };
function draw(props: Partial<Parameters<typeof DrumMachine>[0]>, progression: Progression = guarded()): string {
  return renderToStaticMarkup(createElement(AppCtx.Provider, { value: ctxOf({ ...DEFAULT_STATE, progression }) },
    createElement(DrumMachine, { beat, setBeat() {}, onPick() {}, playing: false, frame: 4, getPos: () => null, shown: 4, follow: false, active: true, ...props })));
}
const clip = (s: TimelineSong, id: string) => s.clips.find((c) => c.id === id) as DrumsClip;
const track = (s: TimelineSong, id: string) => s.tracks.find((t) => t.id === id) as DrumsTrack;

describe("the drum machine inside a plugin window", () => {
  it("with a track it reads no \"focus\" and no \"song.current\": nothing of the section on screen", () => {
    expect(() => draw({ trackId: "td", resetKey: 0, show: "compose", bpm: 96 })).not.toThrow();
    expect(() => draw({ trackId: "td", show: "sound", bpm: 96 })).not.toThrow();
    // (the old page does read them: without a track the same song is asked for both)
    expect(() => draw({})).toThrow(/read (focus|song)/);
  });

  it("the composer holds the kit beside the rhythm, Edit, a tab and a grid row for every bar and drum, and Swing; no sound panels, no On switch", () => {
    const html = draw({ trackId: "td", show: "compose", bpm: 96 });
    expect(html).toContain('aria-label="Kit: ');
    expect(html).toContain('aria-label="Rhythm: ');
    expect(html.indexOf('aria-label="Kit: ')).toBeLessThan(html.indexOf('aria-label="Rhythm: '));
    expect(html).toContain("✎ Edit");
    expect(html).toContain('aria-label="Swing"');
    expect(html.split('role="tab"').length - 1).toBe(4);
    for (const id of DRUM_IDS) expect(html).toContain(`bg-label d-${id}`);
    expect(html.split("bg-cell").length - 1).toBe(4 * 9 * beat.steps);
    for (const gone of ["Drum mixer", "Effects for the whole kit", 'aria-label="Human"', "All sections", 'role="switch"']) expect(html).not.toContain(gone);
  });

  it("the sound window holds the kit, the mixer, the chosen drum's sound and every effect; no grid, no Swing, no \"All sections\"", () => {
    const html = draw({ trackId: "td", show: "sound", bpm: 96, frame: 1 });
    expect(html).toContain('aria-label="Kit: ');
    expect(html).toContain(">Mixer<");
    expect(html).toContain(">Sound<");
    expect(html).toContain(">Effects<");
    // the mixer: a fader, mute and solo for each drum, and the whole kit's level
    for (const id of DRUM_IDS) {
      expect(html).toContain(`aria-label="${DRUM_LABEL[id]} volume"`);
      expect(html).toContain(`aria-label="Mute ${DRUM_LABEL[id]}"`);
      expect(html).toContain(`aria-label="Solo ${DRUM_LABEL[id]}"`);
    }
    expect(html).toContain('aria-label="Whole kit volume"');
    // the drum's own sound
    for (const k of ["Tune", "Decay", "Drive", "Filter", "Level", "Pan", "Reverb", "Echo"]) expect(html).toContain(`aria-label="${k}"`);
    expect(html).toContain('aria-label="Sound"');
    expect(html).toContain('aria-label="Previous sound"');
    // the effects of the whole kit
    for (const v of VIBES) expect(html).toContain(`>${v.name}<`);
    for (const k of ["Human", "Saturation", "Colour", "Blend", "Reverb type", "Size", "Echo time", "Sampler", "Noise", "Tape", "Tone", "Glue", "Pump"]) expect(html).toContain(`aria-label="${k}"`);
    for (const gone of ["bg-cell", 'aria-label="Swing"', "All sections", "✎ Edit", 'aria-label="Rhythm: ']) expect(html).not.toContain(gone);
  });

  it("a drum picked in the composer is the drum the sound window shows", () => {
    dropDrumView("td");
    expect(draw({ trackId: "td", show: "sound", bpm: 96 })).toContain('aria-label="Kick sound"');
    setDrumView("td", { sel: "snare" });
    expect(draw({ trackId: "td", show: "sound", bpm: 96 })).toContain('aria-label="Snare sound"');
    // and it is lit in the composer's grid
    expect(draw({ trackId: "td", show: "compose", bpm: 96 })).toContain("bg-label d-snare on");
    // each track has its own
    expect(draw({ trackId: "other", show: "sound", bpm: 96 })).toContain('aria-label="Kick sound"');
    expect(drumView("td")).toMatchObject({ sel: "snare", solo: null });
    dropDrumView("td");
  });

  it("the old page, without a track, is as it was: everything in one card, the panels behind their chips", () => {
    const html = draw({}, { ...DEFAULT_STATE.progression });
    expect(html).toContain("card drums");
    expect(html).toContain('role="switch"');
    for (const chip of [">Mixer<", ">Sound<", ">Effects<"]) expect(html).toContain(chip);
    expect(html).not.toContain("Drum mixer");
  });
});

describe("a rhythm and a kit, joined for the machine and written back apart", () => {
  it("grooveOf and kitOfBeat split a beat, and onKit joins them back equal", () => {
    const b: Beat = { ...applyKit({ ...DEFAULT_BEAT, on: true }, "909"), space: 0.6, mutes: ["hat"], sounds: { kick: { tune: -3 } }, swing: 0.3 };
    const joined = onKit(grooveOf(b) as Beat, kitOfBeat(b));
    expect(joined).toEqual({ ...b, edited: !!b.edited, bars: 1 });
    expect(kitSig(kitOfBeat(joined))).toBe(kitSig(kitOfBeat(b)));
    // and through the plugin's own steps: the rhythm of a clip on its track's kit
    const made = beatOf(rhythmOf(b), kitOfBeat(b));
    expect(grooveOf(made)).toEqual(grooveOf(b));
    expect(kitOfBeat(made)).toEqual(kitOfBeat(b));
  });

  it("a hit written in the grid goes into the open clip; the kit and every other clip stay as they are", () => {
    const band = bandSong();
    const t = { track: "td", clip: "d1" };
    const before = beatOf(clip(band, "d1").content, track(band, "td").kit);
    const after = { ...before, rows: { ...before.rows, clap: "3" + before.rows.clap.slice(1) }, edited: true };
    const out = writeBeat(band, t, 0, before, after);
    expect(clip(out, "d1").content.rows.clap[0]).toBe("3");
    expect(out.tracks).toBe(band.tracks);
    expect(out.clips.filter((c) => c.id !== "d1")).toEqual(band.clips.filter((c) => c.id !== "d1"));
    expect(controlOf("td", before, after)).toBeUndefined();
    expect(writeBeat(band, t, 0, before, before)).toBe(band);
  });

  it("a knob of the kit goes onto the track, and is one undo step while it is turned", () => {
    const band = bandSong();
    const t = { track: "td", clip: "d1" };
    const before = beatOf(clip(band, "d1").content, track(band, "td").kit);
    const after = { ...before, space: 0.9 };
    const out = writeBeat(band, t, 0, before, after);
    expect(track(out, "td").kit.space).toBe(0.9);
    expect(out.clips).toBe(band.clips);
    expect(controlOf("td", before, after)).toBe("drums:td:kit");
    expect(controlOf("td", before, { ...before, swing: 0.4 })).toBe("drums:td:swing");
    // swing belongs to the rhythm: it is kept with the clip
    expect(clip(writeBeat(band, t, 0, before, { ...before, swing: 0.4 }), "d1").content.swing).toBe(0.4);
    expect(writeBeat(band, t, 0, before, { ...before, swing: 0.4 }).tracks).toBe(band.tracks);
  });

  it("with no clip open the rhythm goes into the track's draft, and nothing lands on the timeline", () => {
    const band = bandSong();
    const open = openOf(band, { track: "td" }, 0)!;
    const before = beatOf(open.content as Groove, track(band, "td").kit);
    const p = BEAT_LIBRARY.find((x) => x.name === "Backbeat")!;
    const out = writeBeat(band, { track: "td" }, 0, before, pickRhythm(before, p));
    expect(out.clips).toBe(band.clips);
    const d = track(out, "td").draft!;
    expect(d.content.name).toBe("Backbeat");
    // written out over the four bars a draft starts with, so each bar can be changed on its own
    expect(contentBars(d.content)).toBe(4);
    expect(d.content.rows.kick).toBe(p.rows.kick.repeat(4));
  });

  it("the open clip's switch: off mutes the clip, a hit written into a muted clip brings it back", () => {
    const band = bandSong();
    const t = { track: "td", clip: "d1" };
    const on = beatOf(clip(band, "d1").content, track(band, "td").kit, true);
    const off = writeBeat(band, t, 0, on, { ...on, on: false });
    expect(clip(off, "d1").mute).toBe(true);
    const muted = beatOf(clip(off, "d1").content, track(off, "td").kit, false);
    expect("mute" in clip(writeBeat(off, t, 0, muted, { ...muted, on: true }), "d1")).toBe(false);
  });
});

describe("a rhythm picked", () => {
  const pick = (song: TimelineSong, id: string, p: BeatPattern) => {
    const t = { track: "td", clip: id };
    const before = beatOf(clip(song, id).content, track(song, "td").kit);
    return writeBeat(song, t, 0, before, pickRhythm(before, p));
  };
  it("into a 3/4 clip, and into a 6/8 clip, is fitted: its steps are always the beats of the clip's bar", () => {
    for (const sig of [SIG34, SIG68]) {
      const song = songOf([drumsTrack("td", "Drums", { lead: true })], { meter: sig, clips: [drumsClip("d1", "td", 0, 4 * sigBeats(sig), { sig })] });
      for (const p of BEAT_LIBRARY) {
        const c = clip(pick(song, "d1", p), "d1");
        expect(c.content.steps / c.content.div, `${p.name} in ${sig.num}/${sig.den}`).toBe(sigBeats(sig));
        expect(c.content.rows.kick.length).toBe(c.content.steps * contentBars(c.content));
      }
    }
  });
  it("never changes how long the clip is on the timeline, and keeps the bars that were open", () => {
    const band = bandSong();
    for (const p of [BEAT_LIBRARY[0], BEAT_LIBRARY.find((x) => (x.bars ?? 1) === 2)!]) {
      const out = pick(band, "d1", p);
      expect(clip(out, "d1")).toMatchObject({ start: 16, len: 16, off: 0 });
      expect(contentBars(clip(out, "d1").content)).toBe(4);
      expect(clip(out, "d1").content.patternId).toBe(p.id);
    }
  });
  it("the sound window's machine has the track's kit and no rhythm", () => {
    const kit = track(bandSong(), "td").kit;
    const b = soundBeat(kit);
    expect(kitOfBeat(b)).toEqual(kit);
    expect(Object.values(b.rows).every((r) => /^0+$/.test(r))).toBe(true);
  });
});

describe("names in the drum windows", () => {
  it("no kit and no rhythm group is named by a model number", () => {
    for (const k of [...KITS, ...BUILTIN_KITS]) expect(hasModelNumber(k.name), k.name).toBe(false);
    for (const g of BEAT_GROUPS) expect(hasModelNumber(g.name), g.name).toBe(false);
    expect(KITS.find((k) => k.id === "808")!.name).toBe("Boom");
    expect(KITS.find((k) => k.id === "909")!.name).toBe("Punch");
    expect(KITS.find((k) => k.id === "707")!.name).toBe("Tight");
    expect(BEAT_GROUPS.find((g) => g.id === "808")!.name).toBe("Trap & electro");
  });
  it("nothing else the two windows list is: rhythms, vibes, effect types, and each drum's sounds as they are shown", () => {
    for (const p of BEAT_LIBRARY) expect(hasModelNumber(p.name), p.name).toBe(false);
    for (const x of [...VIBES, ...VERBS, ...NOISE_BEDS, ...SAMPLERS, ...SAT_TYPES]) expect(hasModelNumber(x.name), x.name).toBe(false);
    for (const id of DRUM_IDS) {
      const shown = RECIPES[id].map((r) => plainName(r.name));
      for (const n of shown) expect(hasModelNumber(n), n).toBe(false);
      // every sound of a drum still has a name of its own
      expect(new Set(shown).size, id).toBe(shown.length);
    }
    expect(plainName("808 Long")).toBe("Boom Long");
    expect(plainName("909")).toBe("Punch");
    expect(plainName("606")).toBe("Thin");
    expect(plainName("Felt")).toBe("Felt");
  });
  it("the ids stay, so a stored song that names a kit, a drum's sound or a rhythm the old way loads as it was", () => {
    expect(KITS.map((k) => k.id)).toEqual(["box", "808", "909", "707", "linn", "volca", "lofi", "mod"]);
    expect(BEAT_LIBRARY.filter((p) => p.group === "808").length).toBeGreaterThan(10);
    const kit = reviveKit({ kit: "808", voices: { hat: "hat.606", snare: "snare.909" } })!;
    expect(kit.kit).toBe("808");
    expect(kit.voices).toEqual({ hat: "hat.606", snare: "snare.909" });
    const stored = JSON.parse(JSON.stringify(songOf([drumsTrack("td", "Drums", { lead: true, kit })], { clips: [drumsClip("d1", "td", 0, 16)] })));
    const back = reviveSong5(stored);
    expect((back.tracks[0] as DrumsTrack).kit.kit).toBe("808");
    expect((back.tracks[0] as DrumsTrack).kit.voices).toEqual({ hat: "hat.606", snare: "snare.909" });
    // and on screen that machine is "Boom"
    expect(draw({ trackId: "td", show: "sound", bpm: 96, beat: soundBeat(kit) })).toContain("<b>Boom</b>");
  });
});

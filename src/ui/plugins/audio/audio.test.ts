// The Vocals plugin drawn as text: the record window (no lane, nothing of the interface's setup, nothing of the
// track's sound), the sound window of a track that records (the whole vocal sound; only its level on a track
// recorded from two inputs), the take browser, the Audio part of the settings; and the plain rules of the record
// window's host (which track it shows, what a recording goes round, a finished recording laid on its track once).
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FX_DEFAULT } from "../../../audio/vocalfx";
import { getTuning } from "../../../guitar/tunings";
import { soundTag, type Recorded } from "../../../song/takes";
import { convertAll } from "../../../timeline/convert";
import type { AudioTrack, TimelineSong } from "../../../timeline/model";
import { audioClip, audioTrack, bandSong, chordsClip, chordsContent, chordsTrack, songOf, take } from "../../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../../app5";
import type { EngineApi } from "../../audio/useEngine";
import { AudioPart, SettingsPanel } from "../../components/SettingsPanel";
import { DEFAULT_STATE } from "../../state";
import { takesHeard } from "../../timeline/Host";
import { V4View } from "../../windows/ClipLens";
import { PLUGINS } from "../registry";
import { recordSong, recordedLine, roundLabel, shownTrack } from "./RecordHost";
import { RecordWindow, type RecordWindowProps } from "./RecordWindow";
import { TakeBrowser, takeEdits } from "./TakeBrowser";
import { VocalBox, VocalSound, fxOf, isStereo, staleTakes } from "./VocalSound";

const no = () => {};
const KEY = { tonic: "C", scaleId: "ionian" };
/** the app with a song in it; every change it is asked for is noted in `log` */
function appWith(song: TimelineSong, log: string[] = []): Ctx5 {
  let state: App5State = { ...convertAll(DEFAULT_STATE, 1), song, key: KEY };
  const app: Ctx5 = {
    get state() { return state; },
    peek: () => state,
    set: (fn) => { state = fn(state); },
    edit: (label, fn) => {
      const next = fn(state.song);
      if (next === state.song) return;
      log.push(label);
      state = { ...state, song: next };
    },
    editKeyed: no, setSession: no, undo: no, redo: no, canUndo: false, canRedo: false, tuning: getTuning("standard"),
    toast: (msg) => void log.push(`says: ${msg}`),
    idea: null, dirty: false, opened: 0, saveIdea: () => "nothing", openIdea: no, newIdea: no, renameIdea: no, deleteIdea: no, importIdeas: () => 0, cloud: "local", syncNow: no,
    recordingTo: null, setRecordingTo: no,
  };
  return app;
}
const within = (app: Ctx5, el: ReactNode) => renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, el));

/** the engine as the windows read it: the interface found and open, nothing going */
const engine = (o: Partial<EngineApi> = {}): EngineApi => ({
  desktop: true,
  hosts: [{ name: "ASIO", error: null, devices: [{ name: "Test Interface", input: { channels: 4, min_rate: 44100, max_rate: 96000 }, output: { channels: 2, min_rate: 44100, max_rate: 96000 }, default_rate: 48000 }] }],
  devices: [{ host: "ASIO", name: "Test Interface", channels: 4 }],
  chosen: { host: "ASIO", name: "Test Interface", channels: 4 },
  opened: { host: "ASIO", device: "Test Interface", rate: 48000, inputs: 4, outputs: 2, format: "f32", min_buffer: 32, max_buffer: 256 },
  error: null, phase: "idle", pass: 0, marks: new Set(), flash: 0, ready: true, monitor: false,
  record: no, rehearse: no, stop: no, toggle: no, start: no, mark: no, markNow: no, at: () => null, level: () => 0, running: () => null, relist: no,
  ...o,
});

// ── the record window ───────────────────────────────────────

const recordWindow = (o: Partial<RecordWindowProps> = {}, children?: ReactNode) =>
  renderToStaticMarkup(createElement(RecordWindow, {
    track: { id: "tv", name: "Lead vocal", input: 1 }, inputs: 2, engine: engine(), studio: {}, setStudio: no, round: "bars 3–6", open: true, onInput: no, onSetup: no, ...o,
  }, children));

describe("the record window", () => {
  it("has Record and Rehearse, the count-in and the click, what a recording goes round, and how you hear yourself", () => {
    const html = recordWindow();
    expect(html).toContain('aria-label="Record"');
    expect(html).toContain('aria-label="Rehearse: sing over the loop without recording"');
    expect(html).toContain("Count-in");
    expect(html).toContain("Click");
    expect(html).toContain("↻ bars 3–6");
    expect(html).toContain('aria-label="Hearing yourself"');
    expect(html).toMatch(/<button role="radio" aria-checked="true" class="on"[^>]*>Direct<\/button>/);
    // the headphone mix
    expect(html).toContain(">Song <input");
    // ★ is in its place from the start, hidden until a recording runs, so nothing shifts
    expect(html).toMatch(/class="vc-star" style="visibility:hidden" disabled=""/);
  });

  it("names the track, and offers its input with a meter of that input", () => {
    const html = recordWindow();
    expect(html).toContain("Lead vocal");
    expect(html).toContain('aria-label="Input of Lead vocal"');
    expect(html).toMatch(/<option value="1" selected="">2<\/option>/);
    expect(html.split('class="rw-meter"').length - 1).toBe(1);
    // an input the interface turned out not to have is still in the list (it is the track's saved choice)
    expect(recordWindow({ track: { id: "tv", name: "Lead vocal", input: 5 } })).toMatch(/<option value="5" selected="">6<\/option>/);
  });

  it("has no lane of its own, and no clip tools", () => {
    for (const html of [recordWindow(), recordWindow({ engine: engine({ phase: "recording", pass: 2 }) })]) {
      expect(html).not.toContain("tl-scroll");
      expect(html).not.toContain("tl-lane");
      expect(html).not.toContain("tl-tools");
      expect(html).not.toContain("tl-takes");
    }
  });

  it("has nothing of the interface's setup (that is in the settings, under Audio), nor of the track's sound (its FX button)", () => {
    const html = recordWindow();
    for (const gone of ['aria-label="Record from"', "Buffer", "Timing nudge", "48V on", "Driver&#x27;s setting", "vc-meters", "Vocal sound", "Preset…", "Apply sound", "EQ"]) expect(html, gone).not.toContain(gone);
  });

  it("while recording: ■, the pass being sung in the row of passes, and ★ on the kept ones", () => {
    const html = recordWindow({ engine: engine({ phase: "recording", pass: 3, marks: new Set([2]) }) });
    expect(html).toContain('aria-label="Stop recording"');
    expect(html).toContain('aria-label="Passes: tap to keep"');
    expect([...html.matchAll(/aria-label="Pass (\d)[^"]*"/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    expect(html).toMatch(/class="vc-pass on" aria-pressed="true" aria-label="Pass 2">★2/);
    expect(html).toContain('aria-label="Pass 3, being sung"');
    expect(html).toMatch(/class="vc-star" aria-pressed="false" aria-label="Keep this pass \(K\)"/);
    // the count-in and the input cannot be changed under a recording
    expect(html).toMatch(/aria-label="Input of Lead vocal" disabled=""/);
  });

  it("says what is being waited for, and what is wrong with a way to the Audio settings", () => {
    expect(recordWindow({ engine: engine({ phase: "preparing" }) })).toContain("Preparing… ");
    expect(recordWindow({ engine: engine({ phase: "saving" }) })).toContain("Saving… ");
    const none = recordWindow({ engine: engine({ devices: [], chosen: undefined, opened: null }) });
    expect(none).toContain("No interface found");
    expect(none).toContain("Audio setup…");
    const failed = recordWindow({ engine: engine({ opened: null, error: "The audio driver did not answer", ready: false }) });
    expect(failed).toContain("The audio driver did not answer");
    expect(failed).toMatch(/class="rec-btn" aria-label="Record"[^>]*disabled=""/);
    expect(recordWindow()).not.toContain("Audio setup…");
  });

  it("warns when you would hear yourself twice", () => {
    expect(recordWindow({ engine: engine({ monitor: true }), studio: { checks: { direct: true } } })).toContain("Direct Monitor is on too: you hear yourself twice");
    expect(recordWindow({ engine: engine({ monitor: true }), studio: {} })).not.toContain("you hear yourself twice");
    expect(recordWindow({ engine: engine({ monitor: false }), studio: { checks: { direct: true } } })).not.toContain("you hear yourself twice");
  });

  it("with no track that records it says how to add one; in a browser it says where recording is", () => {
    const none = recordWindow({ track: null });
    expect(none).toContain("Add a Vocals track to record on");
    expect(none).not.toContain("rec-btn");
    const web = recordWindow({ engine: engine({ desktop: false, hosts: null, devices: [], chosen: undefined, opened: null }) }, createElement("div", { className: "the-takes" }));
    expect(web).toContain("Recording: in the desktop app.");
    expect(web).not.toContain("rec-btn");
    expect(web).not.toContain("Monitor");
    // (the takes already in the idea are still listed there)
    expect(web).toContain("the-takes");
  });

  it("draws the take browser it is handed, right under Record", () => {
    const html = recordWindow({}, createElement("div", { className: "the-takes" }));
    expect(html.indexOf("the-takes")).toBeGreaterThan(html.indexOf("rec-btn"));
    expect(html.indexOf("the-takes")).toBeLessThan(html.indexOf("rw-hear"));
  });
});

// ── the take browser ────────────────────────────────────────

/** an older recording of two passes, and a newer one of three: the second ★, the last stopped early */
const a1 = take("a1", 5, 8, { group: "ga", n: 1 });
const a2 = take("a2", 5, 8, { group: "ga", n: 2 });
const b1 = take("b1", 65, 8, { group: "gb", n: 1 });
const b2 = take("b2", 65, 8, { group: "gb", n: 2, keep: true });
const b3 = take("b3", 9, 8, { group: "gb", n: 3, short: true });
const sung = (o: Partial<AudioTrack> = {}) => audioTrack("tv", "vocals", "Lead vocal", [a1, a2, b1, b2, b3], o);
const sungSong = (o: Partial<AudioTrack> = {}) => songOf([chordsTrack("tc"), sung(o)], { clips: [chordsClip("c1", "tc", 0, 16, { content: chordsContent(4) }), audioClip("x1", "tv", b2, 8)] });

describe("the take browser", () => {
  const browser = (o: Partial<Parameters<typeof TakeBrowser>[0]> = {}) => {
    const song = sungSong();
    const app = appWith(song);
    return renderToStaticMarkup(createElement(TakeBrowser, {
      track: song.tracks[1] as AudioTrack, clips: song.clips.filter((c) => c.kind === "audio"), shelf: undefined, picked: [], canHear: true, running: false, app: () => app, stopSong: no, ...o,
    }));
  };
  it("is grouped by recording, the newest first, each with its takes and a way to remove it whole", () => {
    const html = browser();
    expect([...html.matchAll(/aria-label="Recording (\d+)"/g)].map((m) => m[1])).toEqual(["2", "1"]);
    expect([...html.matchAll(/data-take="([^"]+)"/g)].map((m) => m[1])).toEqual(["b1", "b2", "a1", "a2"]);
    expect(html.split('aria-label="Remove this recording"').length - 1).toBe(2);
    // All / ★, the short takes, hear, ★, Use and delete on every take
    expect(html).toContain('aria-label="Which takes"');
    expect(html).toContain("Short takes");
    for (const what of ["Hear take 1 alone", "Keep take 1 ★", "Use take 1", "Delete take 1"]) expect(html).toContain(`aria-label="${what}"`);
  });
  it("selects the take of the clip selected on the lane, and marks the take that plays", () => {
    const html = browser({ picked: ["c1", "x1"] });
    expect(html).toMatch(/data-take="b2" role="option" aria-selected="true" class="tb-take sel used"/);
  });
  it("lists the removed recordings under the takes, each to be used on this track", () => {
    const html = browser({ shelf: [{ track: "gone", name: "Old vocal", kind: "vocals", takes: [take("s1", 4, null, { group: "gs" })], at: 1, saves: 0 }] });
    expect(html).toContain('aria-label="Removed recordings"');
    expect(html).toContain('aria-label="Use take 1 of Old vocal on Lead vocal"');
    expect(html).toContain('aria-label="Empty the removed recordings"');
  });
  it("every change is one step of the one undo, and no change takes a take out of the song by accident", () => {
    const log: string[] = [];
    const app = appWith(sungSong(), log);
    const does = takeEdits(() => app, () => "tv");
    const takes = () => (app.peek().song.tracks[1] as AudioTrack).takes.map((k) => k.id);
    does.keep(a1, true);
    does.use(a1);
    expect(log).toEqual(["Keep take", "Use take"]);
    expect(takes()).toEqual(["a1", "a2", "b1", "b2", "b3"]);
    does.drop(a2);
    expect(log.slice(2)).toEqual(["Delete take", "says: Take 2 deleted"]);
    expect(takes()).toEqual(["a1", "b1", "b2", "b3"]);
    does.remove("gb");
    expect(log.slice(4)).toEqual(["Remove recording", "says: Recording removed"]);
    expect(takes()).toEqual(["a1"]);
    // (nothing to empty: nothing is said)
    does.empty();
    expect(log).toHaveLength(6);
  });
});

// ── the sound window of a track that records ────────────────

describe("the sound window of a track that records", () => {
  const box = (track: AudioTrack) => within(appWith(songOf([track])), createElement(VocalBox, { track, bpm: 96 }));
  it("is the registry's sound window for Vocals and for Blank, with no composer of its own (the one record window)", () => {
    expect(PLUGINS.vocals.sound).toBe(VocalSound);
    expect(PLUGINS.audio.sound).toBe(VocalSound);
    expect(PLUGINS.vocals.compose).toBeNull();
    expect(PLUGINS.audio.compose).toBeNull();
  });
  it("shows the whole vocal sound: On, a preset, Colour, the EQ, Dynamics, Width, Echo, Reverb, More", () => {
    const html = box(audioTrack("tv"));
    expect(html).toContain("Vocal sound");
    expect(html).toMatch(/<input type="checkbox" checked=""\/> On/);
    expect(html).toContain("Preset…");
    for (const g of ["Colour", "EQ", "Dynamics", "Width", "Echo", "Reverb"]) expect(html).toContain(`role="group" aria-label="${g}"`);
    expect(html).toContain(">More</button>");
    expect(html).toContain("<svg");
    // the LIMIT lamp is there, dark until the engine says the level is held back
    expect(html).toMatch(/class="vc-limit" hidden=""/);
    // (nothing of recording in it)
    expect(html).not.toContain("rec-btn");
    expect(html).not.toContain("tb-take");
  });
  it("a blank track starts with the sound off", () => {
    expect(box(audioTrack("ta", "audio"))).toMatch(/<input type="checkbox"\/> On/);
  });
  it("of a track recorded from two inputs shows only Output level", () => {
    const html = box(audioTrack("ta", "audio", "Keys", [], { input: { ch: 0, pair: true } }));
    expect([...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual(["Output"]);
    expect(html).toContain('aria-label="Output: Level"');
    expect(html.split('type="range"').length - 1).toBe(1);
    for (const gone of ["Preset…", "Colour", "Reverb", "<svg", "> On", "LIMIT", ">More<"]) expect(html, gone).not.toContain(gone);
    expect(isStereo({ input: { ch: 0, pair: true } })).toBe(true);
    expect(isStereo({ input: { ch: 1 } })).toBe(false);
    expect(isStereo({})).toBe(false);
  });
  it("lights Apply sound when takes were made with an older sound, and only then", () => {
    const fresh = [take("k1", 5, 0, { sound: soundTag(FX_DEFAULT) })];
    expect(box(audioTrack("tv", "vocals", "Lead vocal", fresh))).not.toContain("Apply sound");
    // a knob turned after recording
    const turned = audioTrack("tv", "vocals", "Lead vocal", fresh, { fx: { ...FX_DEFAULT, verb: 0.5 } });
    expect(box(turned)).toContain("↻ Apply sound");
    expect(staleTakes(turned, fxOf(turned))).toBe(true);
    expect(box(audioTrack("tv"))).not.toContain("Apply sound");
  });
});

// ── Settings → Audio ────────────────────────────────────────

describe("the Audio part of the settings", () => {
  const app = appWith(bandSong());
  const part = (e: EngineApi = engine()) => within(app, createElement(V4View, null, createElement(AudioPart, { engine: e, setNudge: no, track: { name: "Lead vocal", input: 1 } })));
  it("has the interface and its buffer, a meter for every input, the headphone mix, the four reminders and the timing nudge", () => {
    const html = part();
    expect(html).toContain('aria-label="Record from"');
    expect(html).toContain("Test Interface (ASIO)");
    expect(html).toContain("4 in · 2 out · 48 kHz");
    expect(html).toContain("Buffer");
    // (only the sizes the driver allows are offered)
    expect([...html.matchAll(/<option value="(\d+)"/g)].map((m) => m[1])).toEqual(["32", "48", "64", "96", "128", "192", "256"]);
    expect([...html.matchAll(/data-ch="(\d)"/g)].map((m) => m[1])).toEqual(["0", "1", "2", "3"]);
    expect(html).toMatch(/class="vm mine" data-ch="1"/);
    expect(html).toContain("Lead vocal records Input 2");
    expect(html).toContain("Headphone mix");
    for (const c of ["48V on", "Air on", "INST off", "Direct Monitor on"]) expect(html).toContain(c);
    expect(html).toContain("Timing nudge");
    expect(html).toContain("Look again");
    expect(html).toContain("Everything the computer sees");
  });
  it("says so while it is still looking, when there is no interface, and when the driver gave an error", () => {
    expect(part(engine({ hosts: null, devices: [], chosen: undefined, opened: null }))).toContain("Looking…");
    expect(part(engine({ hosts: [], devices: [], chosen: undefined, opened: null }))).toContain("No interface found. Plug it in");
    expect(part(engine({ opened: null, error: "The audio driver did not answer" }))).toContain("The audio driver did not answer");
    // closed only because the app is sounding
    expect(part(engine({ opened: null }))).toContain("Closed while the app plays");
  });
  it("cannot change the interface or its buffer under a recording", () => {
    const html = part(engine({ phase: "recording" }));
    expect(html).toMatch(/aria-label="Record from" disabled=""/);
    expect(html).toMatch(/<select disabled=""><option value="" selected="">Driver/);
  });
  it("is one of two parts of the settings in the track view; the old view's sheet is as it was", () => {
    const audio = { engine: engine(), setNudge: no, track: null };
    const guitar = within(app, createElement(V4View, null, createElement(SettingsPanel, { onClose: no, audio, part: "guitar" })));
    expect(guitar).toContain('aria-label="Which settings"');
    expect(guitar).toContain("Avoid barre chords");
    expect(guitar).not.toContain("Timing nudge");
    const second = within(app, createElement(V4View, null, createElement(SettingsPanel, { onClose: no, audio, part: "audio" })));
    expect(second).toContain("Timing nudge");
    expect(second).not.toContain("Avoid barre chords");
    const old = within(app, createElement(V4View, null, createElement(SettingsPanel, { onClose: no })));
    expect(old).toContain("Guitar setup");
    expect(old).not.toContain('aria-label="Which settings"');
    expect(old).toContain("Avoid barre chords");
  });
});

// ── the plain rules of the record window's host ─────────────

describe("which track the engine is on, and the record window shows", () => {
  const tracks = [audioTrack("v1"), audioTrack("v2", "vocals", "Vocal 2"), audioTrack("a1", "audio")];
  it("the one being recorded on, else the armed one, else the selected one that records, else the last, else the top one", () => {
    expect(shownTrack(tracks, { recording: "v2", armed: "a1", selected: "v1" })).toBe("v2");
    expect(shownTrack(tracks, { armed: "a1", selected: "v1" })).toBe("a1");
    expect(shownTrack(tracks, { selected: "v2", last: "a1" })).toBe("v2");
    // (a selected track that does not record is not it)
    expect(shownTrack(tracks, { selected: "t-chords", last: "a1" })).toBe("a1");
    expect(shownTrack(tracks, {})).toBe("v1");
    expect(shownTrack([], { armed: "v1" })).toBeNull();
  });
});

describe("the song's side of a recording", () => {
  const recorded = (dry: string, frames: number): Recorded => ({ dry, wet: `${dry}-wet`, rate: 48000, frames, offset: 0, count_in: 0, loop_frames: 480000, dropped: 0, padded: 0, note: null });
  const setUp = () => {
    const log: string[] = [];
    // 96 bpm, 4/4: sixteen beats (four bars) are ten seconds, 480,000 frames
    const song = songOf([chordsTrack("tc"), audioTrack("tv")], { clips: [chordsClip("c1", "tc", 0, 32, { content: chordsContent(8) })] });
    const app = appWith(song, log);
    app.set((s) => ({ ...s, session: { ...s.session, cursor: 0, loop: { on: true, regions: [{ from: 16, to: 32 }] } } }));
    const ctx = { voicingsOf: () => [], buffer: () => undefined };
    return { log, app, does: recordSong({ app: () => app, ctx: () => ctx }) };
  };
  it("goes round the loop: the plan says the bars, their beats for the click, and where they lie on the timeline", () => {
    const { app, does } = setUp();
    const plan = does.plan()!;
    expect(plan.label).toBe("bars 5–8");
    expect(roundLabel(app.peek().song, app.peek().session)).toBe("bars 5–8");
    expect(plan.beats).toBe(16);
    expect(plan.bars).toEqual([{ beats: 4 }, { beats: 4 }, { beats: 4 }, { beats: 4 }]);
    expect(does.spanOf(plan)).toEqual({ from: 16, to: 32 });
    // the same plan while nothing it reads has changed
    expect(does.plan()).toBe(plan);
  });
  it("a finished recording is cut into takes and laid on its track as one undo step, and said in a line", () => {
    const { log, app, does } = setUp();
    const plan = does.plan()!;
    // two passes and a bit, the second kept
    does.onRecorded(recorded("C:/rec/v.wav", 480000 * 2 + 48000), { kept: [2], sound: "#x", plan, track: "tv" });
    const tv = app.peek().song.tracks.find((t) => t.id === "tv") as AudioTrack;
    expect(tv.takes.map((k) => [k.n, !!k.keep, k.at])).toEqual([[1, false, 16], [2, true, 16], [3, false, 16]]);
    const clips = app.peek().song.clips.filter((c) => c.kind === "audio");
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ track: "tv", start: 16, take: tv.takes[1].id });
    expect(log).toEqual(["Record", "says: 2 takes recorded · ★ 1"]);
  });
  it("a recording handed over for a track that went meanwhile brings the track back with its takes: never lost", () => {
    const { app, does } = setUp();
    const plan = does.plan()!;
    app.edit("Remove track", (s) => ({ ...s, tracks: s.tracks.filter((t) => t.id !== "tv") }));
    does.onRecorded(recorded("C:/rec/v.wav", 480000 * 2), { kept: [], sound: "", plan, track: "tv", lead: "The interface reset; the recording is kept: " });
    const tv = app.peek().song.tracks.find((t) => t.id === "tv") as AudioTrack | undefined;
    expect(tv?.takes.length).toBe(2);
  });
  it("says what was recorded as the old page said it", () => {
    const r = recorded("x", 1);
    expect(recordedLine([], r)).toBe("Stopped before the first take");
    expect(recordedLine([a1, a2], r)).toBe("2 takes recorded");
    expect(recordedLine([b1, b2, b3], r)).toBe("2 takes recorded · ★ 1");
    expect(recordedLine([a1], { ...r, padded: 4800 }, "The interface reset; the recording is kept: ")).toBe("The interface reset; the recording is kept: 1 take recorded · 100 ms lost and filled with silence, timing kept: try a bigger buffer");
  });
  it("the timing nudge is a setting, and moves every take of the song with it", () => {
    const log: string[] = [];
    const app = appWith(songOf([audioTrack("tv", "vocals", "Lead vocal", [take("k1", 5, 0, { start: 1000, nudge: 0 })])]), log);
    recordSong({ app: () => app, ctx: () => ({ voicingsOf: () => [], buffer: () => undefined }) }).setNudge(10);
    expect(app.peek().studio?.nudge).toBe(10);
    // 10 ms at 48 kHz is 480 frames
    expect((app.peek().song.tracks[0] as AudioTrack).takes[0].start).toBe(1480);
    // (not an undo step)
    expect(log).toEqual([]);
  });
});

describe("the takes a song plays, as they are read from disk", () => {
  const song = sungSong();
  it("those on the lanes; for a bypassed track also the files as they were sung", () => {
    expect(takesHeard(song, new Set(), false).map((t) => t.wet)).toEqual(["b2-wet.wav"]);
    expect(takesHeard(song, new Set(), true)).toEqual([]);
    expect(takesHeard(song, new Set(["tv"]), true).map((t) => t.wet)).toEqual(["b2-dry.wav"]);
    // (a bypass on another track asks for nothing of this one)
    expect(takesHeard(song, new Set(["tc"]), true)).toEqual([]);
  });
});

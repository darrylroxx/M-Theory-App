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
import { peaksFrom, takesHeard } from "../../timeline/Host";
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
  record: no, rehearse: no, stop: no, toggle: no, start: no, mark: no, markNow: no, at: () => null, since: () => null, level: () => 0, running: () => null, relist: no, once: false, again: false,
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
    // an input the interface turned out not to have is still in the list (it is the track's saved choice), and says so
    expect(recordWindow({ track: { id: "tv", name: "Lead vocal", input: 5 } })).toMatch(/<option value="5" selected="">6 \(not there\)<\/option>/);
  });

  it("offers every input of the interface, and every pair of neighbours; a pair has a meter for each side", () => {
    const html = recordWindow({ inputs: 8, track: { id: "ta", name: "Guitars", input: 2, pair: true } });
    const list = html.slice(html.indexOf('aria-label="Input of Guitars"'), html.indexOf("</select>"));
    expect([...list.matchAll(/<option value="(\d+\+?)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}=${m[2]}`)).toEqual([
      "0=1", "1=2", "2=3", "3=4", "4=5", "5=6", "6=7", "7=8", "0+=1+2", "2+=3+4", "4+=5+6", "6+=7+8",
    ]);
    expect(html).toContain('<optgroup label="Stereo pairs">');
    expect(html).toMatch(/<option value="2\+" selected="">3\+4<\/option>/);
    // the levels of inputs 3 and 4, the left over the right
    expect([...html.matchAll(/class="rw-meter" data-ch="(\d)"/g)].map((m) => m[1])).toEqual(["2", "3"]);
    // a pair the interface does not have stays the track's choice, marked
    expect(recordWindow({ inputs: 2, track: { id: "ta", name: "Guitars", input: 4, pair: true } })).toMatch(/<option value="4\+" selected="">5\+6 \(not there\)<\/option>/);
  });

  it("with the loop off it says where the song is played from, once; while that runs there are no passes to keep", () => {
    const idle = recordWindow({ round: "from bar 5", once: true });
    expect(idle).toContain("→ from bar 5");
    expect(idle).not.toContain("↻");
    expect(idle).toContain("the song plays once, and the recording goes on until Stop");
    const running = recordWindow({ once: true, engine: engine({ phase: "recording", once: true, pass: 0 }) });
    expect(running).toContain('aria-label="Stop recording"');
    expect(running).not.toContain('aria-label="Passes: tap to keep"');
    expect(running).toMatch(/class="vc-star" style="visibility:hidden"/);
    // (what runs counts, not what the next recording would do: the loop was switched on meanwhile)
    expect(recordWindow({ once: false, engine: engine({ phase: "recording", once: true, pass: 0 }) })).not.toContain('aria-label="Passes: tap to keep"');
    expect(recordWindow({ once: true, engine: engine({ phase: "recording", once: false, pass: 2 }) })).toContain('aria-label="Passes: tap to keep"');
  });

  it("a song kept from the last recording starts at once: nothing is said to be prepared", () => {
    expect(recordWindow({ engine: engine({ phase: "preparing", again: true }) })).not.toContain("Preparing…");
    expect(recordWindow({ engine: engine({ phase: "preparing", again: false }) })).toContain("Preparing… ");
    // (Saving is said either way)
    expect(recordWindow({ engine: engine({ phase: "saving", again: true }) })).toContain("Saving… ");
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

  it("with no track that records it says how to add one", () => {
    const none = recordWindow({ track: null });
    expect(none).toContain("Add a Vocals or a Blank track to record on");
    expect(none).not.toContain("rec-btn");
  });

  it("in a browser: Record, the microphone's level, one line about timing with the nudge in it, and nothing of the interface", () => {
    const web = engine({ desktop: false, hosts: null, devices: [], chosen: undefined, opened: null });
    const html = recordWindow({ engine: web, studio: { nudge: 12 }, round: "from bar 1", once: true }, createElement("div", { className: "the-takes" }));
    expect(html).toContain('class="rec-btn" aria-label="Record"');
    expect(html).toContain("Record the microphone while the song plays once");
    expect(html).toContain("→ from bar 1");
    expect(html).toContain("In a browser a take lands close to in time, not exact: set it with the timing nudge");
    expect(html).toMatch(/aria-label="Timing nudge, in milliseconds"[^>]*value="12"/);
    expect(html.split('class="rw-meter"').length - 1).toBe(1);
    // nothing that only the desktop app's engine has
    for (const gone of ["Rehearse", "Count-in", "Monitor", "Audio setup…", "Recording: in the desktop app"]) expect(html, gone).not.toContain(gone);
    expect(html).toContain("the-takes");
    // round a loop it says so, and keeps passes as the desktop app does
    expect(recordWindow({ engine: web, round: "bars 1–2" })).toContain("take after take, while the loop goes round");
    expect(recordWindow({ engine: { ...web, phase: "recording", pass: 2 } })).toContain('aria-label="Passes: tap to keep"');
    // a browser that cannot record says so, and offers no button
    const cannot = recordWindow({ engine: { ...web, ready: false } }, createElement("div", { className: "the-takes" }));
    expect(cannot).toContain("This browser cannot record here");
    expect(cannot).not.toContain("rec-btn");
    expect(cannot).toContain("the-takes");
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
  it("has the switch for the app's own sound (a whole buffer at a time), on unless it was turned off on this computer", () => {
    const html = part();
    expect(html).toContain("The app&#x27;s own sound");
    expect(html).toMatch(/<input type="checkbox" checked=""[^>]*\/?> Worked out a whole buffer at a time/);
    // (nothing changed yet: it does not say when a change would be heard)
    expect(html).not.toContain("the next time the app is opened");
    // a browser's Audio part has it too
    expect(part(engine({ desktop: false, hosts: null, devices: [], chosen: undefined, opened: null }))).toContain("Worked out a whole buffer at a time");
  });
  it("marks both inputs of a pair as the track's, and says so", () => {
    const html = within(app, createElement(V4View, null, createElement(AudioPart, { engine: engine(), setNudge: no, track: { name: "Guitars", input: 2, pair: true } })));
    expect([...html.matchAll(/class="vm mine" data-ch="(\d)"/g)].map((m) => m[1])).toEqual(["2", "3"]);
    expect(html).toContain("Guitars records Inputs 3 and 4, in stereo");
  });
  it("in a browser it says what is recorded there, and has the timing nudge", () => {
    const html = part(engine({ desktop: false, hosts: null, devices: [], chosen: undefined, opened: null }));
    expect(html).toContain("a track records the microphone the browser offers");
    expect(html).toContain("Timing nudge");
    for (const gone of ['aria-label="Record from"', "Buffer", "48V on", "Headphone mix"]) expect(html, gone).not.toContain(gone);
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
  it("with the loop off the plan plays the song once, from the cursor's bar, and reaches eight bars past the song's end", () => {
    const { app, does } = setUp();
    app.set((s) => ({ ...s, session: { ...s.session, cursor: 9, loop: { on: false, regions: [{ from: 16, to: 32 }] } } }));
    const plan = does.plan()!;
    expect(plan.once).toBe(true);
    expect(roundLabel(app.peek().song, app.peek().session)).toBe("from bar 3");
    // from bar 3 (beat 8) to the end of the eight-bar song (beat 32) and eight bars more
    expect(does.spanOf(plan)).toEqual({ from: 8, to: 64 });
    expect(plan.beats).toBe(56);
    expect(plan.bars).toHaveLength(14);
    // what is played is the song from there to its end, straight through (nothing of it comes round)
    expect(plan.items.reduce((a, x) => a + x.beats, 0)).toBe(24);
    // round the loop the plan says nothing of once, as before
    app.set((s) => ({ ...s, session: { ...s.session, loop: { on: true, regions: [{ from: 16, to: 32 }] } } }));
    expect("once" in does.plan()!).toBe(false);
  });
  it("a once-through recording is one take from the cursor's bar; from a pair of inputs, a stereo one", () => {
    const { app, does } = setUp();
    app.set((s) => ({ ...s, session: { ...s.session, cursor: 8, loop: null } }));
    const plan = does.plan()!;
    does.onRecorded({ ...recorded("C:/rec/g.wav", 48000 * 20), loop_frames: 0, channels: 2 }, { kept: [], sound: "", plan, track: "tv" });
    const tv = app.peek().song.tracks.find((t) => t.id === "tv") as AudioTrack;
    expect(tv.takes.map((k) => [k.n, k.at, k.frames, k.channels])).toEqual([[1, 8, 48000 * 20, 2]]);
    expect(app.peek().song.clips.filter((c) => c.kind === "audio").map((c) => [c.start, c.frames])).toEqual([[8, 48000 * 20]]);
  });
  it("the song under a recording says when it can be played again: the same after a take on the armed track, another after a change elsewhere", () => {
    const { app, does } = setUp();
    app.set((s) => ({ ...s, session: { ...s.session, cursor: 8, loop: null } }));
    const first = does.plan()!;
    const key = first.backing!("tv");
    expect(first.backing!("tv")).toBe(key);
    // a take recorded onto the armed track, running on past the song's end: the song changed, the plan is another, what is sung over is not
    does.onRecorded({ ...recorded("C:/rec/g.wav", 48000 * 40), loop_frames: 0 }, { kept: [], sound: "", plan: first, track: "tv" });
    const second = does.plan()!;
    expect(second).not.toBe(first);
    expect(second.backing!("tv")).toBe(key);
    // (a rehearsal hears that take too: for it the song is another)
    expect(second.backing!(null)).not.toBe(first.backing!(null));
    // another track changed: sung over another sound
    app.edit("Tempo", (s) => ({ ...s, bpm: s.bpm + 1 }));
    expect(does.plan()!.backing!("tv")).not.toBe(key);
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

describe("how loud a take is along its length, for its picture on the lane", () => {
  /** a decoded take, stood in for: a second at 100 frames a second, the left side loud in its first half, the right quiet in its second */
  const buffer = (channels: number) => {
    const data = [new Float32Array(100), new Float32Array(100)];
    for (let i = 0; i < 50; i++) data[0][i] = i % 2 ? 0.8 : -0.8;
    for (let i = 50; i < 100; i++) data[1][i] = 0.2;
    return { duration: 1, length: 100, numberOfChannels: channels, getChannelData: (ch: number) => data[ch] } as unknown as AudioBuffer;
  };
  it("one picture for all its channels together, or each side on its own, to one scale", () => {
    const b = buffer(2);
    const all = peaksFrom(b);
    const left = peaksFrom(b, 0);
    const right = peaksFrom(b, 1);
    expect(all).toHaveLength(40);
    // the left side: loud, then nothing; the right: nothing, then a quarter as loud (it is not drawn as loud as the left)
    expect([left[0], left[39]]).toEqual([1, 0]);
    expect(right[0]).toBe(0);
    expect(right[39]).toBeCloseTo(0.25);
    expect([all[0], all[39]]).toEqual([1, right[39]]);
    // worked out once for a take
    expect(peaksFrom(b, 0)).toBe(left);
    expect(peaksFrom(b)).toBe(all);
  });
  it("a take with one channel has one picture, whichever side is asked for", () => {
    const b = buffer(1);
    expect([...peaksFrom(b, 1)]).toEqual([...peaksFrom(b, 0)]);
    expect([...peaksFrom(b, 0)]).toEqual([...peaksFrom(b)]);
  });
});

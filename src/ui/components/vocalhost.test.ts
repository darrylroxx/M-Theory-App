// The old Vocals page as the body of the track view's record window (its host mode), drawn as text: it keeps the
// interface and the room, and gives up the song.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FX_DEFAULT } from "../../audio/vocalfx";
import { getTuning } from "../../guitar/tunings";
import { convertAll } from "../../timeline/convert";
import { bandSong } from "../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../app5";
import { AppCtx, DEFAULT_STATE, type Ctx } from "../state";
import { V4View } from "../windows/ClipLens";
import { VocalsPage, type RecordPlan, type VocalHost } from "./VocalsPage";

const key = { tonic: "C", scaleId: "ionian" };
const state: App5State = { ...convertAll(DEFAULT_STATE, 1), song: bandSong(), key };
const app: Ctx5 = {
  state, peek: () => state, set: () => {}, edit: () => {}, editKeyed: () => {}, setSession: () => {}, undo: () => {}, redo: () => {}, canUndo: false, canRedo: false,
  tuning: getTuning("standard"), toast: () => {}, idea: null, dirty: false, opened: 0, saveIdea: () => "nothing", openIdea: () => {}, newIdea: () => {}, renameIdea: () => {},
  deleteIdea: () => {}, importIdeas: () => 0, cloud: "local", syncNow: () => {}, recordingTo: null, setRecordingTo: () => {},
};
const plan: RecordPlan = { items: [], at: { block: "", bar: 0 }, beats: 16, beatsPerBar: 4, bpm: 96, pattern: "ring", beat: null, label: "bars 3–6", bars: [4, 4, 4, 4].map((beats, bar) => ({ block: "", bar, letter: "", beats })) };
const host = (o: Partial<VocalHost> = {}): VocalHost => ({
  track: { id: "tv", name: "Lead vocal", input: 1, fx: FX_DEFAULT, stale: false },
  setFx: () => {}, setInput: () => {}, bpm: 96, plan: () => plan, onRecorded: () => {}, setNudge: () => {}, applySound: () => {},
  takes: createElement("div", { className: "from-the-host" }, "the host's take list"),
  control: { current: null }, focused: true, ...o,
});
const props = { active: true, recordPlan: () => null, onRecording: () => {}, recording: false, playing: false, getWhere: () => null, onAlone: () => {} };
const page = (h?: VocalHost) => renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(V4View, null, createElement(VocalsPage, { ...props, ...(h ? { host: h } : {}) }))));
/** the same in the desktop app (the page asks whether it is there by looking for the app's bridge) */
const onDesktop = (h?: VocalHost) => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  try {
    return page(h);
  } finally {
    vi.unstubAllGlobals();
  }
};
afterEach(() => vi.unstubAllGlobals());

describe("the Vocals page with a host", () => {
  it("names the host's track and its input, and offers no track tabs of its own", () => {
    for (const html of [page(host()), onDesktop(host())]) {
      expect(html).toContain("Lead vocal");
      // (the host counts inputs from 0, the page says them from 1)
      expect(html).toContain("Input 2");
      expect(html).not.toContain("clip-tracks");
      expect(html).not.toContain('aria-label="Add a vocal track"');
    }
    expect(onDesktop(host({ track: { id: "tv", name: "Lead vocal", input: 0, fx: FX_DEFAULT, stale: false } }))).toMatch(/class="vm mine" data-ch="0"/);
    expect(onDesktop(host())).toMatch(/class="vm mine" data-ch="1"/);
  });

  it("draws the host's take list, and no lane and no take list of its own", () => {
    for (const html of [page(host()), onDesktop(host())]) {
      expect(html).toContain("the host&#x27;s take list");
      expect(html).not.toContain("tl-scroll");
      expect(html).not.toContain("tl-takes");
      expect(html).not.toContain("tl-tools");
      expect(html).not.toContain("tb-list");
      expect(html).not.toContain("bars-ctl");
    }
  });

  it("in the desktop app keeps Record and Rehearse, the count-in and the click, the interface, the monitor, the nudge and the vocal sound", () => {
    const html = onDesktop(host());
    expect(html).toMatch(/class="rec-btn" aria-label="Record"/);
    expect(html).toContain("Rehearse: sing over the loop without recording");
    // what a recording goes round comes from the host's plan
    expect(html).toContain("↻ bars 3–6");
    for (const kept of ["Count-in", "Click", "Interface", "Monitor", "Direct", "Effects", "On the interface", "Timing nudge", "Vocal sound", "Preset…", "Dynamics", "Reverb"]) expect(html, kept).toContain(kept);
    // Record can be pressed before the interface is open: it is waited for
    expect(html).not.toMatch(/class="rec-btn" aria-label="Record"[^>]*disabled/);
    expect(html).not.toContain("Recording: in the desktop app");
  });

  it("offers Apply sound when the host says the takes were made with an older sound", () => {
    expect(onDesktop(host())).not.toContain("Apply sound");
    expect(onDesktop(host({ track: { id: "tv", name: "Lead vocal", input: 0, fx: FX_DEFAULT, stale: true } }))).toContain("↻ Apply sound");
  });

  it("with no track: the way to add one, and no record button", () => {
    for (const html of [page(host({ track: null })), onDesktop(host({ track: null }))]) {
      expect(html).toContain("Add a Vocals track to record on");
      expect(html).not.toContain("rec-btn");
      expect(html).not.toContain("Rehearse");
      // the take list is still the host's (the removed recordings are in it)
      expect(html).toContain("the host&#x27;s take list");
    }
    // the interface and the room are still there
    expect(onDesktop(host({ track: null }))).toContain("Interface");
  });

  it("in a browser says where recording is", () => {
    const html = page(host());
    expect(html).toContain("Recording: in the desktop app.");
    expect(html).not.toContain("rec-btn");
  });
});

describe("the Vocals page without a host", () => {
  it("still draws as it did: its own track tabs, nothing of a host", () => {
    // (on the old app's own state, as the old view mounts it)
    const old: Ctx = {
      state: DEFAULT_STATE, set: () => {}, tuning: getTuning("standard"), sheet: null, openSheet: () => {}, toast: () => {}, audition: () => {}, shapeOf: () => null, setShape: () => {}, addChord: () => {},
      idea: null, dirty: false, saveIdea: () => "nothing", openIdea: () => {}, newIdea: () => {}, opened: 0, renameIdea: () => {}, deleteIdea: () => {}, importIdeas: () => 0, cloud: "local", syncNow: () => {}, recordingTo: null, setRecordingTo: () => {},
    } as unknown as Ctx;
    const html = renderToStaticMarkup(createElement(AppCtx.Provider, { value: old }, createElement(VocalsPage, props)));
    expect(html).toContain('class="card vocals"');
    expect(html).toContain("clip-tracks");
    expect(html).toContain('aria-label="Add a vocal track"');
    expect(html).toContain("Recording: in the desktop app.");
    expect(html).not.toContain("hosted");
  });
});

// The old view as one page in a window of the track view, drawn as text: exactly the one page, and nothing of the
// old app around it, not a harmony sheet either (the track view hosts that). And the melody grid starting lower, for
// a bass.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SOUND_DEFAULT } from "../../audio/rack";
import { getTuning } from "../../guitar/tunings";
import { writeHarmony } from "../../song/harmony";
import { EMPTY_MELODY, melodyBase } from "../../song/melody";
import { convertAll } from "../../timeline/convert";
import { lensOf, unlens, type Target } from "../../timeline/lens";
import { bandSong } from "../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../app5";
import { DEFAULT_STATE } from "../state";
import { GuitarView, type EmbedHost } from "../views/GuitarView";
import { ClipLens, V4View } from "../windows/ClipLens";
import { MelodyGrid } from "./MelodyGrid";

const key = { tonic: "C", scaleId: "ionian" };
const state: App5State = { ...convertAll(DEFAULT_STATE, 1), song: bandSong(), key };
const app: Ctx5 = {
  state, peek: () => state, set: () => {}, edit: () => {}, editKeyed: () => {}, setSession: () => {}, undo: () => {}, redo: () => {}, canUndo: false, canRedo: false,
  tuning: getTuning("standard"), toast: () => {}, idea: null, dirty: false, opened: 0, saveIdea: () => "nothing", openIdea: () => {}, newIdea: () => {}, renameIdea: () => {},
  deleteIdea: () => {}, importIdeas: () => 0, cloud: "local", syncNow: () => {}, recordingTo: null, setRecordingTo: () => {},
};
const host = (pane: EmbedHost["pane"], more: Partial<EmbedHost> = {}): EmbedHost => ({ pane, playing: false, togglePlay: () => {}, getPos: () => null, preview: () => {}, hearNow: () => {}, ...more });
const page = (target: Target, h: EmbedHost) =>
  renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(ClipLens, { target, pane: h.pane }, createElement(GuitarView, { embedded: h }))));
const count = (html: string, what: RegExp) => (html.match(what) ?? []).length;
/** the notes of the grid's rows, highest first */
const rowNotes = (html: string) => [...new Set([...html.matchAll(/data-m="(\d+)"/g)].map((m) => Number(m[1])))];

describe("the old view as one page in a window", () => {
  const pages: [string, Target, EmbedHost["pane"], RegExp][] = [
    ["Chords", { track: "tc", clip: "c1" }, "rhythm", /class="card board"/],
    ["Melody", { track: "tm", clip: "m1" }, "melody", /class="card melody"/],
    ["Bass", { track: "tb", clip: "b1" }, "melody", /class="card melody"/],
    ["Drums", { track: "td", clip: "d1" }, "drums", /class="card drums/],
  ];
  for (const [name, target, pane, own] of pages) {
    it(`${name}: exactly one page, with no transport, no hidden pages and no track tabs`, () => {
      const html = page(target, host(pane));
      expect(count(html, /class="pane"/g)).toBe(1);
      expect(count(html, own)).toBe(1);
      expect(html).not.toContain("transport");
      expect(html).not.toMatch(/ hidden(=""|>| )/);
      expect(html).not.toContain("clip-bar");
      expect(html).not.toContain("clip-tracks");
      expect(html).not.toContain('class="tabs"');
      // none of the other pages is drawn beside it
      const others = [/class="card board"/, /class="card melody"/, /class="card drums/, /class="card cv/, /class="card keybar"/, /fr-tempo/, /class="tv/].filter((r) => r.source !== own.source);
      for (const r of others) expect(count(html, r), `${name}: ${r.source}`).toBe(0);
    });
  }

  it("the Chords page holds the chord board, the tray and the sound; the Melody page its sound too", () => {
    const chords = page({ track: "tc", clip: "c1" }, host("rhythm"));
    expect(chords).toContain('class="dock');
    expect(chords).toContain('class="card harp"');
    expect(count(chords, /data-slot="/g)).toBe(8);
    const melody = page({ track: "tm", clip: "m1" }, host("melody"));
    expect(melody).toContain("sound-row");
    // the chords the song plays under the melody stand over its grid
    expect(melody).toContain("mg-chords");
  });

  it("a track with nothing on it yet opens on an empty page", () => {
    const empty: Target = { track: "tm", fresh: { id: "new1", at: 0, sig: { num: 4, den: 4 } } };
    const html = page(empty, host("melody"));
    expect(count(html, /class="card melody"/g)).toBe(1);
    expect(html).not.toContain('aria-pressed="true" aria-label="C,');
  });

  it("a bass track's grid starts two octaves under a melody's", () => {
    const low = melodyBase(key) - 24;
    const melody = rowNotes(page({ track: "tm", clip: "m1" }, host("melody")));
    const bass = rowNotes(page({ track: "tb", clip: "b1" }, host("melody", { low })));
    // (rows from the lowest up two octaves; notes already written outside them get rows of their own)
    expect(Math.min(...bass)).toBe(low);
    expect(bass).toContain(low + 24);
    expect(Math.min(...melody)).toBe(melodyBase(key));
    expect(melody).toContain(melodyBase(key) + 24);
  });
});

describe("Harmonize on the old view in a window: the sheet is the host's", () => {
  const ask = () => {};
  const targets: [string, Target, EmbedHost["pane"]][] = [["Chords", { track: "tc", clip: "c1" }, "rhythm"], ["Melody", { track: "tm", clip: "m1" }, "melody"], ["Bass", { track: "tb", clip: "b1" }, "melody"]];
  for (const [name, target, pane] of targets) {
    it(`${name}: with onHarmonize set, the page's markup holds a Harmonize button and no harmony sheet`, () => {
      const html = page(target, host(pane, { onHarmonize: ask }));
      expect(count(html, /class="chip hz-go"/g)).toBe(1);
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain("hz-sheet");
      expect(html).not.toContain('aria-label="Harmonize"');
    });
    it(`${name}: while the host says the sheet is open for it, the button is lit, and the page still holds no sheet`, () => {
      const html = page(target, host(pane, { onHarmonize: ask, harmonizing: true }));
      expect(count(html, /class="chip hz-go on"/g)).toBe(1);
      expect(html).toMatch(/class="chip hz-go on" aria-expanded="true"/);
      expect(html).not.toContain("hz-sheet");
    });
    it(`${name}: without onHarmonize the page has no Harmonize button (it has no sheet of its own to open)`, () => {
      const html = page(target, host(pane));
      expect(html).not.toContain("hz-go");
      expect(html).not.toContain("hz-sheet");
    });
  }
  it("the Drums page never has a Harmonize button", () => {
    expect(page({ track: "td", clip: "d1" }, host("drums", { onHarmonize: ask, harmonizing: true }))).not.toContain("hz-go");
  });
  it("a track Harmonize wrote: its ⟳ row is there to ask the host with, and only with a host to ask", () => {
    // a second melody track that Harmonize wrote from the melody
    const t: Target = { track: "tm", clip: "m1" };
    const lens = lensOf(state.song, t, key, 0)!;
    const written = writeHarmony(lens.p, key, { kind: "melody", from: "melody", option: "third-above" }, { id: "hx", isNew: true, name: "x" }).p;
    let n = 0;
    const song = unlens(state.song, t, lens, written, () => `x${++n}`);
    const clip = song.clips.find((c) => c.track === "hx")!.id;
    const draw = (h: EmbedHost) => renderToStaticMarkup(createElement(App5Ctx.Provider, { value: { ...app, state: { ...state, song }, peek: () => ({ ...state, song }) } },
      createElement(ClipLens, { target: { track: "hx", clip }, pane: "melody" }, createElement(GuitarView, { embedded: h }))));
    const asked = draw(host("melody", { onHarmonize: ask }));
    expect(asked).toContain('class="emb-again"');
    expect(asked).toMatch(/aria-label="Write [^"]+ again"/);
    expect(asked).not.toContain("hz-sheet");
    expect(draw(host("melody"))).not.toContain("emb-again");
  });
});

describe("the melody grid with a lowest row of its own", () => {
  const grid = (low?: number) =>
    renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(V4View, null, createElement(MelodyGrid, {
      melody: { ...EMPTY_MELODY, bars: 1 }, setMelody: () => {}, keyOf: key, bar: 4, chords: [], playing: false, getPos: () => null,
      sound: SOUND_DEFAULT, setSound: () => {}, onHear: () => {}, shown: 1, follow: false, active: true, ...(low !== undefined ? { low } : {}),
    }))));
  it("without it the rows are as they always were: two octaves from the home note", () => {
    const rows = rowNotes(grid());
    expect(rows.length).toBe(25);
    expect(Math.min(...rows)).toBe(melodyBase(key));
    expect(Math.max(...rows)).toBe(melodyBase(key) + 24);
  });
  it("with 24 under the home row, every row is two octaves lower", () => {
    const base = rowNotes(grid());
    const rows = rowNotes(grid(melodyBase(key) - 24));
    expect(rows).toEqual(base.map((m) => m - 24));
    // the same notes by name, in the same order
    const names = (html: string) => [...html.matchAll(/aria-label="Hear ([^"]+)"/g)].map((m) => m[1]);
    expect(names(grid(melodyBase(key) - 24))).toEqual(names(grid()));
  });
});

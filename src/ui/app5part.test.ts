// A window's own part of the song: what it is, and when it counts as changed (so the window is drawn again only then).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTuning } from "../guitar/tunings";
import { convertAll } from "../timeline/convert";
import { moveClips, renameTrack, setTempo, setTrack } from "../timeline/edit";
import type { ChordsTrack } from "../timeline/model";
import { bandSong } from "../timeline/testsongs";
import { App5Ctx, App5Store, sameWinPart, useApp5Part, useWinPart, winPart, type App5State, type Ctx5, type Store5 } from "./app5";
import { DEFAULT_STATE } from "./state";

const state = (): App5State => ({ ...convertAll(DEFAULT_STATE, 1), song: bandSong() });
const no = () => {};

describe("a window's own part of the song", () => {
  const s0 = state();
  const own = winPart(s0, "tc", "c1");
  it("is its track and the clip it has open; on a draft, the track alone", () => {
    expect(own.track?.id).toBe("tc");
    expect(own.clip?.id).toBe("c1");
    expect(winPart(s0, "tc").clip).toBeUndefined();
    expect(winPart(s0, "nothing", "nothing")).toEqual({ track: undefined, clip: undefined });
  });
  it("is the same part after an edit elsewhere: another track's sound, another clip moved, the tempo, the session", () => {
    const other = s0.song.tracks.find((t) => t.kind === "melody")!;
    const elsewhere: App5State[] = [
      { ...s0, song: renameTrack(s0.song, other.id, "Tune") },
      { ...s0, song: moveClips(s0.song, [s0.song.clips.find((c) => c.track === other.id)!.id], 4) },
      { ...s0, song: setTempo(s0.song, 132) },
      { ...s0, session: { ...s0.session, cursor: 12 } },
    ];
    for (const s of elsewhere) {
      expect(s.song === s0.song && s.session === s0.session).toBe(false);
      expect(sameWinPart(own, winPart(s, "tc", "c1"))).toBe(true);
    }
  });
  it("is another part when its own track or its own clip changes", () => {
    const sound = { ...s0, song: setTrack<ChordsTrack>(s0.song, "tc", { name: "Keys" }) };
    expect(sameWinPart(own, winPart(sound, "tc", "c1"))).toBe(false);
    const moved = { ...s0, song: moveClips(s0.song, ["c1"], 4) };
    // (the move is refused or made: when made, the clip is a new object)
    if (moved.song !== s0.song) expect(sameWinPart(own, winPart(moved, "tc", "c1"))).toBe(false);
    // a window on the draft does not mind a clip of its track moving
    expect(sameWinPart(winPart(s0, "tc"), winPart(moved, "tc"))).toBe(true);
  });
});

describe("reading a part of the state", () => {
  const s = state();
  const Probe = () => createElement("i", null, `${useApp5Part((x) => x.song.bpm)} ${useWinPart("tc").track?.name}`);
  it("from the store the provider hands out", () => {
    const store: Store5 = { peek: () => s, subscribe: () => no, set: no, edit: no, setSession: no, toast: no };
    expect(renderToStaticMarkup(createElement(App5Store.Provider, { value: store }, createElement(Probe)))).toBe(`<i>${s.song.bpm} Chords</i>`);
  });
  it("and, where only the whole state is handed out (a test's provider), from that", () => {
    const app = { state: s, peek: () => s, set: no, edit: no, setSession: no, toast: no, tuning: getTuning("standard") } as unknown as Ctx5;
    expect(renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(Probe)))).toBe(`<i>${s.song.bpm} Chords</i>`);
  });
  it("outside both it says so", () => {
    expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(/outside provider/);
  });
});

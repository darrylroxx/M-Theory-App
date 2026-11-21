import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addTrack, resizeClip, songEnd } from "../../timeline/edit";
import type { Session, TimelineSong } from "../../timeline/model";
import { CLIP_OF, notches } from "../../timeline/model";
import { barMap } from "../../timeline/bars";
import { FIX, FIXTURE_KEY, fixturePeaks, fixtureSession, fixtureSong } from "./fixture";
import { TrackView, type TrackViewProps } from "./TrackView";
import type { TopBarProps } from "./TopBar";

const nothing = () => {};
const top = (o: Partial<TopBarProps> = {}): TopBarProps => ({
  idea: { name: "A song", dirty: false, count: 2, save: nothing },
  onKey: nothing, onMove: nothing, onTempo: nothing, onSig: nothing,
  undo: nothing, redo: nothing, canUndo: false, canRedo: false,
  exports: { wav: nothing, midi: nothing, chart: nothing },
  openCanvas: nothing, openIdeas: nothing, openSettings: nothing,
  ...o,
});
const record = { on: false, busy: false, live: false, toggle: nothing, monitor: "hardware" as const, setMonitor: nothing };

/** The view as text: on a song, with a session and whatever else is given. */
function view(song: TimelineSong, session: Partial<Session> = {}, o: Partial<TrackViewProps> = {}): string {
  const props: TrackViewProps = {
    song, keyOf: FIXTURE_KEY, session: { ...fixtureSession(), pxPerBeat: 12, ...session },
    edit: nothing, setSession: nothing, open: nothing, peaks: fixturePeaks,
    player: { playing: false, toggle: nothing, stop: nothing, getBeat: () => null, seek: nothing, audition: nothing },
    clipboard: { copy: nothing, paste: nothing, has: false },
    sound: { copy: nothing, paste: nothing, has: () => false },
    top: top({ record }),
    ...o,
  };
  return renderToStaticMarkup(createElement(TrackView, props));
}
const count = (html: string, what: string | RegExp): number => html.split(what).length - 1;
/** the markup of one clip, from its opening tag to the next clip (or the lane's end) */
const clipHtml = (html: string, id: string): string => {
  const at = html.indexOf(`data-clip="${id}"`);
  if (at < 0) return "";
  const next = html.indexOf("data-clip=", at + 10);
  const lane = html.indexOf("data-lane=", at);
  const ends = [next, lane].filter((x) => x > 0);
  return html.slice(at, ends.length ? Math.min(...ends) : undefined);
};

describe("the fixture song", () => {
  const song = fixtureSong();
  it("is 24 bars: 16 in 4/4, 4 in 6/8, 4 in 4/4", () => {
    expect(songEnd(song)).toBe(88);
    const map = barMap(song);
    expect(map.barAt(88).bar).toBe(24);
    expect(map.beatOfBar(16)).toBe(64);
    expect(map.beatOfBar(20)).toBe(72);
    expect(song.tracks.map((t) => t.name)).toEqual(["Chords", "Melody", "Bass", "Drums", "Drums 2", "Vocal 1"]);
    expect(song.markers?.map((m) => `${m.name}@${map.barAt(m.beat).bar + 1}`)).toEqual(["Verse@1", "Chorus@9", "Bridge@17", "Out@21"]);
  });
  it("has a one-bar rhythm over four bars (three notches) and a four-bar rhythm shown once (none)", () => {
    expect(notches(song.clips.find((c) => c.id === "fx-d2")!, song)).toEqual([4, 8, 12]);
    expect(notches(song.clips.find((c) => c.id === "fx-d1")!, song)).toEqual([]);
  });
  it("is new each time", () => {
    expect(fixtureSong()).not.toBe(fixtureSong());
    expect(fixtureSong()).toEqual(fixtureSong());
  });
});

describe("the track view, drawn", () => {
  const song = fixtureSong();
  const html = view(song);

  it("keeps the two marks the rest of the app looks for: the top bar, and play as a section", () => {
    expect(html).toMatch(/<header class="topbar[ "]/);
    expect(html).toMatch(/<section class="transport[ "]/);
  });

  it("has one lane for each track, and each says which kind of clip it takes", () => {
    const lanes = [...html.matchAll(/data-lane="([^"]+)" data-kind="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(lanes).toEqual(song.tracks.map((t) => [t.id, CLIP_OF[t.kind]]));
    expect(lanes.map((l) => l[1])).toEqual(["chords", "melody", "melody", "drums", "drums", "audio"]);
  });

  it("gives every track a compose button that is a drawing alone, named for those who cannot see it", () => {
    const buttons = [...html.matchAll(/<button class="tlh-btn tlh-compose"([^>]*)>(.*?)<\/button>/g)];
    expect(buttons).toHaveLength(song.tracks.length);
    for (const b of buttons) {
      expect(b[1]).toContain('aria-label="Compose"');
      expect(b[1]).toContain("title=");
      // a drawing and no words
      expect(b[2].startsWith("<svg")).toBe(true);
      expect(b[2].replace(/<[^>]+>/g, "")).toBe("");
    }
    // and a way to its sound
    expect(count(html, 'class="tlh-btn tlh-fx')).toBe(song.tracks.length);
  });

  it("shows arm and the input only on tracks that record", () => {
    const two = addTrack(song, "audio", "t-blank");
    const out = view(two);
    expect(count(out, 'class="tlh-arm')).toBe(2);
    expect(count(out, 'class="tlh-in ')).toBe(2);
    // each in a panel of a track that records
    const panels = out.split('class="tlh ').slice(1);
    expect(panels.map((p) => p.includes("tlh-arm"))).toEqual([false, false, false, false, false, true, true]);
    expect(count(html, 'class="tlh-arm')).toBe(1);
  });

  it("marks the armed track, and the selected track and clips", () => {
    const out = view(song, { armed: FIX.vocal, sel: { clips: ["fx-m1"], track: FIX.melody } });
    expect(out).toMatch(/class="tlh-arm on" aria-pressed="true"/);
    expect(clipHtml(out, "fx-m1")).toContain('aria-pressed="true"');
    expect(clipHtml(out, "fx-c1")).toContain('aria-pressed="false"');
    // the selected clip has its row of six buttons, each with its key
    expect(count(out, /class="tlc-act[ "]/)).toBe(6);
    for (const said of ["Open (Enter)", "Mute (0)", "Split (S)", "Duplicate (Ctrl+D)", "Copy (Ctrl+C)", "Delete (Del)"]) expect(out).toContain(`title="${said}"`);
    expect(count(html, /class="tlc-act[ "]/)).toBe(0);
  });

  it("puts a dot on a harmony clip whose source has changed", () => {
    const out = view(song, {}, { stale: new Set(["fx-m1"]) });
    expect(clipHtml(out, "fx-m1")).toContain("tlc-dot");
    expect(clipHtml(out, "fx-c1")).not.toContain("tlc-dot");
    expect(html).not.toContain("tlc-dot");
  });

  it("draws a notch wherever a clip's content starts again", () => {
    expect(count(clipHtml(html, "fx-d2"), "tlc-notch")).toBe(3);
    expect(count(clipHtml(html, "fx-d1"), "tlc-notch")).toBe(0);
    // the 4-bar rhythm dragged out to 10 bars: twice whole, then its first two bars
    const long = resizeClip(song, "fx-d1", "right", 56);
    expect(count(clipHtml(view(long), "fx-d1"), "tlc-notch")).toBe(2);
    // and its left edge dragged two bars earlier: one more, where the rhythm started before
    expect(count(clipHtml(view(resizeClip(long, "fx-d1", "left", 8)), "fx-d1"), "tlc-notch")).toBe(3);
  });

  it("mounts only the clips near the screen", () => {
    // at 12 pixels a beat the 1020 pixels of lanes show 85 beats: everything is on
    expect(count(html, "data-clip=")).toBe(song.clips.length);
    // far to the right nothing of bar 1 is left, and the lanes are still there
    const far = view(song, { scroll: 400 });
    expect(far).not.toContain('data-clip="fx-c1"');
    expect(far).not.toContain('data-clip="fx-d2"');
    expect(count(far, "data-clip=")).toBe(0);
    expect(count(far, "data-lane=")).toBe(song.tracks.length);
    // zoomed in at the song's start, the clips of the second half are not mounted
    const near = view(song, { pxPerBeat: 80, scroll: 0 });
    expect(near).toContain('data-clip="fx-c1"');
    expect(near).not.toContain('data-clip="fx-c2"');
    expect(near).not.toContain('data-clip="fx-a1"');
  });

  it("shows record and the monitor control only when it is given them", () => {
    expect(html).toContain('aria-label="Record"');
    expect(html).toContain("tlv-mon");
    const out = view(song, {}, { top: top() });
    expect(out).not.toContain('aria-label="Record"');
    expect(out).not.toContain("tlv-mon");
    // (no ● in the top bar; the panel of the track that records keeps its own arm ●)
    expect(count(out, "tlv-round rec")).toBe(0);
  });

  it("writes the ruler: marker names, signature flags, the loop, and how long the song is", () => {
    for (const name of ["Verse", "Chorus", "Bridge", "Out"]) expect(html).toContain(`>${name}</div>`);
    expect([...html.matchAll(/class="tlv-flag"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["6/8", "4/4"]);
    expect(html).toContain("<b>24 bars</b>");
    expect(count(html, 'class="tlv-band"')).toBe(0);
    const looped = view(song, { loop: { regions: [{ from: 32, to: 48 }, { from: 64, to: 68 }], on: true } });
    expect(count(looped, 'class="tlv-band"')).toBe(2);
    expect(count(looped, 'class="tlv-tint on"')).toBe(2);
    expect(looped).toMatch(/aria-pressed="true" aria-label="Stop looping"/);
  });

  it("reads the position, the key, the tempo and the signature at the cursor in the top bar", () => {
    const out = view(song, { cursor: 16 });
    expect(out).toContain(">5.1 · 0:10</output>");
    expect(out).toContain("B major");
    expect(out).toContain("96<small>bpm</small>");
    expect(out).toContain('aria-label="Time signature: 4/4"');
    // in the stretch of 6/8 the control shows that
    expect(view(song, { cursor: 66 })).toContain('aria-label="Time signature: 6/8"');
  });

  it("opens fitted to the whole song when no zoom was chosen yet", () => {
    // 88 beats across the 1020 pixels a 1280 window has for lanes: the second chords clip starts at 32 beats
    const out = view(song, { pxPerBeat: 0 });
    const m = /data-clip="fx-c2"[^>]*style="left:([\d.]+)px;width:([\d.]+)px"/.exec(out);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo((32 * 1020) / 88, 1);
    expect(Number(m![2])).toBeCloseTo((32 * 1020) / 88, 1);
  });

  it("dims the lanes that would refuse a clip being dragged out of a composer", () => {
    const out = view(song, {}, { dropKind: "drums" });
    const lanes = [...out.matchAll(/class="tlv-lane ([^"]*)" data-lane="([^"]+)"/g)].map((m) => [m[2], m[1].includes("refuse"), m[1].includes("accept")]);
    expect(lanes).toEqual([[FIX.chords, true, false], [FIX.melody, true, false], [FIX.bass, true, false], [FIX.drums, false, true], [FIX.drums2, false, true], [FIX.vocal, true, false]]);
    expect(html).not.toContain(" refuse");
  });
});

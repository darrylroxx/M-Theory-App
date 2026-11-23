// The phone's layout of the track view, drawn as text, and the arithmetic behind what a finger does there.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resizeClip } from "../../timeline/edit";
import type { Session, TimelineSong } from "../../timeline/model";
import { SIG44, audioClip, audioTrack, bandSong, chordsClip, chordsContent, chordsTrack, drumsClip, drumsTrack, songOf, take } from "../../timeline/testsongs";
import { openWin, clearOf, STEP_X, STEP_Y, MIN_H, PANEL_W, TOP_H, SOUND_W } from "../windows/windows";
import { FIXTURE_KEY, fixturePeaks, fixtureSession, fixtureSong } from "./fixture";
import { MAX_PX, MIN_PX, pinchView, repeatEnd, xOfBeat } from "./gestures";
import { Menu, type MenuItem } from "./Menu";
import type { TopBarProps } from "./TopBar";
import { PANEL, PANEL_PHONE, ROW_H, ROW_PHONE, TrackView, type TrackViewProps } from "./TrackView";

const nothing = () => {};
const top = (o: Partial<TopBarProps> = {}): TopBarProps => ({
  idea: { name: "A song", dirty: true, count: 2, save: nothing },
  onKey: nothing, onMove: nothing, onTempo: nothing, onSig: nothing,
  undo: nothing, redo: nothing, canUndo: true, canRedo: false,
  exports: { wav: nothing, midi: nothing, chart: nothing },
  openCanvas: nothing, openIdeas: nothing, openSettings: nothing,
  record: { on: false, busy: false, live: false, toggle: nothing, monitor: "hardware", setMonitor: nothing },
  ...o,
});
function view(song: TimelineSong, phone: boolean | undefined, session: Partial<Session> = {}, o: Partial<TrackViewProps> = {}): string {
  const props: TrackViewProps = {
    song, keyOf: FIXTURE_KEY, session: { ...fixtureSession(), pxPerBeat: 12, ...session },
    edit: nothing, setSession: nothing, open: nothing, peaks: fixturePeaks,
    player: { playing: false, toggle: nothing, stop: nothing, getBeat: () => null, seek: nothing, audition: nothing },
    clipboard: { copy: nothing, paste: nothing, has: false },
    sound: { copy: nothing, paste: nothing, has: () => false },
    top: top(), phone, ...o,
  };
  return renderToStaticMarkup(createElement(TrackView, props));
}
const count = (html: string, what: string | RegExp): number => html.split(what).length - 1;
/** one track's panel, from its opening tag to its lane */
const panel = (html: string, id: string): string => {
  const at = html.indexOf(`data-track="${id}"`);
  return at < 0 ? "" : html.slice(html.lastIndexOf("<div", at), html.indexOf("data-lane=", at));
};

describe("the phone's track view", () => {
  const song = fixtureSong();
  const html = view(song, true);
  const wide = view(song, false);

  it("says it is the phone's, and the desktop's does not", () => {
    expect(html).toContain('class="tlv tlv-phone"');
    expect(wide).toContain('class="tlv"');
    expect(wide).not.toContain("tlv-phone");
    // (with nothing said, the screen decides: drawn here with no screen, it is the desktop's)
    expect(view(song, undefined)).toBe(wide);
  });

  it("each panel has four controls: its name, compose, M and S; no dB readout, no slider, no grip to drag", () => {
    for (const t of song.tracks) {
      const p = panel(html, t.id);
      expect(p).toContain("tlh narrow");
      expect(count(p, "<button")).toBe(4);
      expect(p).toContain(`aria-label="${t.name}: sound, volume and more"`);
      expect(p).toContain('aria-label="Compose"');
      expect(p).toContain(`aria-label="Mute ${t.name}"`);
      expect(p).toContain(`aria-label="Solo ${t.name}"`);
      expect(p).not.toContain("tlh-db");
      expect(p).not.toContain("tlh-vol");
      expect(p).not.toContain('type="range"');
      expect(p).not.toContain("tlh-fx");
      expect(p).not.toContain("Drag to move this track");
    }
    // the desktop's panel is as it was: the readout, the slider, FX, the grip
    const d = panel(wide, song.tracks[0].id);
    for (const what of ["tlh-db", "tlh-vol", "tlh-fx", "Drag to move this track", "tlh-more"]) expect(d).toContain(what);
    expect(d).not.toContain("narrow");
  });

  it("an armed track says so by its name (its arm button is in its menu)", () => {
    const rec = song.tracks.find((t) => t.kind === "vocals")!;
    expect(panel(html, rec.id)).not.toContain("tlh-armed");
    expect(panel(view(song, true, { armed: rec.id }), rec.id)).toContain("tlh-armed");
  });

  it("rows are taller and panels narrower than the desktop's", () => {
    expect(ROW_PHONE).toBeGreaterThan(ROW_H);
    expect(PANEL_PHONE).toBeLessThan(PANEL);
    expect(html).toContain(`grid-template-rows:repeat(${song.tracks.length}, ${ROW_PHONE}px)`);
    expect(wide).toContain(`grid-template-rows:repeat(${song.tracks.length}, ${ROW_H}px)`);
  });

  it("the top bar: play, loop, record, the position, undo and redo, ⋯, key, tempo, signature and Save; the rest is in ⋯", () => {
    const bar = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    for (const what of ['aria-label="Play"', 'aria-label="Loop"', 'aria-label="Record"', "tlv-pos", 'aria-label="Undo"', 'aria-label="Redo"', "tlv-more", 'aria-label="Key: ', "tlv-bpm", 'aria-label="Time signature: ', "save-btn"]) expect(bar).toContain(what);
    for (const what of [">Export<", ">Canvas<", "ideas-btn", 'aria-label="Settings"', "tlv-mon", "brand-mark"]) expect(bar).not.toContain(what);
    // the desktop's bar holds them as buttons, and has no ⋯
    const d = wide.slice(wide.indexOf("<header"), wide.indexOf("</header>"));
    for (const what of [">Export<", ">Canvas<", "ideas-btn", 'aria-label="Settings"', "tlv-mon", "brand-mark"]) expect(d).toContain(what);
    expect(d).not.toContain("tlv-more");
    expect(d).not.toContain("tlv-top-phone");
  });

  it("over the panels: − fit + (Follow is a line of the ⋯ menu); the desktop keeps Follow there", () => {
    const corner = (h: string) => h.slice(h.indexOf('class="tlv-corner"'), h.indexOf('class="tlv-ruler', h.indexOf('class="tlv-corner"')));
    expect(corner(html)).toContain('aria-label="Zoom out"');
    expect(corner(html)).toContain('aria-label="Zoom in"');
    expect(corner(html)).toContain("Fit the whole song");
    expect(corner(html)).not.toContain("tlv-follow");
    expect(corner(wide)).toContain("tlv-follow");
  });

  it("a selected clip keeps its six buttons, and the + row asks for a menu", () => {
    const sel = view(song, true, { sel: { clips: [song.clips[0].id], track: song.clips[0].track } });
    expect(count(sel, /class="tlc-act[ "]/)).toBe(6);
    expect(html).toContain('aria-label="Add a track" aria-expanded="false" aria-haspopup="menu"');
    expect(wide).not.toContain('aria-haspopup="menu" title="Add a track"');
  });
});

describe("a menu on a phone", () => {
  const items: MenuItem[] = [
    { title: "Chords" },
    { label: "Sound and effects", run: nothing },
    { range: { label: "Volume", min: -60, max: 6, step: 0.5, value: -3, reset: 0, text: (v) => `${v} dB`, set: nothing } },
    { label: "Remove track", danger: true, run: nothing },
  ];
  it("can hold a slider that says its value, with a way back to where it rests", () => {
    const html = renderToStaticMarkup(createElement(Menu, { at: { x: 0, y: 0 }, items, label: "Track", onClose: nothing, back: true }));
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Volume"');
    expect(html).toContain("-3 dB");
    expect(html).toContain('aria-label="Volume: back to 0 dB"');
    // the dimmed screen behind it, which a press beside the menu lands on
    expect(html).toContain("tlv-menu-back");
  });
  it("on the desktop has nothing behind it", () => {
    const html = renderToStaticMarkup(createElement(Menu, { at: { x: 0, y: 0 }, items: items.filter((i) => !("range" in i)), label: "Track", onClose: nothing }));
    expect(html).not.toContain("tlv-menu-back");
    expect(html.startsWith('<div class="tlv-menu"')).toBe(true);
  });
});

describe("two fingers on the lanes", () => {
  const v = { pxPerBeat: 10, scroll: 8 };
  it("moved apart to twice the distance: twice the zoom, and the beat between them stays between them", () => {
    const to = pinchView(v, 100, 200, 150, 150);
    expect(to.pxPerBeat).toBe(20);
    // beat 23 was under the point between the fingers, and still is
    expect(xOfBeat(v, 23)).toBe(150);
    expect(xOfBeat(to, 23)).toBeCloseTo(150, 9);
  });
  it("moved together zooms out; moved sideways together, the song goes with them", () => {
    expect(pinchView(v, 200, 100, 150, 150).pxPerBeat).toBe(5);
    const to = pinchView(v, 100, 100, 150, 100);
    expect(to.pxPerBeat).toBe(10);
    expect(xOfBeat(to, 23)).toBeCloseTo(100, 9);
  });
  it("stays within the closest and the widest zoom, and never shows time before the song starts", () => {
    expect(pinchView(v, 10, 100000, 150, 150).pxPerBeat).toBe(MAX_PX);
    expect(pinchView(v, 100000, 10, 150, 150).pxPerBeat).toBe(MIN_PX);
    expect(pinchView({ pxPerBeat: 10, scroll: 0 }, 100, 100, 10, 200).scroll).toBe(0);
  });
});

describe("Repeat once more, once less: the right edge as two lines of a clip's menu", () => {
  const song = (len: number, off = 0): TimelineSong =>
    songOf([chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td", "Drums", { lead: true })], {
      clips: [chordsClip("c1", "tc", 8, len, { off, content: chordsContent(2) }), drumsClip("d1", "td", 0, 4, { bars: 1 })],
    });
  const clip = (s: TimelineSong, id = "c1") => s.clips.find((c) => c.id === id)!;
  it("a clip one round long: once more ends it a round later; once less is not possible", () => {
    const s = song(8);
    expect(repeatEnd(s, clip(s), 1)).toBe(24);
    expect(repeatEnd(s, clip(s), -1)).toBeNull();
  });
  it("a clip that ends part-way through a round: more fills the round, less goes back to where it began", () => {
    const s = song(12);
    expect(repeatEnd(s, clip(s), 1)).toBe(24);
    expect(repeatEnd(s, clip(s), -1)).toBe(16);
  });
  it("a clip opened part-way into its content counts its rounds from where the content starts", () => {
    const s = song(8, 4);
    // (its content came round at beat 12; the next time is beat 20)
    expect(repeatEnd(s, clip(s), 1)).toBe(20);
    expect(repeatEnd(s, clip(s), -1)).toBe(12);
  });
  it("is what a drag of the edge to that place does", () => {
    const s = song(8);
    const to = repeatEnd(s, clip(s), 1)!;
    expect(clip(resizeClip(s, "c1", "right", to)).kind !== "audio" && (clip(resizeClip(s, "c1", "right", to)) as { len: number }).len).toBe(16);
    // a one-bar rhythm over one bar: once more is two bars
    expect(repeatEnd(s, clip(s, "d1"), 1)).toBe(8);
  });
  it("a recorded clip: a round is the stretch of its take that it plays", () => {
    const t = take("k1", 2);
    const s = songOf([audioTrack("tv", "vocals", "Vocal 1", [t])], { bpm: 120, meter: SIG44, clips: [audioClip("a1", "tv", t, 4, { from: 0, to: 48000, frames: 48000 })] });
    // (48,000 frames at 48 kHz is a second: two beats at 120)
    expect(repeatEnd(s, clip(s, "a1"), 1)).toBeCloseTo(8, 9);
    expect(repeatEnd(s, clip(s, "a1"), -1)).toBeNull();
  });
});

describe("a second sound window", () => {
  const screen = { w: 1280, h: 800, panel: PANEL_W, top: TOP_H };
  const band = bandSong();
  const session = (): Session => ({ ...fixtureSession(), windows: [] });
  it("opens a step down and to the left of the first, so both title bars can be reached", () => {
    const one = openWin(session(), "sound", band.tracks[0].id, undefined, screen);
    const two = openWin(one, "sound", band.tracks[1].id, undefined, screen);
    const [a, b] = two.windows;
    expect([a.x, a.y, a.w]).toEqual([1280 - SOUND_W, TOP_H, SOUND_W]);
    expect([b.x, b.y]).toEqual([a.x - STEP_X, a.y + STEP_Y]);
    expect(b.w).toBe(a.w);
    // it still ends at the bottom of the screen
    expect(b.y + b.h).toBe(800);
    // a third steps once more
    const three = openWin(two, "sound", band.tracks[2].id, undefined, screen);
    expect([three.windows[2].x, three.windows[2].y]).toEqual([a.x - 2 * STEP_X, a.y + 2 * STEP_Y]);
  });
  it("opens at its own first place when the first was moved away, or closed", () => {
    const one = openWin(session(), "sound", band.tracks[0].id, undefined, screen);
    const moved = { ...one, windows: one.windows.map((w) => ({ ...w, x: 300, y: 200 })) };
    expect(openWin(moved, "sound", band.tracks[1].id, undefined, screen).windows[1].x).toBe(1280 - SOUND_W);
    const closed = { ...one, windows: one.windows.map((w) => ({ ...w, open: false })) };
    expect(openWin(closed, "sound", band.tracks[1].id, undefined, screen).windows[1].y).toBe(TOP_H);
  });
  it("a window that was open before comes back where it was left, whatever stands there", () => {
    const one = openWin(session(), "sound", band.tracks[0].id, undefined, screen);
    const two = openWin(one, "sound", band.tracks[1].id, undefined, screen);
    const back = { ...two, windows: two.windows.map((w, i) => (i === 1 ? { ...w, x: two.windows[0].x, y: two.windows[0].y, open: false } : w)) };
    const again = openWin(back, "sound", band.tracks[1].id, undefined, screen).windows.find((w) => w.track === band.tracks[1].id)!;
    expect([again.x, again.y]).toEqual([two.windows[0].x, two.windows[0].y]);
  });
  it("composers go on sharing their place (one is brought forward at a time)", () => {
    const one = openWin(session(), "compose", band.tracks[0].id, undefined, screen);
    const two = openWin(one, "compose", band.tracks[1].id, undefined, screen);
    expect([two.windows[1].x, two.windows[1].y]).toEqual([two.windows[0].x, two.windows[0].y]);
  });
  it("stops stepping where a window would be too low to use, or would leave the lanes", () => {
    const r = { x: PANEL_W, y: 100, w: 420, h: 300 };
    // no room to the left: it only goes down
    expect(clearOf(r, [r], { panel: PANEL_W, h: 800 })).toEqual({ x: PANEL_W, y: 100 + STEP_Y, w: 420, h: 300 });
    // too low a screen to step down: it stays
    const low = { x: 800, y: 0, w: 420, h: MIN_H };
    expect(clearOf(low, [low], { panel: PANEL_W, h: MIN_H })).toEqual(low);
  });
});

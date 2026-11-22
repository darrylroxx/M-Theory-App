import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addTrack, resizeClip, setTrack, songEnd } from "../../timeline/edit";
import type { AudioClip, AudioTrack, Session, Take5, TimelineSong } from "../../timeline/model";
import { TakeBlock } from "./draw";
import { Menu, type MenuItem } from "./Menu";
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

  it("a track's input chip says its input, or its pair; with the interface open it has a small meter, two for a pair", () => {
    const paired = setTrack<AudioTrack>(addTrack(song, "audio", "t-blank"), "t-blank", { input: { ch: 2, pair: true } });
    const five = setTrack<AudioTrack>(paired, FIX.vocal, { input: { ch: 4 } });
    const closed = view(five);
    expect(closed).toContain('aria-label="Input of Audio 1: 3+4"');
    expect(closed).toMatch(/title="Which inputs it records: these two, in stereo"[^>]*>3\+4</);
    expect(closed).toMatch(/aria-label="Input of [^"]*: 5"/);
    expect(closed).not.toContain("tlh-meter");
    const open = view(five, {}, { inputs: { count: 8, level: () => 0.5, meters: true } });
    const chips = open.split('class="tlh-in ').slice(1).map((c) => c.slice(0, c.indexOf("</button>")));
    expect(chips.map((c) => count(c, 'class="tlh-meter"'))).toEqual([1, 2]);
  });

  it("the top bar's monitor control is left out where there is none to choose (a browser), and ● stays", () => {
    const { setMonitor: _m, ...plain } = record;
    const out = view(song, {}, { top: top({ record: plain }) });
    expect(out).toContain('aria-label="Record"');
    expect(out).not.toContain("tlv-mon");
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

describe("a recorded clip, drawn", () => {
  const take = (o: Partial<Take5> = {}): Take5 => ({ id: "k", n: 2, group: "g", dry: "d.wav", wet: "w.wav", rate: 48000, start: 0, frames: 96000, at: 0, ...o });
  const clip: AudioClip = { id: "c", track: "t", kind: "audio", take: "k", start: 0, from: 0, to: 96000, off: 0, frames: 96000 };
  const block = (k: Take5, c: AudioClip, l?: Float32Array, r?: Float32Array) => renderToStaticMarkup(createElement(TakeBlock, { clip: c, take: k, peaks: l, peaksR: r, ppb: 20, bpm: 120 }));
  const left = Float32Array.from([0.2, 0.9, 0.4]);
  const right = Float32Array.from([0.1, 0.1, 0.8]);

  it("a take from one input is one waveform, as before", () => {
    const html = block(take(), clip, left);
    expect(count(html, "<svg")).toBe(1);
    expect(html).toContain('class="tlc-take"');
    expect(html).toContain('class="tlc-wave"');
    expect(html).toContain("Take 2");
    // (the second file of a voice is stereo too: it is still drawn as one, the take says nothing of two channels)
    expect(count(block(take(), clip, left, right), "<svg")).toBe(1);
  });

  it("a stereo take is two waveforms, the left side over the right", () => {
    const html = block(take({ channels: 2 }), clip, left, right);
    expect(html).toContain('class="tlc-take stereo"');
    expect(count(html, "<svg")).toBe(2);
    expect(html.indexOf('class="tlc-wave left"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="tlc-wave right"')).toBeGreaterThan(html.indexOf('class="tlc-wave left"'));
    // each side its own picture
    const paths = [...html.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    expect(paths).toHaveLength(2);
    expect(paths[0]).not.toBe(paths[1]);
  });

  it("a stereo clip whose edge was dragged out repeats both sides; one split or trimmed shows that stretch of both", () => {
    // three seconds of a two-second take: the take comes round once more
    const html = block(take({ channels: 2 }), { ...clip, frames: 144000 }, left, right);
    expect(count(html, 'class="tlc-wave left"')).toBe(2);
    expect(count(html, 'class="tlc-wave right"')).toBe(2);
    // the second half alone (a split): each side is drawn from the middle of its picture on
    const half = block(take({ channels: 2 }), { ...clip, off: 48000, frames: 48000 }, left, right);
    expect([...half.matchAll(/viewBox="([\d.]+) /g)].map((m) => m[1])).toEqual(["1.500", "1.500"]);
  });

  it("a stereo take whose sound is not loaded yet is a plain block with its number", () => {
    const html = block(take({ channels: 2 }), clip);
    expect(count(html, "<svg")).toBe(0);
    expect(html).toContain("Take 2");
  });
});

describe("a menu line with live levels (a track's list of inputs)", () => {
  const menu = (items: MenuItem[]) => renderToStaticMarkup(createElement(Menu, { at: { x: 0, y: 0 }, items, label: "Input", onClose: nothing }));
  it("has one small meter for an input, two for a pair, and none on a line that has no level", () => {
    const html = menu([
      { title: "Records from" },
      { label: "In 1", on: true, run: nothing, levels: [() => 0.3] },
      { title: "Stereo pairs" },
      { label: "In 1+2", run: nothing, levels: [() => 0.3, () => 0.6] },
      { label: "In 5 (not there)", run: nothing },
      { sep: true },
      { label: "Audio setup…", run: nothing },
    ]);
    const lines = html.split('role="menuitem"').slice(1);
    expect(lines.map((l) => count(l, 'class="tlv-menu-lv"'))).toEqual([1, 2, 0, 0]);
    // (the tick of the line in force is the line's own, not the meters')
    expect(lines[0]).toContain("tlv-menu-item on");
    expect(html).toContain("In 5 (not there)");
  });
});

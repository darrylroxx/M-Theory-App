// The take list of the record window, drawn as text.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Shelved, Take5 } from "../../../timeline/model";
import { audioClip, audioTrack, chordsClip, take } from "../../../timeline/testsongs";
import { TakeList5, type TakeList5Props } from "./TakeList5";

/** an older recording of two passes, and a newer one of three: the second ★, the last stopped early */
const a1 = take("a1", 5, 8, { group: "ga", n: 1 });
const a2 = take("a2", 5, 8, { group: "ga", n: 2 });
const b1 = take("b1", 65, 8, { group: "gb", n: 1 });
const b2 = take("b2", 65, 8, { group: "gb", n: 2, keep: true });
const b3 = take("b3", 9, 8, { group: "gb", n: 3, short: true });
const all = [a1, a2, b1, b2, b3];
const none = () => {};
const list = (o: Partial<TakeList5Props> = {}, takes: Take5[] = all) =>
  renderToStaticMarkup(createElement(TakeList5, {
    track: audioTrack("tv", "vocals", "Vocal 1", takes), clips: [chordsClip("c1", "tc", 0, 16), audioClip("x1", "tv", b2, 8)], alone: null, canHear: true, running: false,
    onHear: none, onKeep: none, onUse: none, onDrop: none, onRemove: none, onShelfUse: none, onEmpty: none, ...o,
  }));
/** the rows of takes, in the order drawn: [the take's id, its row's markup] */
const rows = (html: string) => [...html.matchAll(/<div data-take="([^"]+)"[\s\S]*?(?=<div data-take=|<div class="tb-group"|<div class="tb-shelf"|$)/g)].map((m) => [m[1], m[0]] as const);
const count = (html: string, what: RegExp) => (html.match(what) ?? []).length;

describe("the take list", () => {
  it("groups the takes by recording, the newest recording first, its passes as they were sung", () => {
    const html = list();
    expect([...html.matchAll(/aria-label="Recording (\d+)"/g)].map((m) => m[1])).toEqual(["2", "1"]);
    expect(rows(html).map(([id]) => id)).toEqual(["b1", "b2", "a1", "a2"]);
    // each recording says how many takes it has, the hidden short one counted, and can be removed whole
    expect(html).toContain("3 takes");
    expect(html).toContain("2 takes");
    expect(count(html, /aria-label="Remove this recording"/g)).toBe(2);
    // a take's length, as minutes and seconds
    expect(html).toContain("1:05");
    expect(html).toContain("0:05");
  });

  it("shows ★ on the kept ones, and which take plays", () => {
    const by = new Map(rows(list()));
    expect(by.get("b2")).toMatch(/class="icon-btn vc-keep on" aria-pressed="true"/);
    expect(by.get("b1")).toMatch(/class="icon-btn vc-keep" aria-pressed="false"/);
    // the take a clip of this track plays is marked, and its Use is lit
    expect(by.get("b2")).toMatch(/class="tb-take used"/);
    expect(by.get("b2")).toMatch(/class="btn sm tb-use on" aria-pressed="true"/);
    expect(by.get("a1")).toMatch(/class="btn sm tb-use" aria-pressed="false"/);
  });

  it("hides short takes until they are asked for; one that is ★ or plays is always there", () => {
    expect(rows(list()).map(([id]) => id)).not.toContain("b3");
    // (the switch is offered because there is a short one)
    expect(list()).toContain("Short takes");
    expect(rows(list({ shorts: true })).map(([id]) => id)).toEqual(["b1", "b2", "b3", "a1", "a2"]);
    expect(new Map(rows(list({ shorts: true }))).get("b3")).toContain("Take 3 ·");
    const kept = all.map((k) => (k.id === "b3" ? { ...k, keep: true } : k));
    expect(rows(list({}, kept)).map(([id]) => id)).toContain("b3");
    expect(rows(list({ clips: [audioClip("x1", "tv", b3, 8)] })).map(([id]) => id)).toContain("b3");
    // no short take, no switch
    expect(list({}, [a1, a2])).not.toContain("Short takes");
  });

  it("kept only: the ★ takes, and a recording with none says so", () => {
    const html = list({ starOnly: true });
    expect(rows(html).map(([id]) => id)).toEqual(["b2"]);
    expect(html).toContain("No ★ takes");
  });

  it("a take that lies nowhere says so, and offers Use to lay it at the cursor", () => {
    const loose = all.map((k) => (k.group === "ga" ? { ...k, at: null } : k));
    const by = new Map(rows(list({}, loose)));
    expect(by.get("a1")).toContain("not placed");
    expect(by.get("a1")).toMatch(/aria-label="Use take 1" title="Lay this take at the cursor/);
    expect(by.get("b1")).not.toContain("not placed");
    expect(by.get("b1")).toMatch(/aria-label="Use take 1" title="This take plays here/);
    // every take can be heard, ★ed, used and deleted
    for (const [, row] of by) {
      expect(row).toMatch(/aria-label="Hear take \d alone"/);
      expect(row).toMatch(/aria-label="Keep take \d ★"/);
      expect(row).toMatch(/aria-label="Use take \d"/);
      expect(row).toMatch(/aria-label="Delete take \d"/);
    }
  });

  it("where takes cannot be heard there is no ▶; while a recording runs nothing can be deleted or removed", () => {
    expect(list({ canHear: false })).not.toContain("tb-play");
    const busy = list({ running: true });
    expect(count(busy, /aria-label="Delete take \d"[^>]*disabled=""/g)).toBe(4);
    expect(count(busy, /aria-label="Remove this recording"[^>]*disabled=""/g)).toBe(2);
    expect(count(list(), /disabled=""/g)).toBe(0);
  });

  it("the keys of the list are its own (Space hears the selected take)", () => {
    expect(list()).toMatch(/class="tb-list" role="listbox" aria-label="Takes" tabindex="0" data-keys="takes"/);
  });

  it("the take of the clip selected on the lane is the one selected in the list", () => {
    expect(list()).not.toContain('aria-selected="true"');
    const by = new Map(rows(list({ pick: "a2" })));
    expect(by.get("a2")).toMatch(/role="option" aria-selected="true" class="tb-take sel"/);
    expect(by.get("a1")).toMatch(/aria-selected="false"/);
  });
});

describe("removed recordings", () => {
  const shelf: Shelved[] = [{ track: "gone", name: "Vocal 2", kind: "vocals", takes: [take("s1", 4, null, { group: "gs", n: 1 }), take("s2", 4, null, { group: "gs", n: 2, keep: true })], at: 2, saves: 0 }];

  it("are shown only when there are some", () => {
    expect(list()).not.toContain("Removed recordings");
    expect(list({ shelf: [] })).not.toContain("Removed recordings");
    expect(list({ shelf: [{ ...shelf[0], takes: [] }] })).not.toContain("Removed recordings");
    const html = list({ shelf });
    expect(html).toContain("Removed recordings");
    expect(html).toContain("Vocal 2");
    // each can be heard and used on this track; the lot can be emptied
    expect(count(html, /aria-label="Use take \d of Vocal 2 on Vocal 1"/g)).toBe(2);
    expect(count(html, /aria-label="Hear take \d of Vocal 2 alone"/g)).toBe(2);
    expect(count(html, /aria-label="Empty the removed recordings"/g)).toBe(1);
    expect(html).toContain("Take ★2");
  });

  it("are there on a track with nothing recorded on it yet; with neither takes nor a shelf nothing is drawn", () => {
    const html = list({ shelf }, []);
    expect(html).toContain("Removed recordings");
    expect(html).not.toContain('role="listbox"');
    expect(list({}, [])).toBe("");
  });
});

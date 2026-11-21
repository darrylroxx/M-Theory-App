import { describe, expect, it } from "vitest";
import { ESC_OPEN, ESC_VIEW, ESC_WINDOW, keyAction, onEscape, runEscape, type KeyAction, type Where } from "./keys";

const k = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean }> = {}) => ({ key, ctrl: false, shift: false, alt: false, repeat: false, ...mods });
const on = (key: string, mods: Parameters<typeof k>[1] = {}, where: Where = "timeline", desktop = true) => keyAction(k(key, mods), where, desktop);

/** every row of the key table: the key, what is held, and what it does */
const TABLE: [string, Parameters<typeof k>[1], KeyAction][] = [
  [" ", {}, "play"],
  ["Home", {}, "home"],
  ["End", {}, "end"],
  ["ArrowLeft", {}, "left"],
  ["ArrowRight", {}, "right"],
  ["ArrowLeft", { shift: true }, "left-beat"],
  ["ArrowRight", { shift: true }, "right-beat"],
  ["l", {}, "loop"],
  ["r", {}, "loop"],
  ["r", { ctrl: true }, "record"],
  ["s", {}, "split"],
  ["Delete", {}, "delete"],
  ["Backspace", {}, "delete"],
  ["0", {}, "mute"],
  ["c", { ctrl: true }, "copy"],
  ["x", { ctrl: true }, "cut"],
  ["v", { ctrl: true }, "paste"],
  ["d", { ctrl: true }, "duplicate"],
  ["a", { ctrl: true }, "select-all"],
  ["v", { ctrl: true, shift: true }, "paste-insert"],
  ["Delete", { ctrl: true, shift: true }, "cut-time"],
  ["Insert", {}, "insert-bar"],
  ["Insert", { shift: true }, "insert-loop"],
  ["z", { ctrl: true }, "undo"],
  ["z", { ctrl: true, shift: true }, "redo"],
  ["y", { ctrl: true }, "redo"],
  ["t", { ctrl: true }, "add-track"],
  ["s", { ctrl: true }, "save"],
  ["m", {}, "marker"],
  ["F2", {}, "rename"],
  ["+", { shift: true }, "zoom-in"],
  ["=", {}, "zoom-in"],
  ["-", {}, "zoom-out"],
  ["Enter", {}, "open"],
  ["Escape", {}, "escape"],
];

describe("the track view's keys", () => {
  it("every row of the table gives its action on the timeline", () => {
    for (const [key, mods, action] of TABLE) expect(on(key, mods), `${JSON.stringify(mods)} ${key}`).toBe(action);
  });

  it("letters work with Caps Lock on", () => {
    expect(on("S")).toBe("split");
    expect(on("L")).toBe("loop");
    expect(on("R")).toBe("loop");
    expect(on("M")).toBe("marker");
    expect(on("Z", { ctrl: true })).toBe("undo");
  });

  it("on a control, and inside a window, only play, undo, redo, save and Escape", () => {
    const got = new Set<KeyAction>();
    for (const [key, mods] of TABLE) {
      const a = on(key, mods, "control");
      if (a) got.add(a);
    }
    expect([...got].sort()).toEqual(["escape", "play", "redo", "save", "undo"]);
  });

  it("in a box to type in, Space types a space and Ctrl+Z is the box's own", () => {
    expect(on(" ", {}, "text")).toBeNull();
    expect(on("z", { ctrl: true }, "text")).toBeNull();
    expect(on("Delete", {}, "text")).toBeNull();
    expect(on("s", {}, "text")).toBeNull();
    expect(on("s", { ctrl: true }, "text")).toBe("save");
    expect(on("Escape", {}, "text")).toBe("escape");
  });

  it("in the list of takes Space is the list's own", () => {
    expect(on(" ", {}, "takes")).toBeNull();
    expect(on("z", { ctrl: true }, "takes")).toBe("undo");
    expect(on("Delete", {}, "takes")).toBeNull();
  });

  it("a key held down counts once, except the ones that step", () => {
    expect(on("Delete", { repeat: true })).toBeNull();
    expect(on("Backspace", { repeat: true })).toBeNull();
    expect(on(" ", { repeat: true })).toBeNull();
    expect(on("s", { repeat: true })).toBeNull();
    expect(on("d", { ctrl: true, repeat: true })).toBeNull();
    expect(on("ArrowRight", { repeat: true })).toBe("right");
    expect(on("=", { repeat: true })).toBe("zoom-in");
  });

  it("no key removes a track", () => {
    // every key and every way of holding it: none of the actions is about a track going
    const keys = [..."abcdefghijklmnopqrstuvwxyz0123456789", " ", "Delete", "Backspace", "Insert", "Home", "End", "Enter", "Escape", "F2", "ArrowLeft", "ArrowRight", "+", "-", "="];
    const all = new Set<string>();
    for (const key of keys)
      for (const ctrl of [false, true]) for (const shift of [false, true]) for (const alt of [false, true]) {
        const a = on(key, { ctrl, shift, alt });
        if (a) all.add(a);
      }
    expect([...all].filter((a) => /remove|track-del/.test(a))).toEqual([]);
    expect(all.has("add-track")).toBe(true);
    // and Delete with a track selected is still only "delete" (of clips, or of a marker)
    expect(on("Delete")).toBe("delete");
  });

  it("a browser keeps Ctrl+T and Ctrl+R for itself", () => {
    expect(on("t", { ctrl: true }, "timeline", false)).toBeNull();
    expect(on("r", { ctrl: true }, "timeline", false)).toBeNull();
    expect(on("t", { ctrl: true }, "timeline", true)).toBe("add-track");
    expect(on("r", { ctrl: true }, "timeline", true)).toBe("record");
    // R alone is the loop either way
    expect(on("r", {}, "timeline", false)).toBe("loop");
    expect(on("l", {}, "timeline", false)).toBe("loop");
  });

  it("keys with Alt are left alone", () => {
    expect(on("s", { alt: true })).toBeNull();
    expect(on("ArrowLeft", { alt: true })).toBeNull();
  });
});

describe("Escape does one thing per press", () => {
  it("the highest level is asked first, and whoever has nothing to do passes it on", () => {
    const said: string[] = [];
    let menu = true;
    let win = true;
    const offs = [
      onEscape(ESC_VIEW, () => (said.push("view"), true)),
      onEscape(ESC_WINDOW, () => (win ? ((win = false), said.push("window"), true) : false)),
      onEscape(ESC_OPEN, () => (menu ? ((menu = false), said.push("menu"), true) : false)),
    ];
    expect(runEscape()).toBe(true);
    expect(runEscape()).toBe(true);
    expect(runEscape()).toBe(true);
    expect(said).toEqual(["menu", "window", "view"]);
    offs.forEach((off) => off());
    expect(runEscape()).toBe(false);
  });
});

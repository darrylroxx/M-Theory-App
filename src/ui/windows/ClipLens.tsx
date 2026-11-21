// The old pages inside the track view. They were written against one app-wide state with "the section on screen".
// `ClipLens` gives them exactly that for one clip: a complete context of their own, in which the song is the lens
// song of the clip (see timeline/lens) and everything else is the real app's. What they change in the song is
// written back into the real one as one undo step; every other change (a rhythm saved to "Mine", the capo, a chosen
// shape, bars on screen) goes straight to the real state.
//
// `V4View` is the same with no clip: for the old components that are not composers (settings, bars on screen, the
// Canvas). Its song is empty and a change to it is dropped.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { grooveOf } from "../../audio/beats";
import { strum } from "../../audio/synth";
import { keysVoicing, onKeys, toneOf } from "../../audio/tone";
import { chordShape } from "../../guitar/arrange";
import type { ChordRef } from "../../theory/chords";
import { draftAnchor } from "../../timeline/edit";
import { lensOf, unlens, type Lens, type Target } from "../../timeline/lens";
import { CLIP_OF } from "../../timeline/model";
import { useApp5, type App5State, type Ctx5 } from "../app5";
import { AppCtx, DEFAULT_STATE, chordBeats, newId, shapeKey, type AppState, type Ctx, type Pane, type ProgChord, type Progression, type SavedProgression, type SheetState, type ToastAction } from "../state";

/** The fields of the old state that are the real app's own, passed through both ways. */
const PASS = ["key", "settings", "shapes", "myBeats", "myKits", "mySounds", "canvas", "studio", "view"] as const;
const NONE: SavedProgression[] = [];

/** An old song with nothing in it, at a tempo: what the old components see when there is no clip behind them. */
const empties = new Map<number, Progression>();
export function emptyV4(bpm: number): Progression {
  let p = empties.get(bpm);
  if (!p) {
    if (empties.size > 32) empties.clear();
    empties.set(bpm, (p = { ...DEFAULT_STATE.progression, bpm }));
  }
  return p;
}

/** The new state as the old pages know a state: `progression` is the song handed in; every other field is the real one. */
export function v4View(s: App5State, progression: Progression, pane: Pane = "rhythm"): AppState {
  return {
    tab: "guitar", pane, key: s.key, settings: s.settings, progression, saved: NONE,
    shapes: s.shapes, myBeats: s.myBeats, myKits: s.myKits, mySounds: s.mySounds,
    canvas: s.canvas, ideaId: s.ideaId, draft: s.draft, tombs: s.tombs, studio: s.studio, view: s.view,
  };
}
/** The same view back while nothing in it changed, so the pages are not drawn again for a change that is not theirs. */
function keeper() {
  let last: AppState | null = null;
  return (s: App5State, progression: Progression, pane: Pane): AppState => {
    const v = v4View(s, progression, pane);
    if (last && (Object.keys(v) as (keyof AppState)[]).every((k) => last![k] === v[k])) return last;
    last = v;
    return v;
  };
}

/** What changed in the fields that pass through: to be written to the real state as it is. */
export function passBack(before: AppState, after: AppState): Partial<App5State> {
  const patch: Partial<App5State> = {};
  for (const k of PASS) if (after[k] !== before[k]) (patch as Record<string, unknown>)[k] = after[k];
  return patch;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
/**
 * A name for what a change of the lens song came from, when it is the kind of change a held control makes many of
 * in a row (a knob of the sound, of the feel, of the kit; a chord's length dragged): those fold into one undo step.
 * Anything written (a chord, a note, a drum hit, a rhythm picked) is a step of its own.
 */
export function controlOf(before: Progression, after: Progression, track: string): string | undefined {
  const keys = (Object.keys({ ...before, ...after }) as (keyof Progression)[]).filter((k) => before[k] !== after[k]);
  if (!keys.length) return undefined;
  const smooth = new Set<keyof Progression>(["sound", "tuneSound", "tones", "feel", "mix"]);
  if (keys.every((k) => smooth.has(k))) return `lens:${track}:${keys.join()}`;
  if (keys.length === 1 && keys[0] === "beat" && before.beat && after.beat && same(grooveOf(before.beat), grooveOf(after.beat))) return `lens:${track}:kit`;
  if (keys.length === 1 && keys[0] === "chords" && before.chords.length === after.chords.length && before.chords.every((c, i) => c.id === after.chords[i].id && same(c.ref, after.chords[i].ref) && !!c.rest === !!after.chords[i].rest && c.voicingId === after.chords[i].voicingId)) return `lens:${track}:lengths`;
  return undefined;
}

/** What a composer's own parts may want to know about the lens they are in. */
export interface LensInfo {
  lens: Lens;
  target: Target;
  /** the open track's id as the lens song names it ("chords" when it is the song's lead chords, "melody" for its top melody) */
  openId: string;
}
const LensCtx = createContext<LensInfo | null>(null);
/** The lens this component is inside (null: none, as inside `V4View`). */
export const useLens = (): LensInfo | null => useContext(LensCtx);

/** The lens of a target in a state (null: its clip or track is gone). */
export function lensIn(s: App5State, target: Target): Lens | null {
  return lensOf(s.song, target, s.key, draftAnchor(s.song, s.session));
}

/**
 * `set` as the old pages call it, on a target: `fn` runs on the old view of the state as it is this moment; a changed
 * song goes back through `unlens` as one undo step; every other changed field is written to the real state as it is.
 * `onFrame`: a page asked for the old Frame page (its key chip): there is none; the host shows the key instead.
 */
export function lensSet(app: Pick<Ctx5, "peek" | "set" | "edit">, target: Target | null, pane: Pane, fn: (s: AppState) => AppState, onFrame?: () => void): void {
  const s = app.peek();
  const lens = target ? lensIn(s, target) : null;
  const before = v4View(s, lens ? lens.p : emptyV4(s.song.bpm), pane);
  const after = fn(before);
  if (after === before) return;
  if (lens && target && after.progression !== before.progression) {
    const track = s.song.tracks.find((t) => t.id === target.track);
    const made = after.progression;
    app.edit(`Edit ${track?.name ?? "track"}`, (song) => {
      // (worked out against the song as it is when the change is made: the lens of the same target in it)
      const now = song === s.song ? lens : lensOf(song, target, s.key, draftAnchor(song, s.session));
      return now ? unlens(song, target, now, made, newId) : song;
    }, controlOf(before.progression, made, target.track));
  }
  const patch = passBack(before, after);
  if (Object.keys(patch).length) app.set((x) => ({ ...x, ...patch }));
  if (after.pane === "frame" && before.pane !== "frame") onFrame?.();
}

function useV4(target: Target | null, pane: Pane, onFrame?: () => void): { ctx: Ctx; info: LensInfo | null } | null {
  const app = useApp5();
  const { state } = app;
  const lens = target ? lensIn(state, target) : null;
  const [sheet, openSheet] = useState<SheetState | null>(null);
  const keep = useMemo(keeper, []);
  const view = keep(state, lens ? lens.p : emptyV4(state.song.bpm), pane);
  // (the functions below read what is current through these, so they are the same functions from one draw to the next)
  const live = useRef({ app, target, pane, onFrame, lens });
  live.current = { app, target, pane, onFrame, lens };

  const set = useCallback((fn: (s: AppState) => AppState) => {
    const l = live.current;
    lensSet(l.app, l.target, l.pane, fn, l.onFrame);
  }, []);
  const toast = useCallback((msg: string, action?: ToastAction) => {
    const l = live.current;
    if (!action) return l.app.toast(msg);
    // (an old page's `when` reads the old state: it is given the old view of the new one, never the new one itself)
    const when = action.when;
    l.app.toast(msg, {
      label: action.label, aria: action.aria, run: action.run, ms: action.ms,
      ...(when ? { when: (s5: App5State) => {
        try {
          const now = l.target ? lensIn(s5, l.target) : null;
          return when(v4View(s5, now ? now.p : emptyV4(s5.song.bpm), l.pane));
        } catch {
          return false;
        }
      } } : {}),
    });
  }, []);
  const { capo, avoidBarre, tuningId } = state.settings;
  const { tuning } = app;
  const shapes = state.shapes;
  const shapeOf = useCallback(
    (ref: ChordRef, slotVoicingId?: string) => chordShape(ref, tuning, capo, avoidBarre, slotVoicingId, shapes[shapeKey(ref, tuningId, capo)]),
    [shapes, tuning, tuningId, capo, avoidBarre],
  );
  const setShape = useCallback((ref: ChordRef, voicingId: string) => live.current.app.set((s) => ({ ...s, shapes: { ...s.shapes, [shapeKey(ref, s.settings.tuningId, s.settings.capo)]: voicingId } })), []);
  // a chords track on the keys is heard as the keyboard plays it, in its own voicing
  const p = view.progression;
  const keysTone = useMemo(() => {
    const t = toneOf(p, p.focus?.chords ?? "chords");
    return onKeys(t) ? t : null;
  }, [p]);
  const audition = useCallback((ref: ChordRef) => {
    if (keysTone) return strum(keysVoicing(ref, keysTone));
    const v = shapeOf(ref);
    if (v) strum(v.midi);
  }, [shapeOf, keysTone]);
  const addChord = useCallback((ref: ChordRef, opts: { voicingId?: string; afterId?: string } = {}) => {
    set((s) => {
      const item: ProgChord = { id: newId(), ref, beats: chordBeats(s.progression), voicingId: opts.voicingId };
      const chords = [...s.progression.chords];
      const at = opts.afterId ? chords.findIndex((c) => c.id === opts.afterId) : -1;
      if (at >= 0) chords.splice(at + 1, 0, item);
      else chords.push(item);
      return { ...s, progression: { ...s.progression, chords } };
    });
  }, [set]);
  const real = app.idea;
  const idea = useMemo<SavedProgression | null>(() => (real ? { id: real.id, name: real.name, key: real.key, progression: emptyV4(real.song.bpm), savedAt: real.savedAt, updatedAt: real.updatedAt, capo: real.capo, tuningId: real.tuningId } : null), [real]);
  const importIdeas = useCallback((ideas: SavedProgression[]) => live.current.app.importIdeas(JSON.stringify({ ideas })), []);
  const { dirty, opened, saveIdea, openIdea, newIdea, renameIdea, deleteIdea, cloud, syncNow, recordingTo, setRecordingTo } = app;
  const ctx = useMemo<Ctx>(
    () => ({ state: view, set, tuning, sheet, openSheet, toast, audition, shapeOf, setShape, addChord, idea, dirty, saveIdea, openIdea, newIdea, opened, renameIdea, deleteIdea, importIdeas, cloud, syncNow, recordingTo, setRecordingTo }),
    [view, set, tuning, sheet, toast, audition, shapeOf, setShape, addChord, idea, dirty, saveIdea, openIdea, newIdea, opened, renameIdea, deleteIdea, importIdeas, cloud, syncNow, recordingTo, setRecordingTo],
  );
  const track = target ? state.song.tracks.find((t) => t.id === target.track) : undefined;
  const info = useMemo<LensInfo | null>(() => {
    if (!lens || !target || !track || track.kind === "vocals" || track.kind === "audio") return null;
    const kind = CLIP_OF[track.kind] as "chords" | "melody" | "drums";
    return { lens, target, openId: lens.p.focus?.[kind] ?? (kind === "drums" ? track.id : kind) };
  }, [lens, target, track]);
  if (target && !lens) return null;
  return { ctx, info };
}

/**
 * One clip (or a track with nothing on it yet) as the old pages' whole world. Renders nothing when the clip or its
 * track is gone. `pane`: which old page is shown inside. `onFrame`: a page asked for the old Frame page.
 */
export function ClipLens({ target, pane = "rhythm", onFrame, children }: { target: Target; pane?: Pane; onFrame?: () => void; children: ReactNode }) {
  const made = useV4(target, pane, onFrame);
  if (!made) return null;
  return (
    <AppCtx.Provider value={made.ctx}>
      <LensCtx.Provider value={made.info}>{children}</LensCtx.Provider>
    </AppCtx.Provider>
  );
}

/** The old components that are not composers, given the real settings, view, canvas and studio; a change to the song is dropped. */
export function V4View({ children }: { children: ReactNode }) {
  const made = useV4(null, "track");
  if (!made) return null;
  return <AppCtx.Provider value={made.ctx}>{children}</AppCtx.Provider>;
}

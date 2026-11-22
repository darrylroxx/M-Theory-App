// The recording engine of the desktop app, owned by one hook. The host of the track view mounts `useEngine` once,
// for good: it finds the interface, opens and closes it (see audio/handoff for when), hands it over to the app's own
// sound, sends the app's sound through it while you hear yourself through the effects, runs Record and Rehearse, and
// takes a recording back when the driver is reset in the middle of one. So none of that depends on a window being
// open: a recording goes on with the record window closed, and so does hearing yourself through the effects.
//
// What the engine reports about thirty times a second (levels, where the music is, dropouts, the measured delay) is
// published to one small store, `engineStatus`, that every readout reads: the input meters, the LIMIT lamp of the
// vocal sound, the Audio part of the settings, the record window. Nothing is drawn again for a report.
//
// The code is the old Vocals page's (components/VocalsPage, its host mode), moved. One thing is put right on the
// way: the interface is opened only once the close asked for before it has been done (`makeDoor`). The page sent
// the close after the open that followed it, whenever it closed and opened in one go (another buffer size, another
// interface, a driver reset), and the engine closes whatever is open when it is told to close: the interface ended
// closed while the screen showed it open.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Beat } from "../../audio/beats";
import { Quiet, engineWanted, holdInterface, mayList } from "../../audio/handoff";
import { dbOf, meterPos } from "../../audio/levels";
import type { PatternId, PlayItem } from "../../audio/patterns";
import { renderSong } from "../../audio/synth";
import { hearingAlone, onAlone as onAloneChange, stopAlone } from "../../audio/takeplay";
import { comeBack, goThrough, noteGaps, type ThroughEngine } from "../../audio/through";
import { FX_DEFAULT, type VocalFx } from "../../audio/vocalfx";
import { audioDevices, engineApp, engineBacking, engineClose, engineFeed, engineOpen, engineSet, engineStart, engineStop, fxRender, isDesktop, type AudioHost, type EngineOpened, type EngineStatus } from "../../desktop";
import { clickPlan, passAt, passToMark, soundTag, toggled, type Recorded } from "../../song/takes";
import { useApp5 } from "../app5";
import { setLive } from "../live";
import type { Studio } from "../state";

/** What a recording goes round, and the song to play under it. */
export interface RecordPlan {
  items: PlayItem[];
  beats: number;
  beatsPerBar: number;
  bpm: number;
  pattern: PatternId;
  /** the drums the items fall back on (none: every track plays through the items themselves) */
  beat: Beat | null;
  label: string;
  /** every bar that goes round, in order, with the beats in it (the click accents each bar in its own time) */
  bars?: { beats: number }[];
  /** the song is played once, from the plan's first beat, and the recording goes on until it is stopped (none: round and round) */
  once?: boolean;
  /**
   * Everything the song under the recording is made from, as a text (timeline/record `backingKey`, and what the song is
   * flattened with). `skip`: the track being recorded, left out of it (null: a rehearsal, which leaves none out). While
   * it is the same as the last time, the song rendered then is played again, so a second take starts at once.
   */
  backing?(skip: string | null): string;
}

/** Where a recording is: nothing going, the song being made ready, singing along, recording, or its takes being saved. */
export type RecordPhase = "idle" | "preparing" | "rehearsing" | "recording" | "saving";

// ── the store every readout reads ───────────────────────────

/** A value that is published, with one list of those who read it. */
export interface Store<T> {
  /** the value published last */
  last(): T;
  publish(v: T): void;
  /** `fn` is told the last value at once, and every one after it; returns the way to stop */
  subscribe(fn: (v: T) => void): () => void;
  /** how many are reading */
  readonly size: number;
}
export function makeStore<T>(first: T): Store<T> {
  let value = first;
  const subs = new Set<(v: T) => void>();
  return {
    last: () => value,
    publish(v) {
      value = v;
      for (const f of [...subs]) f(v);
    },
    subscribe(fn) {
      subs.add(fn);
      fn(value);
      return () => void subs.delete(fn);
    },
    get size() {
      return subs.size;
    },
  };
}

/** What changes seldom: the interface as it opened, where a recording is. The same object until one of them changes. */
export interface EngineNow {
  /** the interface as it opened (null: it is closed) */
  opened: EngineOpened | null;
  phase: RecordPhase;
  /** the pass being recorded (0 in the count-in, and when nothing is) */
  pass: number;
  /** the track whose input and vocal sound the engine has: it is the one heard through the effects, and recorded onto */
  track: string | null;
  /** the tempo of what a recording or a rehearsal goes round (0: nothing runs) */
  bpm: number;
}
/** What the readouts read: the engine's last report (null while the interface is closed), and what changes seldom. */
export interface EngineReadout {
  st: EngineStatus | null;
  now: EngineNow;
}
const IDLE: EngineReadout = { st: null, now: { opened: null, phase: "idle", pass: 0, track: null, bpm: 0 } };
/** The engine's status, published by `useEngine`. A readout subscribes and writes what it shows itself. */
export const engineStatus: Store<EngineReadout> = makeStore(IDLE);
const subscribeNow = (cb: () => void) => engineStatus.subscribe(() => cb());
/** What changes seldom, for a component that is drawn with it (it is drawn again only when one of them changes). */
export function useEngineNow(): EngineNow {
  return useSyncExternalStore(subscribeNow, () => engineStatus.last().now, () => IDLE.now);
}

/** Until the driver's own figure is in: about how long a sound takes to go in and come back out at a buffer size. */
const roundTrip = (block: number, rate: number) => Math.round(((2 * block) / rate) * 1000 + 2);
/** A long session is noted from this many minutes on (small, beside the pass number). */
const LONG_MIN = 30;
/** Less than this much room on the disk is noted too (bytes). */
const LOW_DISK = 2e9;
/** And less than this many minutes before the file is as big as a WAV can be. */
const ROOM_MIN = 10;
const rateOf = (r: EngineReadout) => r.now.opened?.rate ?? 48000;

/** The big readout while the interface plays: the count-in, one number a beat, then "Pass 3". */
export function countText(r: EngineReadout): string {
  const st = r.st;
  if (!st || !st.running || !r.now.bpm) return "";
  if (st.pos < st.count_in) {
    // the count-in, once, at the very start: one number a beat
    const beatLen = (rateOf(r) * 60) / Math.max(1, r.now.bpm);
    return `${Math.ceil((st.count_in - st.pos) / beatLen)}`;
  }
  const going = r.now.phase === "recording" || r.now.phase === "rehearsing";
  // the song played once (it has no loop, so no passes): how long it has run, as m:ss
  if (going && !st.length) return clockText((st.pos - st.count_in) / rateOf(r));
  const at = going ? passAt(st.pos, st.count_in, st.length) : null;
  return at ? `Pass ${at.n}` : "";
}
/** Seconds as m:ss. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A rendered song made exactly `frames` long, to go round: what it holds past that (the last notes ringing on) comes
 * round again at the start, and where it is shorter the rest is silence. For a loop that reaches past the song's
 * end: the song is rendered to its end with its ring-out, and the bars after it are the silence they are.
 */
export function foldRound(ch: readonly Float32Array[], frames: number): Float32Array[] {
  const n = Math.max(1, Math.round(frames));
  return ch.map((d) => {
    const out = new Float32Array(n);
    out.set(d.length > n ? d.subarray(0, n) : d);
    for (let i = n; i < d.length; i++) out[(i - n) % n] += d[i];
    return out;
  });
}
/** Small notes for a long session: how long it has run, and what room is left (the most pressing first). `warn`: one of them needs heeding. */
export function sessionNotes(r: EngineReadout): { text: string; warn: boolean } {
  const st = r.st;
  if (!st) return { text: "", warn: false };
  const rate = rateOf(r);
  const rec = r.now.phase === "recording";
  const min = st.running && rec ? st.pos / rate / 60 : 0;
  const warns: string[] = [];
  if (rec && st.room != null && st.recorded && st.room / rate < ROOM_MIN * 60) warns.push(`${Math.max(0, Math.floor(st.room / rate / 60))} min left`);
  if (rec && st.free != null && st.free < LOW_DISK) warns.push(`${(st.free / 1e9).toFixed(1)} GB free`);
  const notes = warns.length ? [`⚠ ${warns.join(" · ")}`] : [];
  if (min >= LONG_MIN) notes.push(`${Math.floor(min)} min`);
  return { text: notes.join(" · "), warn: warns.length > 0 };
}
/** How late you hear yourself: measured by the driver, or (until its figure is in) worked out from the buffer size. */
export function delayText(r: EngineReadout): string {
  const st = r.st;
  if (!st || !st.block) return "";
  return st.latency > 0 ? `${st.latency.toFixed(1)} ms` : `~${roundTrip(st.block, rateOf(r))} ms`;
}
/** Dropouts since the interface was opened: moments the computer could not keep up at this buffer size. */
export const dropoutText = (st: Pick<EngineStatus, "xruns">): string => (st.xruns ? `${st.xruns} dropout${st.xruns === 1 ? "" : "s"}` : "no dropouts");

// ── the desktop app's calls, and the order of open and close ─

/** The desktop app's side, as the engine uses it (a test hands in a pretend one). */
export interface Bridge {
  audioDevices: typeof audioDevices;
  engineOpen: typeof engineOpen;
  engineClose: typeof engineClose;
  engineSet: typeof engineSet;
  engineBacking: typeof engineBacking;
  engineStart: typeof engineStart;
  engineStop: typeof engineStop;
  fxRender: typeof fxRender;
  engineApp: typeof engineApp;
  engineFeed: typeof engineFeed;
}
export const DESKTOP: Bridge = { audioDevices, engineOpen, engineClose, engineSet, engineBacking, engineStart, engineStop, fxRender, engineApp, engineFeed };

/**
 * Opening and closing the interface, in the order they were asked for: an open always waits for the close that was
 * asked for before it. (Closing takes a moment: the app's own sound, if it came through the engine, is faded back to
 * the computer's sound first. Without the wait, an open asked for in the same breath reached the engine first and
 * the close then shut what had just been opened.)
 */
export interface Door {
  open(host: string, device: string, buffer: number | null, onStatus: (s: EngineStatus) => void): Promise<EngineOpened>;
  /** close it; a recording still going comes back through `salvage`; then `closed` is told */
  close(): Promise<void>;
  /** done once every close asked for so far is */
  settled(): Promise<void>;
}
export function makeDoor(bridge: Pick<Bridge, "engineOpen" | "engineClose">, o: { comeBack(): Promise<void>; salvage(r: Recorded): void; closed(): void }): Door {
  let closing: Promise<void> = Promise.resolve();
  return {
    open: (host, device, buffer, onStatus) => closing.then(() => bridge.engineOpen(host, device, buffer, onStatus)),
    close() {
      // the app's own sound, if it came through the engine, goes back to the computer's sound first, faded out of the
      // engine, and then the engine closes: never cut off mid-sound (see through.ts; at once when it did not come through).
      // It is asked to come back in this very breath, as the page asked it: whoever asks first is the one that waits
      // for the fade, and this close must be that one.
      const back = o.comeBack();
      back.catch(() => {});
      closing = closing
        .then(() => back)
        .then(() => bridge.engineClose())
        .then((r) => void (r && o.salvage(r)), () => {})
        .then(() => o.closed());
      return closing;
    },
    settled: () => closing,
  };
}

/**
 * The recording begun last, claimed by whichever hands it over first (a stop, or a close after the driver reset):
 * what it went round and on which track. Only that recording, and only once; an older one handed back stays on disk,
 * untouched.
 */
export class Claims<P, T> {
  /** what the recording (or the rehearsal) begun last goes round */
  plan: P | null = null;
  private track: T | null = null;
  /** it has been cut into takes (it is never saved twice, nor lost between a stop and a reset) */
  private saved = true;
  /** its file, as the engine named it: a recording handed back is kept only if it is this one */
  private path: string | null = null;
  /** counts every start: work left over from an earlier recording never touches a later one */
  session = 0;

  begin(plan: P, track: T | null, record: boolean): void {
    this.plan = plan;
    this.track = track;
    this.saved = !record;
    this.path = null;
    this.session += 1;
  }
  /** the engine has started, and named the file */
  started(path: string | null): void {
    this.path = path;
  }
  claim(r: Pick<Recorded, "dry">): { plan: P; track: T; session: number } | null {
    if (this.saved || !this.plan || !this.track || r.dry !== this.path) return null;
    this.saved = true;
    return { plan: this.plan, track: this.track, session: this.session };
  }
}

// ── the hook ────────────────────────────────────────────────

/** The track the engine is on, as the host knows it. */
export interface EngineTrack {
  id: string;
  name: string;
  /** which input it records (0 = Input 1); of a pair of inputs, the first: the left side */
  input: number;
  /** the second input of a pair, the right side (none: one input, as a voice has) */
  inputB?: number;
  /** its vocal sound */
  fx: VocalFx;
}
/** An interface that can record and play: which audio system it is in, its own name, and how many inputs it has. */
export interface EngineDevice { host: string; name: string; channels: number }

/** What the host of the track view hands the engine. */
export interface EngineHost {
  /** a window that needs the interface is on screen: the record window, or the Audio part of the settings (handoff.ts `windowWants`) */
  active: boolean;
  /** the song is playing in the app (not through the interface) */
  playing: boolean;
  /** the track whose input and sound the engine has (null: the song has no track that records) */
  track: EngineTrack | null;
  /** that track is heard without its effects just now (its bypass): then so is the voice in the headphones */
  bypassed?: boolean;
  /** K keeps a pass: the record window has the keys, or a recording runs and no other window has them */
  keys: boolean;
  /** what a recording goes round */
  plan(): RecordPlan | null;
  /**
   * A finished recording: the host cuts it into takes and lays it on the track. `plan`: the very plan it was begun
   * with; `track`: the track it was begun on; `lead`: words to say first (a recording kept through a reset of the interface).
   */
  onRecorded(r: Recorded, o: { kept: number[]; sound: string; plan: RecordPlan; track: string; lead?: string }): void;
  /** a recording or a rehearsal began (the song stops, and cannot be played meanwhile), or ended */
  onRecording(on: boolean): void;
}

/** What the host and the windows get back. The functions are the same ones from one draw to the next. */
export interface EngineApi {
  desktop: boolean;
  /** every audio system and its devices (null: still looking) */
  hosts: AudioHost[] | null;
  /** the interfaces that can record and play, the one to use first */
  devices: EngineDevice[];
  chosen: EngineDevice | undefined;
  opened: EngineOpened | null;
  error: string | null;
  phase: RecordPhase;
  /** the pass being recorded */
  pass: number;
  /** the passes marked ★ in this recording */
  marks: ReadonlySet<number>;
  /** a pass just marked with K, shown for a moment */
  flash: number;
  /** may Record and Rehearse be pressed? (Also before the interface is open: it is waited for.) */
  ready: boolean;
  /** you hear yourself through the effects */
  monitor: boolean;
  /** what runs (or ran last) plays the song once: it has no passes, and goes on until it is stopped */
  once: boolean;
  /** the song under what is being made ready was kept from the last time: it starts at once, with nothing to wait for */
  again: boolean;
  record(): void;
  rehearse(): void;
  stop(): void;
  /** start recording onto the engine's track, or stop the recording that runs */
  toggle(): void;
  /** record onto this track, once it is the engine's (the top bar's ●) */
  start(track: string): void;
  mark(n: number, on?: boolean): void;
  /** K: keep the pass being sung, or, in its first moments, the one that has just ended */
  markNow(): void;
  /** while the song goes round under a recording or a rehearsal: which pass it is in (from 1) and how far into it (0..1) */
  at(): { n: number; frac: number } | null;
  /** while a recording or a rehearsal runs: the seconds since the song's first frame (null in the count-in, and when nothing runs) */
  since(): number | null;
  /** how loud an input is right now, 0 to 1 on the meter (0 while the interface is closed) */
  level(ch: number): number;
  /** what the recording (or rehearsal) that runs goes round */
  running(): RecordPlan | null;
  /** look for the interfaces again (one was plugged in) */
  relist(): void;
}

const sig = (fx: VocalFx) => JSON.stringify(fx);
const NO_STUDIO: Studio = {};
/** the interfaces found, kept for the session: listing them loads every driver in turn, which can upset one that is playing */
let listed: AudioHost[] | null = null;
/** the engine's side of the app's own sound going through it (see audio/through.ts) */
const THROUGH: ThroughEngine = { start: (rate) => engineApp(rate), feed: engineFeed, stop: () => engineApp(null) };
/** The first moments of a pass in which K marks the pass that has just ended: at most this long (s), and at most an eighth of the pass. */
const GRACE_S = 2;
/** a rehearsal being made ready over an idea that was left meanwhile: it does not start */
const LEFT = new Error("left");
/** Only a box that takes words keeps K to itself: a slider, a tick box or a list touched mid-session must not stop K from keeping a pass. */
const TEXT_INPUTS = new Set(["text", "number", "search", "email", "url", "password", "tel"]);
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && ((el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type)) || el.tagName === "TEXTAREA" || el.isContentEditable);

/** The interfaces that can record and play, out of everything the computer has: the low-latency driver first. */
export function devicesOf(hosts: AudioHost[] | null): EngineDevice[] {
  return (hosts ?? [])
    .flatMap((h) => h.devices.filter((d) => (d.input?.channels ?? 0) > 0 && (d.output?.channels ?? 0) > 0).map((d) => ({ host: h.name, name: d.name, channels: d.input!.channels })))
    .sort((a, b) => Number(b.host.toUpperCase() === "ASIO") - Number(a.host.toUpperCase() === "ASIO") || Number(/focusrite|scarlett/i.test(b.name)) - Number(/focusrite|scarlett/i.test(a.name)));
}

/**
 * The recording engine. Mounted once, by the host of the track view.
 *
 * Recording is made for staying in the flow: the loop goes round and round, as long as the singer wants, until ■.
 * Every pass already sung can be kept ★ (or K). Nothing pops up and nothing moves while singing.
 */
export function useEngine(host: EngineHost): EngineApi {
  const { state, set, toast, setRecordingTo, opened: idea } = useApp5();
  const studio = state.studio ?? NO_STUDIO;
  const setStudio = (patch: Partial<Studio>) => set((s) => ({ ...s, studio: { ...s.studio, ...patch } }));
  const { active, playing, track } = host;
  const fx: VocalFx = track?.fx ?? FX_DEFAULT;
  const desktop = isDesktop();

  const [hosts, setHosts] = useState<AudioHost[] | null>(listed);
  const [opened, setOpened] = useState<EngineOpened | null>(null);
  const openedRef = useRef<EngineOpened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RecordPhase>("idle");
  /** a recording or a rehearsal is on, or about to be (the interface is being waited for) */
  const [recording, setRecording] = useState(false);
  const [once, setOnce] = useState(false);
  const [again, setAgain] = useState(false);
  /** the song rendered last, with the text that says what it was made from (see `RecordPlan.backing`) */
  const lastRender = useRef<{ key: string; ch: Float32Array[] } | null>(null);
  /** the inputs told to the engine last (null: none yet since the interface opened) */
  const sent = useRef<{ input: number; inputB: number | null } | null>(null);
  const rate = useRef(48000);
  /** each input's level as the interface last reported it */
  const peaks = useRef<number[]>([]);
  const claims = useRef<Claims<RecordPlan, EngineTrack> | null>(null);
  claims.current ??= new Claims();
  // ── the flow while recording ──
  /** the pass being sung (0 in the count-in, or when not recording); it changes once a pass */
  const [pass, setPass] = useState(0);
  /** passes marked ★ in this recording */
  const [marks, setMarks] = useState<Set<number>>(() => new Set());
  const marksRef = useRef(marks);
  marksRef.current = marks;
  /** a pass just marked with K, shown for a moment */
  const [flash, setFlash] = useState(0);
  /** the last report from the engine, and when it came (the line between reports is worked out from the rate) */
  const status = useRef<{ pos: number; count_in: number; length: number; at: number } | null>(null);
  const phaseRef = useRef<RecordPhase>("idle");
  const fullRef = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const salvageRef = useRef<(r: Recorded) => void>(() => {});
  const fxRef = useRef<VocalFx>(fx);
  fxRef.current = fx;
  phaseRef.current = phase;
  /** which idea is open (counts every one opened): a rehearsal belongs to the idea it was begun in */
  const ideaRef = useRef(idea);
  ideaRef.current = idea;
  const hostRef = useRef(host);
  hostRef.current = host;
  const onRecording = (on: boolean) => {
    setRecording(on);
    hostRef.current.onRecording(on);
  };

  // the app's own sound (the song, a take heard alone): the engine waits until it has been quiet
  // for a moment, and the song waits for the engine to close first (see handoff.ts)
  const [aloneOn, setAloneOn] = useState(hearingAlone);
  useEffect(() => onAloneChange(setAloneOn), []);
  const [quiet, setQuiet] = useState(() => !playing && !hearingAlone());
  const quietRef = useRef<Quiet | null>(null);
  quietRef.current ??= new Quiet(setQuiet);
  useEffect(() => quietRef.current!.sound(playing || aloneOn), [playing, aloneOn]);
  useEffect(() => () => quietRef.current?.dispose(), []);
  /** waiting for the engine to close (a sound about to start), and to open (a recording about to start) */
  const closers = useRef<(() => void)[]>([]);
  const openers = useRef<((o: EngineOpened | null) => void)[]>([]);
  // closing: a recording still going (the driver was reset mid-session) comes back, and its takes are kept
  const door = useRef<Door | null>(null);
  door.current ??= makeDoor(DESKTOP, { comeBack, salvage: (r) => salvageRef.current(r), closed: () => closers.current.splice(0).forEach((f) => f()) });

  const monitor = (studio.monitor ?? "hardware") === "effects";
  // the list of interfaces: once a session, and again only after a problem or when asked to look again (never while
  // the interface is being opened, nor while the app plays unless you hear yourself through the effects: listing
  // loads every driver in turn; see handoff.ts mayList)
  const listNow = mayList({ active, recording, busy: phase !== "idle", monitor, quiet });
  const [look, setLook] = useState(0);
  useEffect(() => {
    if (!desktop || !listNow || (hosts && !error)) return;
    // (after a close that is still on its way: the drivers are never listed over an interface being closed)
    void door.current!.settled().then(() => audioDevices()).then((h) => {
      listed = h;
      setHosts(h);
    });
  }, [desktop, listNow, !!error, look]); // eslint-disable-line react-hooks/exhaustive-deps
  const devices = useMemo(() => devicesOf(hosts), [hosts]);
  const chosen = devices.find((d) => d.host === studio.host && d.name === studio.device) ?? devices[0];
  /** how many interfaces were found (null: still looking) */
  const found = useRef<number | null>(null);
  found.current = hosts ? devices.length : null;
  // (a Record that waits for the interface is told at once when the list comes back with none)
  useEffect(() => {
    if (hosts && !devices.length) openers.current.splice(0).forEach((f) => f(null));
  }, [hosts]); // eslint-disable-line react-hooks/exhaustive-deps

  // the interface is open while recording or rehearsing, whenever you hear yourself through the
  // effects (then it stays open with every window closed), and while the record window or the Audio
  // part of the settings is on screen once the app's own sound has stopped (see handoff.ts)
  const keepOpen = engineWanted({ recording, busy: phase !== "idle", monitor, active, quiet });
  /** closed only because the app is sounding: Record and Rehearse open it again at once */
  const resting = desktop && !!chosen && !opened && !keepOpen && active && !error;
  /** bumped when the driver resets (its buffer size or rate was changed in its own control panel): the interface is opened again */
  const [reopen, setReopen] = useState(0);
  /** what changes seldom, as it was published last (the reports are published with it) */
  const nowRef = useRef<EngineNow>(IDLE.now);
  useEffect(() => {
    if (!desktop || !keepOpen || !chosen) return;
    let live = true;
    setError(null);
    door.current!.open(chosen.host, chosen.name, studio.buffer ?? null, (st: EngineStatus) => {
      if (!live) return;
      if (st.invalid) {
        live = false;
        toast("The interface's settings changed: opening it again");
        // a rehearsal simply ends (a recording comes back as the interface closes, and is kept)
        if (phaseRef.current === "rehearsing") {
          setPhase("idle");
          onRecording(false);
        }
        window.setTimeout(() => setReopen((n) => n + 1), 300);
        return;
      }
      peaks.current = st.peak;
      const going = phaseRef.current === "recording" || phaseRef.current === "rehearsing";
      status.current = going && st.running ? { pos: st.pos, count_in: st.count_in, length: st.length, at: performance.now() } : null;
      const at = going && st.running ? passAt(st.pos, st.count_in, st.length) : null;
      // the row of passes grows once a pass (the only thing that redraws while singing)
      const n = phaseRef.current === "recording" && at ? at.n : 0;
      setPass((was) => (was === n ? was : n));
      // every readout: the meters, the count, the dropouts, the measured delay, the LIMIT lamp
      engineStatus.publish({ st, now: nowRef.current });
      // the app's own sound through the engine: if this computer cannot keep it fed, it goes back to the computer's sound
      noteGaps(st.app_gaps);
      // the file cannot take any more (it is as big as a WAV can be, or the disk is full): stop and keep what there is
      if (st.full && phaseRef.current === "recording" && !fullRef.current) {
        fullRef.current = true;
        void stopRef.current();
      }
    }).then((o) => { if (live) { rate.current = o.rate; openedRef.current = o; setOpened(o); openers.current.splice(0).forEach((f) => f(o)); } }).catch((e) => { if (live) { setOpened(null); setError(String(e)); openers.current.splice(0).forEach((f) => f(null)); } });
    return () => {
      live = false;
      void door.current!.close();
      setOpened(null);
      openedRef.current = null;
      peaks.current = [];
      status.current = null;
      sent.current = null;
      engineStatus.publish({ st: null, now: nowRef.current });
    };
  }, [desktop, keepOpen, chosen?.host, chosen?.name, reopen, studio.buffer]); // eslint-disable-line react-hooks/exhaustive-deps

  // hearing yourself through the effects keeps the engine open with every window closed: the app's own sound then
  // goes through it too, so the two never play through the interface at once (see through.ts)
  useEffect(() => {
    if (!desktop || !opened || !monitor) return;
    void goThrough(THROUGH);
    return () => void comeBack();
  }, [desktop, opened, monitor]);

  // open only because a window that shows it is on screen: a sound about to start closes it first (see handoff.ts)
  useEffect(() => {
    if (!opened || monitor || recording || phase !== "idle") return;
    return holdInterface(
      () =>
        new Promise<void>((done) => {
          closers.current.push(done);
          quietRef.current!.handOff();
        }),
    );
  }, [opened, monitor, recording, phase]);

  // the takes are on their track (or there were none): the idea can be left again
  useEffect(() => {
    if (phase === "idle") setRecordingTo(null);
  }, [phase, setRecordingTo]);
  useEffect(() => () => setRecordingTo(null), [setRecordingTo]);
  useEffect(() => setLive(!!opened && monitor), [opened, monitor]);
  useEffect(() => () => setLive(false), []);

  // what the singer hears follows the track and the sliders at once (a track that is bypassed: the voice without its effects)
  const heard: VocalFx = host.bypassed && fx.on ? { ...fx, on: false } : fx;
  // (one input: nothing is said of a second, exactly as before; a pair: its right side too)
  const pairB = track?.inputB;
  const settings = { monitor, input: track?.input ?? 0, ...(pairB !== undefined ? { inputB: pairB } : {}), fx: heard, backingGain: studio.backing ?? 1, clickGain: studio.click ?? 0.5, clickOn: !!studio.clickOn };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** tell the engine what is recorded and heard, as it is this moment */
  const sendSet = () => {
    const o = settingsRef.current;
    sent.current = { input: o.input, inputB: o.inputB ?? null };
    return engineSet(o);
  };
  useEffect(() => {
    if (!opened) return;
    const t = window.setTimeout(() => void sendSet().catch(() => {}), 30);
    return () => window.clearTimeout(t);
  }, [opened, monitor, track?.input, pairB, sig(heard), studio.backing, studio.click, studio.clickOn]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Render the loop's song, hand it to the engine, and start (recording or just singing along). */
  const go = async (record: boolean) => {
    if (!track) return toast("Add a Vocals or a Blank track first: the + row under the tracks");
    // (the interface may have opened a moment ago, before this was drawn again)
    let o = opened ?? openedRef.current;
    // Record can be pressed before the interface is open (the top bar's ● opens the record window and goes on): it
    // is waited for in the same way, also while it is still being looked for
    const coming = desktop && !error && (!hosts || !!chosen);
    if (!o && hosts && !devices.length) return toast("No interface found");
    if (!o && (resting || coming)) {
      // closed while the app played: the song stops (as it does for a recording) and the interface opens at once
      onRecording(true);
      o = await new Promise<EngineOpened | null>((done) => {
        openers.current.push(done);
        window.setTimeout(() => done(null), coming && !resting ? 12000 : 8000);
      });
      if (!o) onRecording(false);
    }
    if (!o) return toast(found.current === 0 ? "No interface found" : "The interface is not open");
    const rateNow = o.rate;
    const plan = hostRef.current.plan();
    if (!plan || plan.beats <= 0) return toast("Nothing to record over here: set a loop, or put the cursor where it should start");
    const t = track;
    // a rehearsal ends when another idea is opened, also while it is being made ready (a recording keeps its idea open: see recordingTo)
    const inIdea = ideaRef.current;
    const left = () => !record && ideaRef.current !== inIdea;
    // until its takes are on the track, the idea stays open and the track stays (see recordingTo)
    if (record) setRecordingTo(t.id);
    claims.current!.begin(plan, t, record);
    fullRef.current = false;
    setMarks(new Set());
    setPass(0);
    stopAlone();
    onRecording(true);
    const playOnce = !!plan.once;
    setOnce(playOnce);
    // the song under it: the one rendered last, while everything it was made from is the same (a second take starts at once)
    const skip = record ? t.id : null;
    const key = plan.backing ? `${rateNow}|${plan.backing(skip)}` : null;
    const had = key !== null && lastRender.current?.key === key ? lastRender.current.ch : null;
    setAgain(!!had);
    setPhase("preparing");
    try {
      let ch = had;
      if (!ch) {
        const o = { bpm: plan.bpm, pattern: plan.pattern, beat: plan.beat, rate: rateNow, skip: record ? t.id : undefined };
        const frames = Math.round(((plan.beats * 60) / plan.bpm) * rateNow);
        const have = Math.round(((plan.items.reduce((a, x) => a + x.beats, 0) * 60) / plan.bpm) * rateNow);
        // played once: the song, then what rings on after it (nothing is folded back onto the start)
        if (playOnce) ch = await renderSong(plan.items, { ...o, fold: false });
        // round and round, the stretch all inside the song: as ever
        else if (have >= frames - 2) ch = await renderSong(plan.items, o);
        // round a stretch that reaches past the song's end (or over a song with nothing in it yet): the bars after
        // the end are silence, and the loop is as long as the stretch
        else ch = foldRound(await renderSong(plan.items, { ...o, fold: false, tail: (frames - have) / rateNow + 3 }), frames);
        lastRender.current = key !== null ? { key, ch } : null;
      }
      const [l, r] = ch;
      if (left()) throw LEFT;
      await engineBacking(l, r);
      if (left()) throw LEFT;
      // the count-in is in the meter of the loop's first bar; after it, every bar clicks in its own
      const click = clickPlan(plan.bars, plan.beatsPerBar, studio.countIn ?? 1);
      // what the file is (one input or a pair) is fixed here, by what the engine was told last: when that is not
      // this track's choice yet (it was picked a moment ago), the engine is told first
      if (!sent.current || sent.current.input !== t.input || sent.current.inputB !== (t.inputB ?? null)) await sendSet();
      const path = await engineStart({ bpm: plan.bpm, countInBeats: click.countInBeats, beatsPerBar: click.beatsPerBar, bars: click.bars, record, name: t.name ?? "Vocal", ...(playOnce ? { once: true } : {}) });
      claims.current!.started(record ? path : null);
      if (left()) return void stop();
      setPhase(record ? "recording" : "rehearsing");
    } catch (e) {
      setPhase("idle");
      onRecording(false);
      if (e !== LEFT) toast(String(e));
    }
  };

  /** The recording begun last, claimed by whichever hands it over first, with the passes marked ★ (see `Claims`). */
  const claim = (r: Recorded) => {
    const c = claims.current!.claim(r);
    return c ? { ...c, kept: marksRef.current } : null;
  };

  /**
   * A recording that has ended: the host cuts it into one take per pass and lays it on its track. The passes marked ★
   * are the keepers. `used`: the vocal sound its file was made with (the knobs may have moved while it was being made).
   */
  const save = (r: Recorded, c: NonNullable<ReturnType<typeof claim>>, used: VocalFx, lead = "") =>
    // with no vocal sound on it (no room for that file), a take plays dry and "Apply sound" is offered
    hostRef.current.onRecorded(r, { kept: [...c.kept], sound: r.wet === r.dry ? "" : soundTag(used), plan: c.plan, track: c.track.id, ...(lead ? { lead } : {}) });

  const stop = async () => {
    const used = fx;
    setPhase("saving");
    try {
      const r = await engineStop(used);
      const c = r && claim(r);
      if (r && c) save(r, c, used);
    } catch (e) {
      toast(String(e));
    } finally {
      setPhase("idle");
      onRecording(false);
      setMarks(new Set());
    }
  };
  stopRef.current = stop;
  // another idea opened: a rehearsal over the one left stops (the interface would go on playing it, and the transport stay locked)
  useEffect(() => {
    if (phaseRef.current === "rehearsing") void stopRef.current();
  }, [idea]);

  /**
   * The driver was reset in the middle of a recording, and the interface closed under it: the
   * recording came back (dry), so the session is kept. The vocal sound is put on it here, while
   * the interface opens again.
   */
  const salvage = async (r: Recorded) => {
    // claimed at once: a new recording begun while this one is being made is never mixed up with it
    const c = claim(r);
    if (!c) return;
    const mine = () => claims.current!.session === c.session;
    const used = fxRef.current;
    setPhase("saving");
    let wet = r.dry;
    let note = r.note ?? null;
    try {
      wet = await fxRender(r.dry, used);
    } catch (e) {
      note = `no vocal sound (${String(e)})`;
    }
    save({ ...r, wet, note }, c, used, "The interface reset; the recording is kept: ");
    if (mine()) {
      setPhase("idle");
      onRecording(false);
      setMarks(new Set());
    }
  };
  salvageRef.current = (r) => void salvage(r);

  // ── marking passes ★ ──
  const mark = useCallback((n: number, on?: boolean) => {
    if (n < 1) return;
    setMarks((m) => (on === undefined || m.has(n) !== on ? toggled(m, n) : m));
  }, []);
  /** K: keep the pass being sung, or, in its first moments, the one that has just ended */
  const markNow = useCallback(() => {
    const s = status.current;
    const at = s && passAt(s.pos, s.count_in, s.length);
    if (!s || !at) return;
    const n = passToMark(at, Math.min(0.125, (GRACE_S * rate.current) / Math.max(1, s.length)));
    mark(n, true);
    setFlash(n);
  }, [mark]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(0), 700);
    return () => window.clearTimeout(t);
  }, [flash]);
  const keysMine = host.keys;
  useEffect(() => {
    if (phase !== "recording" || !keysMine) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "k" && e.key !== "K") || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      markNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, markNow, keysMine]);

  // how many inputs the interface has is remembered, so a track's input can be chosen while it is closed
  const inputsNow = opened?.inputs;
  useEffect(() => {
    if (inputsNow && inputsNow !== studio.inputs) setStudio({ inputs: inputsNow });
  }, [inputsNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── what changes seldom, published for the readouts that are not handed it ──
  const trackId = track?.id ?? null;
  const now = useMemo<EngineNow>(
    () => ({ opened, phase, pass, track: trackId, bpm: phase === "idle" ? 0 : claims.current?.plan?.bpm ?? 0 }),
    [opened, phase, pass, trackId],
  );
  useLayoutEffect(() => {
    nowRef.current = now;
    engineStatus.publish({ st: now.opened ? engineStatus.last().st : null, now });
  }, [now]);
  useEffect(() => () => engineStatus.publish(IDLE), []);

  // ── what the host and the windows do ──
  const goRef = useRef(go);
  goRef.current = go;
  /** the top bar's ●: recording starts once the engine is on the track asked for */
  const pending = useRef<{ track: string; at: number } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    if (performance.now() - want.at > 3000) pending.current = null;
    else if (trackId === want.track) {
      pending.current = null;
      if (phaseRef.current === "idle") void goRef.current(true);
    }
  });
  const does = useMemo(() => ({
    record: () => void goRef.current(true),
    rehearse: () => void goRef.current(false),
    stop: () => void stopRef.current(),
    toggle: () => {
      const ph = phaseRef.current;
      if (ph === "recording") void stopRef.current();
      else if (ph === "idle") void goRef.current(true);
    },
    start: (id: string) => {
      pending.current = { track: id, at: performance.now() };
      setTick((n) => n + 1);
    },
    at: () => {
      const s = status.current;
      // (between the engine's reports, the music has moved on at its rate)
      return s ? passAt(s.pos + Math.min(0.1, (performance.now() - s.at) / 1000) * rate.current, s.count_in, s.length) : null;
    },
    since: () => {
      const s = status.current;
      if (!s || s.pos < s.count_in) return null;
      return (s.pos + Math.min(0.1, (performance.now() - s.at) / 1000) * rate.current - s.count_in) / rate.current;
    },
    level: (ch: number) => meterPos(dbOf(peaks.current[ch] ?? 0)),
    running: () => (phaseRef.current === "idle" ? null : claims.current?.plan ?? null),
    relist: () => {
      listed = null;
      setHosts(null);
      setLook((n) => n + 1);
    },
  }), []);

  /** may Record and Rehearse be pressed? (Also before the interface is open: it is waited for.) */
  const ready = !!(opened || resting) || !error;
  return useMemo<EngineApi>(
    () => ({ desktop, hosts, devices, chosen, opened, error, phase, pass, marks, flash, ready, monitor, once, again, mark, markNow, ...does }),
    [desktop, hosts, devices, chosen, opened, error, phase, pass, marks, flash, ready, monitor, once, again, mark, markNow, does],
  );
}

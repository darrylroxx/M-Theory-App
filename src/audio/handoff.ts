/**
 * The audio interface, shared between the app's own sound and the recording engine.
 *
 * The app plays through the computer's sound system (the song, a take heard alone). The recording
 * engine opens the interface directly, input and output, to record and to show its inputs. Many
 * interfaces' drivers crackle when both play through them at once, and opening or closing one
 * while the other plays can click. So the engine is open only when it is needed and nothing else
 * is sounding: while recording or rehearsing, while you hear yourself through the effects (then
 * it stays open everywhere: the one overlap left), and while a window that shows the interface
 * is open (the record window, or the Audio part of the settings: see `windowWants`) once the app
 * has been quiet for a second. The song waits for the engine to close before its first note, so
 * whatever the driver does in closing happens in silence.
 */

/** How long after the app's sound stops the engine opens again (seconds): quick auditions do not churn it. */
export const QUIET_AFTER = 1;
/** How long a hand-off waits for the sound it was made for before the engine may open again (seconds). */
export const HANDOFF_WAIT = 5;

/**
 * Is a window that needs the interface on screen? In the track view that is the record window, or the Audio part
 * of the settings (its meters, its measured delay). This is what `active` means below; it used to mean "the Vocals
 * page is on screen". An armed track is not a reason: arming a track opens nothing, or every Play would wait for the
 * driver to close and the interface would open again a second after every stop.
 */
export function windowWants(o: { record: boolean; setup: boolean; armed?: boolean }): boolean {
  return o.record || o.setup;
}

/** Should the engine be open? `active`: a window that needs the interface is on screen (see `windowWants`). */
export function engineWanted(o: { recording: boolean; busy: boolean; monitor: boolean; active: boolean; quiet: boolean }): boolean {
  return o.recording || o.busy || o.monitor || (o.active && o.quiet);
}

/**
 * May the interfaces be listed now (only while a window that needs the interface is on screen: `active`)? Listing
 * loads every driver in turn, which
 * can upset one that is playing, so it waits for the app to be quiet; but not when the engine is
 * to be open while the app sounds anyway (hearing yourself through the effects, a recording):
 * waiting then would only keep you from hearing yourself until the song stops.
 */
export function mayList(o: { active: boolean; recording: boolean; busy: boolean; monitor: boolean; quiet: boolean }): boolean {
  return o.active && (o.quiet || o.monitor || o.recording || o.busy);
}

let release: (() => Promise<void>) | null = null;
/** the engine closing (or closed): a sound asked for while it closes waits for it too */
let closing: Promise<void> = Promise.resolve();

/**
 * The engine is open and would close for the app's sound: `close` closes it (resolving once it is
 * closed). Returns the function that takes the offer back.
 */
export function holdInterface(close: () => Promise<void>): () => void {
  release = close;
  return () => {
    if (release === close) release = null;
  };
}

/** About to make a sound: the engine is closed first, if it is open only because a window that shows it is on screen. */
export function freeInterface(): Promise<void> {
  const r = release;
  release = null;
  // (a driver that never answers does not keep the song from playing)
  if (r) closing = Promise.race([r().catch(() => {}), new Promise<void>((done) => setTimeout(done, 1500))]);
  return closing;
}

/**
 * Whether the app has been quiet long enough for the engine to open: false at once when a sound
 * starts (or is about to: `handOff`), true `QUIET_AFTER` seconds after it stops (after a hand-off
 * whose sound never came, `HANDOFF_WAIT`).
 */
export class Quiet {
  quiet = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sounding = false;
  constructor(private onChange: (quiet: boolean) => void) {}

  /** The app's sound started or stopped. */
  sound(on: boolean) {
    if (on === this.sounding && (on || this.timer || this.quiet)) return;
    this.sounding = on;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (on) this.set(false);
    else this.later(QUIET_AFTER);
  }

  /** A sound is about to start: not quiet from now (and quiet again in a while if it never does). */
  handOff() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.set(false);
    if (!this.sounding) this.later(HANDOFF_WAIT);
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private later(s: number) {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.set(true);
    }, s * 1000);
  }

  private set(q: boolean) {
    if (q === this.quiet) return;
    this.quiet = q;
    this.onChange(q);
  }
}

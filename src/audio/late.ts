/**
 * Notes booked late. The song is booked a quarter of a second ahead from a timer on the page; when
 * the page is held up for longer than that (a heavy page drawing, the computer busy), whatever
 * fell due in the meantime is booked after its time. Started as asked, every one of them would
 * start at once, in the same instant: a pile-up of drum hits and notes that sounds like a burst of
 * crackle.
 *
 * Instead a recorded sound (a drum hit, a string, a piano key) booked late starts as far into
 * itself as it is late, so it sounds as it would by now and ends where it would have. A sound
 * begun in its middle would start with a step, which is a click, so it fades in over a few
 * milliseconds; and it starts at the soonest moment the audio thread has not yet worked out
 * (see `soonest`), so that fade is heard whole. A drum hit whose sound is already over is left out.
 * Offline renders are never late.
 */
import { soonest } from "./context";

/** Since the app opened (for measuring): drum hits and notes started part-way in, and drum hits left out, being over. */
export const lateCount = { drums: 0, notes: 0, over: 0 };

/** How long a sound started part-way in takes to fade in (seconds): long enough not to click, short enough to keep its edge. */
export const LATE_FADE = 0.004;
/** Later than this, a sound starts part-way in (seconds; anything less is a click-to-hear sound a moment old). */
export const NOTE_LATE = 0.01;

/** Is a sound booked for `when` late? (Never in an offline render.) */
export function isLate(c: BaseAudioContext, when: number): boolean {
  return !("startRendering" in c) && c.currentTime - when > NOTE_LATE;
}

/** How fast a source plays through its buffer (its rate, and its detune). */
function speedOf(src: AudioBufferSourceNode): number {
  return (src.playbackRate?.value ?? 1) * Math.pow(2, (src.detune?.value ?? 0) / 1200);
}

/** How far past its own end a sound booked for `when` is by now (seconds; above 0: it is over). */
export function pastEnd(c: BaseAudioContext, when: number, buffer: AudioBuffer | null, speed = 1): number {
  if (!buffer || !isLate(c, when)) return -Infinity;
  return c.currentTime - when - buffer.duration / Math.max(1e-6, speed);
}

/**
 * Start a recorded sound at `when`, `offset` into its buffer, into `into` (the source is connected
 * here: a late one goes through a fade of its own). Returns the moment it starts: `when`, or for a
 * late one the soonest moment from now, that far into itself (at the speed it plays at), faded in.
 * `kind`: what it counts as, for measuring.
 */
export function startRecorded(c: BaseAudioContext, src: AudioBufferSourceNode, when: number, into: AudioNode, offset = 0, kind: "notes" | "drums" = "notes"): number {
  if (!isLate(c, when)) {
    src.connect(into);
    src.start(when, offset);
    return when;
  }
  const at = Math.max(soonest(c), c.currentTime);
  const fade = c.createGain();
  fade.gain.value = 0;
  fade.gain.setValueAtTime(0, at);
  fade.gain.linearRampToValueAtTime(1, at + LATE_FADE);
  src.connect(fade).connect(into);
  src.start(at, offset + (at - when) * speedOf(src));
  lateCount[kind]++;
  return at;
}

/**
 * Notes booked late. The song is booked a quarter of a second ahead from a timer on the page; when
 * the page is held up for longer than that (a heavy page drawing, the computer busy), whatever
 * fell due in the meantime is booked after its time. Started as asked, every one of them would
 * start at once, in the same instant: a pile-up of drum hits that sounds like a burst of crackle.
 *
 * Instead a drum hit more than 30 ms late is left out (it has passed; what follows is on time),
 * and a recorded note (a string, a piano key) starts now, as far into itself as it is late, so it
 * sounds as it would by now and ends where it would have. Offline renders are never late.
 */

/** How many drum hits were left out, and recorded notes started part-way in, since the app opened (for measuring). */
export const lateCount = { drums: 0, notes: 0 };

/** A drum hit later than this is left out (seconds). */
export const DRUM_LATE = 0.03;
/** Later than this, a recorded note starts part-way in (seconds; anything less is a click-to-hear sound a moment old). */
const NOTE_LATE = 0.01;

/**
 * Start a recorded sound at `when`, `offset` into its buffer. Returns how late it was (0: on time),
 * and starts a late one now, that far into it (at the speed it plays at).
 */
export function startRecorded(c: BaseAudioContext, src: AudioBufferSourceNode, when: number, offset = 0): number {
  const now = c.currentTime;
  const late = now - when;
  if (late > NOTE_LATE && !("startRendering" in c)) {
    const rate = (src.playbackRate?.value ?? 1) * Math.pow(2, (src.detune?.value ?? 0) / 1200);
    src.start(now, offset + late * rate);
    lateCount.notes++;
    return late;
  }
  src.start(when, offset);
  return 0;
}

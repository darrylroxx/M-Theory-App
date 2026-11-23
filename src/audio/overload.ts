/**
 * Noticing that the song is more than the computer can play.
 *
 * All of the song's sound is worked out on one thread, a block at a time, and each block has to
 * be ready before the sound card asks for it. A song with more sounding at once than that thread
 * can work out in time does not slow down: the sound card is handed gaps, heard as a crackle.
 * Nothing in the song is wrong then, and nothing on the page shows it, so the songwriter is told
 * once, in a plain line, what is happening and what helps.
 *
 * The browser keeps count itself, in one of two ways (a browser with neither is left alone, and
 * nothing is said): how much of its time the thread uses and what share of its blocks came late,
 * or how much sound it has failed to deliver in all. Either is asked for about once a second and
 * only while the song plays; nothing is measured by the app itself.
 */

/** How long the thread must have been overloaded before anything is said (seconds). */
export const OVERLOAD_SECONDS = 2;
/** Above this share of the thread's time in use, it has no room left. */
export const OVERLOAD_LOAD = 0.95;
/** Above this share of blocks late (or of sound not delivered), it is heard. */
export const OVERLOAD_LATE = 0.02;

/** One reading: was the thread overloaded over the last second or so? */
export type Reading = boolean;

/**
 * Tells a run of readings apart from a single late moment (a page opening, another program
 * starting): only readings that are overloaded one after another for OVERLOAD_SECONDS count, and
 * then it says so once and never again.
 */
export function overloadJudge(secondsEach: number, said: () => void): (r: Reading) => void {
  let run = 0;
  let done = false;
  return (over) => {
    if (done) return;
    run = over ? run + secondsEach : 0;
    if (run >= OVERLOAD_SECONDS - 1e-9) {
      done = true;
      said();
    }
  };
}

/** The browser's own measure of the thread's load (where it has one). */
interface RenderCapacity {
  start(o: { updateInterval: number }): void;
  stop(): void;
  addEventListener(type: "update", fn: (e: Event) => void): void;
  removeEventListener(type: "update", fn: (e: Event) => void): void;
}
interface CapacityEvent {
  averageLoad?: number;
  underrunRatio?: number;
}
/** The browser's own count of sound it could not deliver (where it has one). */
interface PlaybackStats {
  /** seconds of sound not delivered, since the sound opened */
  underrunDuration?: number;
  /** seconds of sound asked for, since the sound opened */
  totalDuration?: number;
}
type Watched = BaseAudioContext & { renderCapacity?: RenderCapacity; playbackStats?: PlaybackStats };

/**
 * Watch a playing context: `said` is called once, when its thread has been overloaded for a
 * couple of seconds. Returns what stops the watching (call it when the song stops). Does nothing
 * in a browser that keeps no count.
 */
export function watchOverload(c: BaseAudioContext, said: () => void): () => void {
  const w = c as Watched;
  const cap = w.renderCapacity;
  if (cap && typeof cap.start === "function") {
    const judge = overloadJudge(1, said);
    const on = (e: Event) => {
      const x = e as unknown as CapacityEvent;
      judge((x.averageLoad ?? 0) >= OVERLOAD_LOAD || (x.underrunRatio ?? 0) >= OVERLOAD_LATE);
    };
    try {
      cap.addEventListener("update", on);
      cap.start({ updateInterval: 1 });
    } catch {
      return () => {};
    }
    return () => {
      try {
        cap.removeEventListener("update", on);
        cap.stop();
      } catch {
        /* already stopped */
      }
    };
  }
  const stats = w.playbackStats;
  if (stats && typeof stats.underrunDuration === "number") {
    const judge = overloadJudge(1, said);
    let lost = stats.underrunDuration;
    let total = stats.totalDuration ?? 0;
    const timer = setInterval(() => {
      const nowLost = stats.underrunDuration ?? lost;
      const nowTotal = stats.totalDuration ?? total;
      const asked = nowTotal - total;
      // (the share of the last second's sound that was not delivered)
      judge(asked > 0 && (nowLost - lost) / asked >= OVERLOAD_LATE);
      lost = nowLost;
      total = nowTotal;
    }, 1000);
    return () => clearInterval(timer);
  }
  return () => {};
}

/** What the songwriter is told. */
export const OVERLOAD_MESSAGE = "This song is more than this computer can play at once, so the sound may crackle. Fewer tracks playing at the same time, or effects turned off on some, will help.";

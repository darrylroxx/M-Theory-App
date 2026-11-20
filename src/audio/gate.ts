/**
 * Letting an effect that is turned all the way down rest.
 *
 * The browser works out every node the speakers can reach, on every block of samples, whether
 * or not it is adding anything: an echo at 0 still runs its delays, and through them the reverb,
 * a phaser at 0 still sweeps its filters. All of that is done on the one audio thread, so with
 * a few tracks it adds up to the crackle of a thread that runs out of time.
 *
 * A gate holds the connections that feed one effect (its input, its sweep). Turned on, they are
 * made at once, before the effect's level glides up from nothing, so nothing clicks. Turned off,
 * the level glides down as before and the connections are let go only once it has settled (and
 * the effect has rung out), so nothing clicks either; turned on again before that, they simply
 * stay. Only the way into an effect is ever cut, never the main path, so the sound that goes
 * through, and its timing, are untouched.
 *
 * An offline render (a WAV, the recording engine's backing) starts with the effects it never
 * uses unconnected, connects one where it is first needed, and never lets go, so every render of
 * the same song is the same.
 */
export interface Gate {
  /** Make the connections now (an effect about to be heard, or one that might be). */
  on(): void;
  /** The effect is turned down from `at` (seconds on the audio clock; now if left out): let go once it has settled. */
  off(at?: number): void;
  /** Are the connections made? */
  readonly open: boolean;
}

type Edge = [AudioNode, AudioNode | AudioParam];

/** A gate over `edges`, let go `settle` seconds after an effect is turned down. */
export function gate(c: BaseAudioContext, edges: Edge[], settle: number): Gate {
  const live = !("startRendering" in c);
  let open = false;
  let want = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    for (const [a, b] of edges) a.connect(b as AudioNode);
    open = true;
  };
  const cut = () => {
    timer = undefined;
    if (want || !open) return;
    for (const [a, b] of edges) {
      try {
        a.disconnect(b as AudioNode);
      } catch {
        /* not connected */
      }
    }
    open = false;
  };
  return {
    on() {
      want = true;
      clearTimeout(timer);
      timer = undefined;
      if (!open) connect();
    },
    off(at) {
      want = false;
      // (a render keeps what it has connected: see above)
      if (!live || !open) return;
      clearTimeout(timer);
      const later = Math.max(0, (at ?? c.currentTime) - c.currentTime);
      timer = setTimeout(cut, (later + settle) * 1000);
    },
    get open() {
      return open;
    },
  };
}

/**
 * Anything that plays notes for a track: the plucked strings, the piano, the synth. The player
 * talks to every instrument the same way, so a track can change instrument without the rest of
 * the app knowing.
 */
export interface Instrument {
  /** Where its sound comes out (connect it to the track's fader). */
  readonly output: AudioNode;
  /**
   * Play a note: `midi` number, start `when` (seconds on the audio clock), `velocity` 0..1, how
   * long it is held in seconds (Infinity = until stopAll or until the voice is needed), and an
   * optional `slot` (a lane: a new note on the same slot takes over from the one before).
   */
  play(midi: number, when: number, velocity: number, length: number, slot?: number): void;
  /** Let every note go from `when` (seconds on the audio clock; default now). */
  stopAll(when?: number): void;
  /** Can it sound at once (its samples or its processor are loaded)? */
  ready(): boolean;
  /** Resolves when it can sound. */
  load(): Promise<void>;
  /** Free what it holds. */
  dispose(): void;
}

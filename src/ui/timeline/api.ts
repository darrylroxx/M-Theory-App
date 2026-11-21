// What the track view is given to play with. The view itself never plays anything.
import type { Region } from "../../timeline/model";

export interface PlayerApi {
  playing: boolean;
  /** play, or stop (the space bar) */
  toggle(): void;
  stop(): void;
  /** the song beat that is sounding, or null */
  getBeat(): number | null;
  /** move the cursor; while playing, the music restarts from there */
  seek(beat: number): void;
  /** go round these bars of the song as it is heard now (the composer strip's ▶); `solo`: only that track is heard. null ends it */
  audition(span: Region | null, solo?: string): void;
}

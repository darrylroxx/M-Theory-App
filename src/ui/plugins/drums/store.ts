// What the two drum windows of one track share: which drum is chosen, which one is heard on its own, and a count
// that goes up each time a drum's name is tapped in the composer. So the drum picked in the grid is the drum the
// sound window shows. Kept per track, in memory only: none of it is part of the song.
import { useSyncExternalStore } from "react";
import type { DrumId } from "../../../audio/drums";

export interface DrumView {
  /** the drum whose sound is shown */
  sel: DrumId;
  /** the drum heard on its own while working (null: all of them) */
  solo: DrumId | null;
  /** goes up when a drum's name is tapped: the sound window brings that drum's sound into view */
  hit: number;
}

const START: DrumView = { sel: "kick", solo: null, hit: 0 };
const views = new Map<string, DrumView>();
const listeners = new Set<() => void>();

/** A track's view as it is now. */
export const drumView = (track: string): DrumView => views.get(track) ?? START;

/** Change a track's view. The same view stays when nothing in the patch differs. */
export function setDrumView(track: string, patch: Partial<DrumView>): void {
  const was = drumView(track);
  if ((Object.keys(patch) as (keyof DrumView)[]).every((k) => was[k] === patch[k])) return;
  views.set(track, { ...was, ...patch });
  for (const fn of [...listeners]) fn();
}

/** Forget a track's view (the track is gone). */
export function dropDrumView(track: string): void {
  if (views.delete(track)) for (const fn of [...listeners]) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** A track's view, drawn again when it changes. With no track (the old page, which keeps its own): the starting view, always. */
export function useDrumView(track: string | null | undefined): DrumView {
  const read = () => (track ? drumView(track) : START);
  return useSyncExternalStore(subscribe, read, read);
}

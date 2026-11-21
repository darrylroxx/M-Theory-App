// The ideas list of the track view: one saved idea. (Only the type for now; the functions that keep the list come later.)
import type { Key } from "../theory/keys";
import type { TimelineSong } from "./model";

export interface SavedIdea {
  id: string; name: string; key: Key; savedAt: number; updatedAt?: number; capo?: number; tuningId?: string;
  song: TimelineSong;
  /** it was converted from a version 4 idea: that copy's own `updatedAt` */
  from?: { at: number };
  /** a backup entry: the version 4 idea it stands for */
  backup?: { of: string; unsaved?: true };
}

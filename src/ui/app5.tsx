// The app's state once a song is tracks and clips, and what the screens are handed to read and change it.
// (Only the two types for now; the provider that holds the state comes with the switch-over.)
import type { BeatPattern, UserKit } from "../audio/beats";
import type { UserSound } from "../audio/sounds";
import type { Tuning } from "../guitar/tunings";
import type { ViewPrefs } from "../song/window";
import type { Key } from "../theory/keys";
import type { SavedIdea } from "../timeline/library5";
import type { Clipboard5, Session, TimelineSong } from "../timeline/model";
import type { CloudStatus } from "./cloud";
import type { CanvasPrefs, Settings, Studio } from "./state";

export interface App5State {
  key: Key; settings: Settings;
  song: TimelineSong; saved: SavedIdea[]; session: Session;
  shapes: Record<string, string>; myBeats: BeatPattern[]; myKits: UserKit[]; mySounds: UserSound[];
  canvas?: CanvasPrefs; ideaId?: string | null; draft?: string; tombs?: Record<string, number>;
  clip?: Clipboard5; studio?: Studio; view?: ViewPrefs;
  /** what was converted from version 4, and from what */
  converted?: { at: number; blob?: { len: number; hash: string; where: "idb" | "local" }; ideas: Record<string, number> };
  /** the last write to storage failed; never stored */
  unsaved?: true;
}

/** What the screens get: the state, and every way to change it. */
export interface Ctx5 {
  state: App5State;
  /** a change that is not an undo step: settings, the libraries, studio, view, the clipboard */
  set(fn: (s: App5State) => App5State): void;
  /** a change of the song: one undo step. `control` folds quick changes from one control into one step */
  edit(label: string, fn: (s: TimelineSong) => TimelineSong, control?: string): void;
  /** a change of the song and the key together ("Move song"): one undo step */
  editKeyed(label: string, fn: (song: TimelineSong, key: Key) => { song: TimelineSong; key: Key }): void;
  setSession(fn: (s: Session) => Session): void;
  undo(): void; redo(): void; canUndo: boolean; canRedo: boolean;
  tuning: Tuning;
  toast(msg: string, action?: { label: string; aria: string; run(): void; ms?: number; when?(s: App5State): boolean }): void;
  idea: SavedIdea | null; dirty: boolean; opened: number;
  saveIdea(asNew?: boolean): "new" | "updated" | "nothing";
  openIdea(id: string): void; newIdea(): void; renameIdea(id: string, name: string): void; deleteIdea(id: string): void;
  /** a backup file's text, version 1 or 2; returns how many ideas were new */
  importIdeas(text: string): number;
  cloud: CloudStatus; syncNow(): void;
  recordingTo: string | null; setRecordingTo(id: string | null): void;
}

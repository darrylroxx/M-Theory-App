// Which composer and which sound window each kind of track mounts. One line for each kind: a later step that
// rebuilds a composer changes its line and nothing else here.
//
// Chords still opens the old Chords page in a window (chords/ChordsLegacy); Melody and Bass share the old Melody
// page (melody/MelodyLegacy). Each has a host file of its own, so the plugin that replaces one does not touch the
// other.
//
// A track that records (Vocals, Blank) has neither: its compose and FX buttons open the one record window
// (plugins/audio/RecordHost), which holds its takes and its vocal sound.
import type { ComponentType } from "react";
import type { TrackKind } from "../../timeline/model";
import { ChordsLegacy } from "./chords/ChordsLegacy";
import type { ComposerProps } from "./ComposerFrame";
import { DrumSound } from "./drums/DrumSound";
import { DrumsComposer } from "./drums/DrumsComposer";
import { MelodyLegacy } from "./melody/MelodyLegacy";
import { TrackSound } from "./sound/TrackSound";
import type { SoundProps } from "./SoundFrame";

export interface Plugin {
  /** the window the compose button opens (null: the record window) */
  compose: ComponentType<ComposerProps> | null;
  /** the window the FX button opens (null: the record window, at its vocal sound) */
  sound: ComponentType<SoundProps> | null;
}

export const PLUGINS: Record<TrackKind, Plugin> = {
  chords: { compose: ChordsLegacy, sound: TrackSound },
  melody: { compose: MelodyLegacy, sound: TrackSound },
  bass: { compose: MelodyLegacy, sound: TrackSound },
  drums: { compose: DrumsComposer, sound: DrumSound },
  vocals: { compose: null, sound: null },
  audio: { compose: null, sound: null },
};

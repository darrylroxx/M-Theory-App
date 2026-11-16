/** Guitar tunings, low string → high string, as MIDI note numbers. */
export interface Tuning {
  id: string;
  name: string;
  notes: number[];
}

export const TUNINGS: Tuning[] = [
  { id: "standard", name: "Standard (E A D G B E)", notes: [40, 45, 50, 55, 59, 64] },
  { id: "dropD", name: "Drop D (D A D G B E)", notes: [38, 45, 50, 55, 59, 64] },
  { id: "halfDown", name: "Half-step down (E♭ A♭ D♭ G♭ B♭ E♭)", notes: [39, 44, 49, 54, 58, 63] },
  { id: "wholeDown", name: "D Standard (D G C F A D)", notes: [38, 43, 48, 53, 57, 62] },
  { id: "dropC", name: "Drop C (C G C F A D)", notes: [36, 43, 48, 53, 57, 62] },
  { id: "dadgad", name: "DADGAD", notes: [38, 45, 50, 55, 57, 62] },
  { id: "openD", name: "Open D (D A D F♯ A D)", notes: [38, 45, 50, 54, 57, 62] },
  { id: "openDm", name: "Open D minor (D A D F A D)", notes: [38, 45, 50, 53, 57, 62] },
  { id: "openG", name: "Open G (D G D G B D)", notes: [38, 43, 50, 55, 59, 62] },
  { id: "openE", name: "Open E (E B E G♯ B E)", notes: [40, 47, 52, 56, 59, 64] },
  { id: "openC", name: "Open C (C G C G C E)", notes: [36, 43, 48, 55, 60, 64] },
];

export function getTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

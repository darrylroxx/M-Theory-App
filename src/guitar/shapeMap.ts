/** Areas of the neck, used to organise shapes and to arrange a progression in one place. */
import type { Voicing } from "./voicings";

export const POSITIONS = ["Open", "1–3", "4–6", "7–9", "10–12", "13+"] as const;

/** Which area a shape belongs to: where the hand sits on the neck. */
export function positionOf(v: Voicing): number {
  if (v.minFret === 0) return 0; // nothing fretted
  if (v.openStrings > 0 && v.maxFret <= 4) return 0; // classic open chord
  const f = v.minFret;
  return f <= 3 ? 1 : f <= 6 ? 2 : f <= 9 ? 3 : f <= 12 ? 4 : 5;
}

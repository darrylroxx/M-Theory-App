/**
 * Rhythm patterns shared by the audio player and the MIDI exporter,
 * so what you hear is exactly what lands in your DAW.
 */
export type PatternId = "ring" | "strum" | "pulse" | "arpeggio" | "travis";

export const PATTERNS: { id: PatternId; label: string; hint: string }[] = [
  { id: "ring", label: "Let ring", hint: "One strum per chord. Best for hearing the harmony." },
  { id: "strum", label: "Strum", hint: "D – D U – U D U. The classic campfire pattern." },
  { id: "pulse", label: "8th pulse", hint: "Palm-muted 8ths. Driving rock / post-rock." },
  { id: "arpeggio", label: "Arpeggio", hint: "Picked 8ths, low to high and back. Dreamy." },
  { id: "travis", label: "Fingerpick", hint: "Alternating bass + melody: folk / Travis style." },
];

export interface PatternEvent {
  /** Beat offset from the start of the chord */
  beat: number;
  /** MIDI notes (low → high order for strums) */
  notes: number[];
  /** "down"/"up" strum direction (affects note order); "pick" for single notes */
  dir: "down" | "up" | "pick";
  velocity: number; // 0..1
  /** How long it rings, in beats (Infinity = until the next chord) */
  length: number;
  /** Seconds between strummed strings */
  spread: number;
}

/** Turn one chord (voicing MIDI notes) + its length in beats into note events. */
export function patternEvents(midi: (number | null)[], beats: number, pattern: PatternId): PatternEvent[] {
  const notes = midi.filter((m): m is number => m !== null);
  if (!notes.length) return [];
  const ev: PatternEvent[] = [];
  const strum = (beat: number, dir: "down" | "up", velocity: number, length = Infinity, spread = 0.018, subset?: number[]) =>
    ev.push({ beat, notes: subset ?? notes, dir, velocity, length, spread });
  const pick = (beat: number, note: number, velocity: number, length = Infinity) =>
    ev.push({ beat, notes: [note], dir: "pick", velocity, length, spread: 0 });

  switch (pattern) {
    case "ring":
      strum(0, "down", 0.85, Infinity, 0.03);
      break;
    case "strum": {
      // D . D U . U D U  (per 4 beats, repeated / truncated for other lengths)
      const bar: [number, "down" | "up", number][] = [
        [0, "down", 0.9], [1, "down", 0.7], [1.5, "up", 0.5], [2.5, "up", 0.55], [3, "down", 0.75], [3.5, "up", 0.5],
      ];
      for (let b = 0; b < beats; b += 4)
        for (const [o, d, v] of bar) if (b + o < beats) strum(b + o, d, v, Infinity, d === "up" ? 0.012 : 0.016, d === "up" ? notes.slice(-4) : undefined);
      break;
    }
    case "pulse":
      for (let b = 0; b < beats; b += 0.5) strum(b, "down", b % 1 === 0 ? 0.8 : 0.6, 0.35, 0.008, notes.slice(0, Math.min(3, notes.length)));
      break;
    case "arpeggio": {
      const seq = [...notes, ...notes.slice(1, -1).reverse()];
      let i = 0;
      for (let b = 0; b < beats; b += 0.5) pick(b, seq[i++ % seq.length], i === 1 ? 0.8 : 0.6);
      break;
    }
    case "travis": {
      const bass = notes.slice(0, Math.min(2, notes.length));
      const treble = notes.slice(-3);
      for (let b = 0; b < beats; b += 1) {
        pick(b, bass[(b % 2) % bass.length], 0.75);
        pick(b + 0.5, treble[(b * 2 + 1) % treble.length], 0.55);
        if (b % 2 === 1) pick(b + 0.75, treble[treble.length - 1], 0.45);
      }
      break;
    }
  }
  return ev;
}

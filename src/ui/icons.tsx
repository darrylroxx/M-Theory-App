/** Small line icons, drawn in the text colour. */
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const CopyIcon = () => (
  <svg {...base}><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></svg>
);
export const PasteIcon = () => (
  <svg {...base}><rect x="3" y="3.5" width="10" height="10.5" rx="1.6" /><rect x="5.8" y="1.8" width="4.4" height="3" rx="1" fill="currentColor" stroke="none" /><path d="M8 7.2v4M6.2 9.6 8 11.4l1.8-1.8" /></svg>
);
/** Six dots: something to take hold of and drag. */
export const GripIcon = () => (
  <svg {...base} fill="currentColor" stroke="none"><circle cx="5.5" cy="3.5" r="1.4" /><circle cx="10.5" cy="3.5" r="1.4" /><circle cx="5.5" cy="8" r="1.4" /><circle cx="10.5" cy="8" r="1.4" /><circle cx="5.5" cy="12.5" r="1.4" /><circle cx="10.5" cy="12.5" r="1.4" /></svg>
);
export const MicIcon = () => (
  <svg {...base}><rect x="6" y="1.8" width="4" height="7.4" rx="2" /><path d="M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2" /></svg>
);
export const EarIcon = () => (
  <svg {...base}><path d="M3 8a5 5 0 0 1 10 0v3.2a1.6 1.6 0 0 1-1.6 1.6h-.6V8.6H13M3 8.6h2.2v4.2h-.6A1.6 1.6 0 0 1 3 11.2Z" /></svg>
);
export const OpenIcon = () => (
  <svg {...base}><path d="M2 5a1.4 1.4 0 0 1 1.4-1.4h2.7l1.4 1.7h5.1A1.4 1.4 0 0 1 14 6.7v4.9a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 11.6Z" /></svg>
);

/**
 * A bass clef: the head, the curl and the two dots. The "compose" button of every track is this drawing alone.
 * (Drawn as lines, not typed as a letter, so it looks the same on every machine.)
 */
export const ClefIcon = () => (
  <svg {...base} width={18} height={18} strokeWidth={1.7}>
    <circle cx="4.4" cy="6.4" r="1.55" fill="currentColor" stroke="none" />
    <path d="M4.4 6.4C4.2 3.6 6.2 2.1 8.3 2.1c2.4 0 3.9 1.7 3.9 4 0 3.5-3.2 6.2-8.3 7.9" />
    <circle cx="14.3" cy="4.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.3" cy="8" r="1" fill="currentColor" stroke="none" />
  </svg>
);

// ── what kind of track a row is ──
/** Chords: three notes on one stem. */
export const ChordsKindIcon = () => (
  <svg {...base}><path d="M10.2 12.2V2.6" /><ellipse cx="7.7" cy="12.4" rx="2.5" ry="1.7" fill="currentColor" stroke="none" /><ellipse cx="7.7" cy="8.6" rx="2.5" ry="1.7" fill="currentColor" stroke="none" /><ellipse cx="7.7" cy="4.8" rx="2.5" ry="1.7" fill="currentColor" stroke="none" /></svg>
);
/** Melody: one note with its flag. */
export const MelodyKindIcon = () => (
  <svg {...base}><ellipse cx="6.2" cy="12" rx="2.6" ry="1.9" fill="currentColor" stroke="none" /><path d="M8.8 12V2.6c.4 2 3.2 2.6 3.2 5.2" /></svg>
);
/** Bass: four strings over a nut. (Not a clef: that is the compose button.) */
export const BassKindIcon = () => (
  <svg {...base}><path d="M3 2.4v11.2" strokeWidth={2.2} /><path d="M3 3.6h10.6" strokeWidth={0.9} /><path d="M3 6.5h10.6" strokeWidth={1.2} /><path d="M3 9.5h10.6" strokeWidth={1.6} /><path d="M3 12.4h10.6" strokeWidth={2} /></svg>
);
/** Drums: a drum seen from the side. */
export const DrumsKindIcon = () => (
  <svg {...base}><ellipse cx="8" cy="5.4" rx="5.6" ry="2.3" /><path d="M2.4 5.4v5.2c0 1.3 2.5 2.3 5.6 2.3s5.6-1 5.6-2.3V5.4" /></svg>
);
/** Vocals: a microphone. */
export const VocalsKindIcon = MicIcon;
/** A blank audio track: a wave. */
export const AudioKindIcon = () => (
  <svg {...base}><path d="M2 8v0M4.4 6v4M6.8 3.6v8.8M9.2 5.4v5.2M11.6 2.6v10.8M14 6.6v2.8" /></svg>
);
/** The icon of a kind of track. */
export function KindIcon({ kind }: { kind: "chords" | "melody" | "bass" | "drums" | "vocals" | "audio" }) {
  return kind === "chords" ? <ChordsKindIcon /> : kind === "melody" ? <MelodyKindIcon /> : kind === "bass" ? <BassKindIcon /> : kind === "drums" ? <DrumsKindIcon /> : kind === "vocals" ? <VocalsKindIcon /> : <AudioKindIcon />;
}

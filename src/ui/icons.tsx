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

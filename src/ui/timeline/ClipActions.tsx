// What can be done to a clip, twice: as the small row of buttons that stands on a selected clip, and as the lines
// of its right-click menu with the names and keys written out. Nothing about a clip is a key only.
import type { AudioClip, Clip, Take5 } from "../../timeline/model";
import { CopyIcon } from "../icons";
import type { MenuItem } from "./Menu";

export type ClipAct = "open" | "mute" | "split" | "duplicate" | "copy" | "delete";

const line = { width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const ICON: Record<ClipAct, React.ReactNode> = {
  // a box with an arrow out of it
  open: <svg {...line}><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></svg>,
  // a speaker, crossed out
  mute: <svg {...line}><path d="M2.5 6.2h2.2l3-2.5v8.6l-3-2.5H2.5ZM10.6 6.2l3.2 3.6M13.8 6.2l-3.2 3.6" /></svg>,
  // a cut down the middle
  split: <svg {...line}><path d="M8 1.8v12.4" strokeDasharray="1.6 2.2" /><path d="M2 5h3.6v6H2M14 5h-3.6v6H14" /></svg>,
  // one box, and the same again beside it
  duplicate: <svg {...line}><rect x="2" y="4.5" width="5.4" height="7" rx="1.2" /><rect x="8.6" y="4.5" width="5.4" height="7" rx="1.2" strokeDasharray="1.8 1.6" /></svg>,
  copy: <CopyIcon />,
  // a bin
  delete: <svg {...line}><path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.4 4.5l.6 8a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8M6.8 7v3.8M9.2 7v3.8" /></svg>,
};
const ACTS: { act: ClipAct; name: string; key: string }[] = [
  { act: "open", name: "Open", key: "Enter" },
  { act: "mute", name: "Mute", key: "0" },
  { act: "split", name: "Split", key: "S" },
  { act: "duplicate", name: "Duplicate", key: "Ctrl+D" },
  { act: "copy", name: "Copy", key: "Ctrl+C" },
  { act: "delete", name: "Delete", key: "Del" },
];

/** The row of six buttons on a selected clip. `x`, `y`: where it stands over the lanes. */
export function ClipActions({ clip, x, y, onAct }: { clip: Clip; x: number; y: number; onAct(act: ClipAct): void }) {
  return (
    <div className="tlc-acts" role="toolbar" aria-label="This clip" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {ACTS.map(({ act, name, key }) => {
        const said = act === "mute" && clip.mute ? "Unmute" : name;
        return (
          <button key={act} className={`tlc-act${act === "mute" && clip.mute ? " on" : ""}${act === "delete" ? " danger" : ""}`} aria-label={said} title={`${said} (${key})`} onClick={() => onAct(act)}>{ICON[act]}</button>
        );
      })}
    </div>
  );
}

/**
 * The same list as a menu's lines. A recorded clip adds "Hear alone" and, where its spot has other takes, a line for each.
 * `takes`: the other takes that could play in this clip's place.
 */
export function clipMenu(clip: Clip, onAct: (act: ClipAct) => void, more?: { hear(): void; takes: Take5[]; useTake(take: Take5): void }): MenuItem[] {
  const items: MenuItem[] = ACTS.map(({ act, name, key }) => ({ label: act === "mute" && clip.mute ? "Unmute" : act === "split" ? "Split here" : name, hint: key, danger: act === "delete", run: () => onAct(act) }));
  if (clip.kind === "audio" && more) {
    items.splice(items.length - 1, 0, { sep: true }, { label: "Hear alone", run: more.hear });
    if (more.takes.length) {
      items.splice(items.length - 1, 0, { title: "Take" }, ...more.takes.map((t): MenuItem => ({ label: `Take ${t.n}${t.keep ? " ★" : ""}`, on: t.id === clip.take, run: () => more.useTake(t) })));
    }
    items.splice(items.length - 1, 0, { sep: true });
  }
  return items;
}

/** The takes that could play where a recorded clip is: those of the same recording, or sung from the same beat at the same rate, and long enough. */
export function otherTakes(clip: AudioClip, takes: Take5[]): Take5[] {
  const mine = takes.find((t) => t.id === clip.take);
  if (!mine) return [];
  const fits = takes.filter((t) => (t.group === mine.group || (t.at !== null && t.at === mine.at && t.rate === mine.rate)) && t.frames >= clip.to);
  return fits.length > 1 ? fits : [];
}

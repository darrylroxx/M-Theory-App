// The take list of a track that records, on a song of tracks and clips: every take of every recording, newest
// recording first, its passes as they were sung, to sift through. Hear each alone, ★ the keepers, use one, delete the
// rest, remove a whole recording. Below them, when a track that had recordings was removed: "Removed recordings",
// where each can be used on this track, and the lot can be emptied.
//
// One take is selected: ‹ › or the arrow keys step through them (hearing each in turn while one is being heard),
// Space hears it or stops, Enter uses it, K ★s it, Delete deletes it. It reads no app state: the track, the song's
// clips and the shelf come in, and every change goes out as a call.
import { useEffect, useRef, useState } from "react";
import { groupsOf } from "../../../song/takes";
import type { AudioTrack, Clip, Shelved, Take5 } from "../../../timeline/model";

export interface TakeList5Props {
  track: AudioTrack;
  /** the song's clips: those of this track say which takes play */
  clips: readonly Clip[];
  /** the takes of tracks that were removed */
  shelf?: readonly Shelved[];
  /** the take being heard alone */
  alone: string | null;
  /** can a take be heard here? (Only where the recordings are: in the desktop app.) */
  canHear: boolean;
  /** a recording runs: nothing is deleted or removed meanwhile */
  running: boolean;
  /** hear a take alone, or stop it when it is the one heard */
  onHear(take: Take5): void;
  onKeep(take: Take5, keep: boolean): void;
  /** this take plays: in every clip of its spot, or laid as a clip when nothing of its spot is on the lane */
  onUse(take: Take5): void;
  onDrop(take: Take5): void;
  onRemove(group: string): void;
  /** a take from the shelf: its recording comes onto this track, laid at the cursor */
  onShelfUse(take: Take5): void;
  onEmpty(): void;
  /** how the list starts out: short takes shown, kept ones only */
  shorts?: boolean;
  starOnly?: boolean;
}

/** How long a take is, as m:ss. */
const lengthOf = (t: Take5) => {
  const sec = Math.round(t.frames / (t.rate > 0 ? t.rate : 48000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
/** Only a box that takes words keeps the list's keys to itself. */
const isTyping = (el: EventTarget | null) => typeof HTMLElement !== "undefined" && el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export function TakeList5(p: TakeList5Props) {
  const { track, alone, canHear, running } = p;
  const [starOnly, setStarOnly] = useState(!!p.starOnly);
  const [shorts, setShorts] = useState(!!p.shorts);
  const [sel, setSel] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const takes = track.takes;
  const used = new Set<string>();
  for (const c of p.clips) if (c.kind === "audio" && c.track === track.id) used.add(c.take);
  // newest recording first, its passes as they were sung; a short last pass only when asked for (or when it is ★, or plays)
  const groups = groupsOf(takes as unknown as Parameters<typeof groupsOf>[0]).reverse();
  const shown = (t: Take5) => (!starOnly || !!t.keep) && (shorts || !t.short || !!t.keep || used.has(t.id));
  const list = groups.flatMap((g) => takes.filter((t) => t.group === g && shown(t)));
  const at = list.findIndex((t) => t.id === sel);
  const cur = at >= 0 ? list[at] : undefined;
  const shelf = (p.shelf ?? []).filter((s) => s.takes.length > 0);

  const step = (d: 1 | -1) => {
    const next = list[at < 0 ? (d > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + d))];
    if (!next) return;
    setSel(next.id);
    // stepping while one is heard hears the next
    if (alone && alone !== next.id && canHear) p.onHear(next);
  };
  const drop = (t: Take5) => {
    if (sel === t.id) {
      // the selection moves on to the next take in the list
      const i = list.findIndex((x) => x.id === t.id);
      setSel((list[i + 1] ?? list[i - 1])?.id ?? null);
    }
    p.onDrop(t);
  };
  // the selected take stays in view (scrolled within the list only, never the window)
  useEffect(() => {
    if (!sel) return;
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-take="${CSS.escape(sel)}"]`);
    if (!el || !box) return;
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
  }, [sel]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const k = e.key;
    let done = true;
    if (k === "ArrowDown" || k === "ArrowRight") step(1);
    else if (k === "ArrowUp" || k === "ArrowLeft") step(-1);
    else if (k === " " && cur && canHear) p.onHear(cur);
    else if (k === "Enter" && cur && (e.target as HTMLElement) === listRef.current) p.onUse(cur);
    else if ((k === "k" || k === "K") && cur) p.onKeep(cur, !cur.keep);
    else if ((k === "Delete" || k === "Backspace") && cur && !running) drop(cur);
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  /** after a button in the list, the keys go to the list again (Space plays, not presses the button again) */
  const focus = () => listRef.current?.focus({ preventScroll: true });
  const count = (g: string) => takes.filter((t) => t.group === g).length;

  if (!takes.length && !shelf.length) return null;
  return (
    <div className="vc-takes">
      {takes.length > 0 && (
        <>
          <div className="row tb-head">
            <b className="vc-title">Takes</b>
            <span className="seg" role="radiogroup" aria-label="Which takes">
              <button role="radio" aria-checked={!starOnly} className={!starOnly ? "on" : ""} onClick={() => setStarOnly(false)}>All</button>
              <button role="radio" aria-checked={starOnly} className={starOnly ? "on" : ""} onClick={() => setStarOnly(true)} aria-label="Kept only">★</button>
            </span>
            <span className="tb-step">
              <button className="btn sm" aria-label="Previous take" title="Previous take (←)" disabled={!list.length} onClick={() => { step(-1); focus(); }}>‹</button>
              <button className="btn sm" aria-label="Next take" title="Next take (→)" disabled={!list.length} onClick={() => { step(1); focus(); }}>›</button>
            </span>
            <span className="spacer" />
            {takes.some((t) => t.short) && <label className="toggle vc-mini"><input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} /> Short takes</label>}
          </div>
          <div className="tb-list" ref={listRef} role="listbox" aria-label="Takes" tabIndex={0} data-keys="takes" onKeyDown={onKey}>
            {groups.map((g, gi) => {
              const mine = list.filter((t) => t.group === g);
              return (
                <div key={g} className="tb-group" role="group" aria-label={`Recording ${groups.length - gi}`}>
                  <div className="tb-rec">
                    <b>● {groups.length - gi}</b>
                    <span className="tiny muted">{count(g)} take{count(g) === 1 ? "" : "s"}</span>
                    <span className="spacer" />
                    <button className="btn sm" aria-label="Remove this recording" title="Remove this recording and all its takes (the files stay)" disabled={running} onClick={() => p.onRemove(g)}>Remove</button>
                  </div>
                  {mine.map((t) => {
                    const on = used.has(t.id);
                    const loose = t.at === null;
                    return (
                      <div key={t.id} data-take={t.id} role="option" aria-selected={t.id === sel} className={`tb-take${t.id === sel ? " sel" : ""}${on ? " used" : ""}${alone === t.id ? " heard" : ""}`}
                        onClick={() => { setSel(t.id); focus(); }}>
                        {canHear && <button className="icon-btn tb-play" aria-label={alone === t.id ? "Stop" : `Hear take ${t.n} alone`} title={alone === t.id ? "Stop (Space)" : "Hear it alone (Space)"} onClick={(e) => { e.stopPropagation(); setSel(t.id); p.onHear(t); focus(); }}>{alone === t.id ? "■" : "▶"}</button>}
                        <span className="tb-n">Take {t.n}{t.short ? " ·" : ""}</span>
                        <span className="tb-len tiny muted mono">{lengthOf(t)}</span>
                        {loose && <span className="tb-loose tiny" title="Not on the timeline: Use lays it at the cursor">not placed</span>}
                        <button className={`icon-btn vc-keep${t.keep ? " on" : ""}`} aria-pressed={!!t.keep} aria-label={`Keep take ${t.n} ★`} title="Keep ★ (K)" onClick={(e) => { e.stopPropagation(); setSel(t.id); p.onKeep(t, !t.keep); focus(); }}>★</button>
                        <button className={`btn sm tb-use${on ? " on" : ""}`} aria-pressed={on} aria-label={`Use take ${t.n}`} title={loose ? "Lay this take at the cursor (Enter)" : "This take plays here (Enter)"} onClick={(e) => { e.stopPropagation(); setSel(t.id); p.onUse(t); focus(); }}>Use</button>
                        <button className="icon-btn" aria-label={`Delete take ${t.n}`} title="Delete this take (the file stays)" disabled={running} onClick={(e) => { e.stopPropagation(); drop(t); focus(); }}>✕</button>
                      </div>
                    );
                  })}
                  {!mine.length && <div className="tiny muted tb-none">{starOnly ? "No ★ takes" : "—"}</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {shelf.length > 0 && (
        <div className="tb-shelf" role="group" aria-label="Removed recordings">
          <div className="tb-rec">
            <b>Removed recordings</b>
            <span className="tiny muted">from tracks that were removed</span>
            <span className="spacer" />
            <button className="btn sm" aria-label="Empty the removed recordings" title="Take these out of the song (the files stay)" disabled={running} onClick={p.onEmpty}>Empty</button>
          </div>
          {shelf.map((s) => {
            const recs = groupsOf(s.takes as unknown as Parameters<typeof groupsOf>[0]);
            return (
              <div key={s.track} className="tb-group" role="group" aria-label={`Removed from ${s.name}`}>
                <div className="tiny muted tb-from">{s.name}</div>
                {s.takes.map((t) => (
                  <div key={t.id} className={`tb-take${alone === t.id ? " heard" : ""}`}>
                    {canHear && <button className="icon-btn tb-play" aria-label={alone === t.id ? "Stop" : `Hear take ${t.n} of ${s.name} alone`} title={alone === t.id ? "Stop" : "Hear it alone"} onClick={() => p.onHear(t)}>{alone === t.id ? "■" : "▶"}</button>}
                    <span className="tb-n">{recs.length > 1 ? `● ${recs.indexOf(t.group) + 1} · ` : ""}Take {t.keep ? "★" : ""}{t.n}{t.short ? " ·" : ""}</span>
                    <span className="tb-len tiny muted mono">{lengthOf(t)}</span>
                    <button className="btn sm tb-use" aria-label={`Use take ${t.n} of ${s.name} on ${track.name}`} title={`Bring this recording onto ${track.name}, at the cursor`} disabled={running} onClick={() => p.onShelfUse(t)}>Use</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

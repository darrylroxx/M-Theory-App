import { useEffect, useMemo, useRef, useState } from "react";
import { saveFile, unzipFirst } from "../../audio/midi";
import { getScale } from "../../theory/scales";
import { displayNote } from "../../theory/notes";
import { barMap } from "../../timeline/bars";
import { backupSource } from "../../timeline/convert";
import { songEnd } from "../../timeline/edit";
import { describeIdea5, exportIdeas5, ideaTime5, type SavedIdea } from "../../timeline/library5";
import { useApp5 } from "../app5";
import type { SavedProgression } from "../state";
import { ESC_OPEN, onEscape } from "../timeline/keys";

const when = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/** What an idea is made of, in a line: its tracks by name, and how many bars it has. */
export function ideaShape(i: SavedIdea): string {
  const s = i.song;
  const end = songEnd(s);
  const bars = end > 0 ? barMap(s).barAt(end - 1e-6).bar + 1 : 0;
  const names = s.tracks.filter((t) => s.clips.some((c) => c.track === t.id) || ("takes" in t && t.takes.length > 0)).map((t) => t.name);
  return `${names.length ? names.join(", ") : "No tracks yet"} · ${bars} bar${bars === 1 ? "" : "s"}`;
}

/** The library: every idea you have saved. Tap one to open it. The originals from before the track view are folded under one row at the end. */
export function IdeasPanel({ onClose, justSaved }: { onClose: () => void; justSaved?: boolean }) {
  const { state, idea, dirty, saveIdea, openIdea, newIdea, renameIdea, deleteIdea, importIdeas, cloud, syncNow, toast, recordingTo } = useApp5();
  /** an action waiting for "save first?" */
  const [pending, setPending] = useState<{ run: () => void; label: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [folded, setFolded] = useState(true);
  const file = useRef<HTMLInputElement>(null);
  const firstName = useRef<HTMLInputElement>(null);
  const ideas = useMemo(() => state.saved.filter((i) => !i.backup).sort((a, b) => ideaTime5(b) - ideaTime5(a)), [state.saved]);
  const backups = useMemo(() => state.saved.filter((i) => i.backup), [state.saved]);
  /** the backup entries whose original can be read on this device (the others are not shown), with each original */
  const [found, setFound] = useState<Record<string, SavedProgression>>({});
  const backupIds = backups.map((b) => b.id).join("|");
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, SavedProgression> = {};
      for (const b of backups) {
        const orig = await backupSource(b.id).catch(() => null);
        if (orig) out[b.id] = orig;
      }
      if (live) setFound(out);
    })();
    return () => { live = false; };
  }, [backupIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownBackups = backups.filter((b) => found[b.id]).sort((a, b) => ideaTime5(b) - ideaTime5(a));

  // Escape closes the library (one thing per press: the track view's keys ask whoever is open first)
  useEffect(() => {
    const off = onEscape(ESC_OPEN, () => (onClose(), true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  // opening the library is the moment to connect it to the account
  useEffect(() => {
    if (cloud === "local") syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // straight after the first save: ready to type a name
  useEffect(() => {
    if (justSaved) firstName.current?.select();
  }, [justSaved]);

  /** Leaving the idea on screen: offer to save it first when it has changes (never while recording: its takes go into this idea). */
  const leave = (label: string, run: () => void) => (recordingTo ? toast("Stop recording first") : dirty ? setPending({ label, run }) : run());
  const open = (id: string) => leave("open it", () => { openIdea(id); onClose(); });
  const fresh = () => leave("start a new one", () => { newIdea(); onClose(); toast("New idea"); });
  const backup = async () => {
    // (the file carries the original of every backup entry, so the entries open on another computer too)
    const originals: Record<string, SavedProgression> = {};
    for (const b of backups) {
      const orig = found[b.id] ?? (await backupSource(b.id).catch(() => null));
      if (orig) originals[b.id] = orig;
    }
    const r = await saveFile(new TextEncoder().encode(exportIdeas5(state.saved, originals)), "m-theory-ideas.json", "application/json");
    toast(r === "saved" ? "Backup saved" : r === "failed" ? "Can't save files here" : "Cancelled");
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    const raw = new Uint8Array(await f.arrayBuffer());
    const text = new TextDecoder().decode(unzipFirst(raw) ?? raw);
    let any = false;
    try {
      const data = JSON.parse(text) as { ideas?: unknown[] };
      any = Array.isArray(data?.ideas) && data.ideas.length > 0;
    } catch {
      any = false;
    }
    if (!any) return toast("That file has no ideas in it");
    const added = importIdeas(text);
    toast(added ? `${added} ${added === 1 ? "idea" : "ideas"} added` : "Those ideas are already here");
  };
  const remove = (i: SavedIdea) =>
    confirm === i.id
      ? <button className="btn sm danger solid" onClick={() => { deleteIdea(i.id); setConfirm(null); }}>Delete?</button>
      : <button className="btn sm danger" aria-label={`Delete ${i.name}`} onClick={() => { setConfirm(i.id); window.setTimeout(() => setConfirm((c) => (c === i.id ? null : c)), 3500); }}>✕</button>;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet ideas" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Your ideas" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Ideas</h2>
          <button className="btn sm primary" onClick={fresh}>+ New idea</button>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        {pending && (
          <div className="ideas-ask" role="alertdialog" aria-label="Unsaved changes">
            <b>Save what you have first?</b>
            <div className="row tight">
              <button className="btn sm primary" onClick={() => { saveIdea(); const run = pending.run; setPending(null); setTimeout(run, 0); }}>Save, then {pending.label}</button>
              <button className="btn sm danger" onClick={() => { const run = pending.run; setPending(null); run(); }}>Don't save</button>
              <button className="btn sm" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}

        {!ideas.length && <p className="empty">Nothing saved yet. Build something, then tap <b>Save</b>.</p>}
        <div className="ideas-list">
          {ideas.map((i) => {
            const here = i.id === idea?.id;
            return (
              <div key={i.id} className={`idea${here ? " here" : ""}`}>
                <div className="idea-main">
                  <input ref={here ? firstName : undefined} className="idea-name" value={i.name} aria-label="Name" onChange={(e) => renameIdea(i.id, e.target.value)} />
                  <div className="tiny muted ellipsis">{describeIdea5(i)}</div>
                  <div className="tiny faint ellipsis">{ideaShape(i)} · {displayNote(i.key.tonic)} {getScale(i.key.scaleId).short} · {i.song.bpm} bpm · {when(ideaTime5(i))}</div>
                </div>
                {here
                  ? <button className="btn sm" disabled={!dirty} onClick={() => { saveIdea(); toast("Saved"); }}>{dirty ? "Save" : "Open now"}</button>
                  : <button className="btn sm primary" onClick={() => open(i.id)}>Open</button>}
                {remove(i)}
              </div>
            );
          })}
        </div>

        {idea && <button className="btn sm ideas-copy" onClick={() => { saveIdea(true); toast("Saved as a copy"); }}>Save a copy of "{idea.name}"</button>}

        {shownBackups.length > 0 && (
          <div className="ideas-before">
            <button className="ideas-fold" aria-expanded={!folded} onClick={() => setFolded(!folded)} title="Your ideas as they were before the track view: opening one makes a new idea from it, and leaves it as it is">
              <span aria-hidden="true">{folded ? "▸" : "▾"}</span> Before track view ({shownBackups.length})
            </button>
            {!folded && (
              <div className="ideas-list">
                {shownBackups.map((i) => (
                  <div key={i.id} className="idea backup">
                    <div className="idea-main">
                      <div className="idea-name fixed ellipsis" title={i.name}>{i.name}</div>
                      <div className="tiny faint">{displayNote(i.key.tonic)} {getScale(i.key.scaleId).short} · {found[i.id]?.progression.bpm ?? ""} bpm · {when(ideaTime5(i))}</div>
                    </div>
                    <button className="btn sm" title="Opens a fresh copy as a new idea; this one stays" onClick={() => open(i.id)}>Open</button>
                    {remove(i)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="ideas-foot">
          <span className="tiny muted">
            {cloud === "synced" ? "✓ Saved to your account, on every device" : cloud === "connecting" ? "Connecting…" : cloud === "error" ? "Couldn't reach your account. Ideas are safe in this browser." : "Saved in this browser"}
          </span>
          {cloud === "error" && <button className="btn sm" onClick={syncNow}>Try again</button>}
          <span className="spacer" />
          <button className="btn sm" disabled={!ideas.length && !backups.length} onClick={backup} title="Save all ideas to a file">Backup</button>
          <button className="btn sm" onClick={() => file.current?.click()} title="Add ideas from a backup file">Restore</button>
          <input ref={file} type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

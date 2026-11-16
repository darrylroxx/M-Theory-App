import { useEffect, useRef, useState } from "react";
import { saveFile, unzipFirst } from "../../audio/midi";
import { describeIdea, exportIdeas, ideaTime, importIdeas as readBackup } from "../../song/library";
import { getScale } from "../../theory/scales";
import { displayNote } from "../../theory/notes";
import { useApp } from "../state";

const when = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/** The library: every idea you have saved. Tap one to open it. */
export function IdeasPanel({ onClose, justSaved }: { onClose: () => void; justSaved?: boolean }) {
  const { state, idea, dirty, saveIdea, openIdea, newIdea, renameIdea, deleteIdea, importIdeas, cloud, syncNow, toast } = useApp();
  /** an action waiting for "save first?" */
  const [pending, setPending] = useState<{ run: () => void; label: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const firstName = useRef<HTMLInputElement>(null);
  const ideas = [...state.saved].sort((a, b) => ideaTime(b) - ideaTime(a));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // opening the library is the moment to connect it to the Claude account
  useEffect(() => {
    if (cloud === "local") syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // straight after the first save: ready to type a name
  useEffect(() => {
    if (justSaved) firstName.current?.select();
  }, [justSaved]);

  /** Leaving the idea on screen: offer to save it first when it has changes. */
  const leave = (label: string, run: () => void) => (dirty ? setPending({ label, run }) : run());
  const open = (id: string) => leave("open it", () => { openIdea(id); onClose(); });
  const fresh = () => leave("start a new one", () => { newIdea(); onClose(); toast("New idea"); });
  const backup = async () => {
    const r = await saveFile(new TextEncoder().encode(exportIdeas(state.saved)), "m-theory-ideas.json", "application/json");
    toast(r === "saved" ? "Backup saved" : r === "failed" ? "Can't save files here" : "Cancelled");
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    const raw = new Uint8Array(await f.arrayBuffer());
    const found = readBackup(new TextDecoder().decode(unzipFirst(raw) ?? raw));
    if (!found.length) return toast("That file has no ideas in it");
    const added = importIdeas(found);
    toast(added ? `${added} ${added === 1 ? "idea" : "ideas"} added` : "Those ideas are already here");
  };

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
                  <div className="tiny muted ellipsis">{describeIdea(i)}</div>
                  <div className="tiny faint">{displayNote(i.key.tonic)} {getScale(i.key.scaleId).short} · {i.progression.bpm} bpm · {when(ideaTime(i))}</div>
                </div>
                {here
                  ? <button className="btn sm" disabled={!dirty} onClick={() => { saveIdea(); toast("Saved"); }}>{dirty ? "Save" : "Open now"}</button>
                  : <button className="btn sm primary" onClick={() => open(i.id)}>Open</button>}
                {confirm === i.id
                  ? <button className="btn sm danger solid" onClick={() => { deleteIdea(i.id); setConfirm(null); }}>Delete?</button>
                  : <button className="btn sm danger" aria-label={`Delete ${i.name}`} onClick={() => { setConfirm(i.id); window.setTimeout(() => setConfirm((c) => (c === i.id ? null : c)), 3500); }}>✕</button>}
              </div>
            );
          })}
        </div>

        {idea && <button className="btn sm ideas-copy" onClick={() => { saveIdea(true); toast("Saved as a copy"); }}>Save a copy of "{idea.name}"</button>}

        <div className="ideas-foot">
          <span className="tiny muted">
            {cloud === "synced" ? "✓ Saved to your Claude account, on every device" : cloud === "connecting" ? "Connecting…" : cloud === "error" ? "Couldn't reach your Claude account. Ideas are safe in this browser." : "Saved in this browser"}
          </span>
          {cloud === "error" && <button className="btn sm" onClick={syncNow}>Try again</button>}
          <span className="spacer" />
          <button className="btn sm" disabled={!ideas.length} onClick={backup} title="Save all ideas to a file">Backup</button>
          <button className="btn sm" onClick={() => file.current?.click()} title="Add ideas from a backup file">Restore</button>
          <input ref={file} type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

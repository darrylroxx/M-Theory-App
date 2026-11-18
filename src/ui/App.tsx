import { Component, useState, type ReactNode } from "react";
import { IdeasPanel } from "./components/IdeasPanel";
import { DraftBadge, UpdateBar } from "./components/Desktop";
import { SettingsPanel } from "./components/SettingsPanel";
import { AppProvider, PANES, useApp, type Pane } from "./state";
import { useLive } from "./live";
import { GuitarView } from "./views/GuitarView";

class ViewBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty stack" style={{ alignItems: "center" }}>
        <h2>Something went wrong in this view</h2>
        <p className="small muted mono">{this.state.error.message}</p>
        <button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>Reload view</button>
      </div>
    );
  }
}

function Shell() {
  const { state, set, idea, dirty, saveIdea, toast, syncNow } = useApp();
  const live = useLive();
  const [settings, setSettings] = useState(false);
  const [ideas, setIdeas] = useState<false | "open" | "named">(false);
  const save = () => {
    const r = saveIdea();
    if (r === "nothing") return toast("Nothing to save yet");
    syncNow();
    // the first save opens the library so the idea can be named
    if (r === "new") setIdeas("named");
    else toast("Saved");
  };
  const page = state.pane ?? "frame";
  /** Open a page at its top. (On a phone the first row of the bar scrolls away; the page tabs stay.) */
  const go = (pane: Pane) => {
    set((s) => ({ ...s, pane }));
    const bar = document.querySelector<HTMLElement>(".topbar");
    const gone = bar ? Math.max(0, -parseFloat(getComputedStyle(bar).top) || 0) : 0;
    window.scrollTo({ top: Math.min(window.scrollY, gone) });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><div className="brand-mark">M</div><span>M-Theory</span><DraftBadge /></div>
          <nav className="tabs" aria-label="Pages">
            {PANES.map((t) => (
              <button key={t.id} className={`tab${page === t.id ? " active" : ""}`} aria-current={page === t.id ? "page" : undefined} onClick={() => go(t.id)}>{t.label}{t.id === "vocals" && live && <span className="live-dot" title="Your mic is live: you hear yourself through your effects on every page" aria-label="(mic live)" />}</button>
            ))}
          </nav>
          <button className={`btn sm save-btn${dirty ? " primary" : ""}`} onClick={save} disabled={!dirty} title={idea ? `Save "${idea.name}"` : "Save this idea to your library"}>{dirty || !idea ? "Save" : "Saved ✓"}</button>
          <button className="btn sm ideas-btn" onClick={() => setIdeas("open")} title="Your saved ideas" aria-haspopup="dialog">Ideas{state.saved.length ? <span className="count">{state.saved.length}</span> : null}</button>
          <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Guitar setup" title="Tuning, capo & display">⚙</button>
        </div>
      </header>
      <UpdateBar />
      <main>
        <ViewBoundary onReset={() => go("frame")}>
          <GuitarView />
        </ViewBoundary>
      </main>
      {settings && <SettingsPanel onClose={() => setSettings(false)} />}
      {ideas && <IdeasPanel onClose={() => setIdeas(false)} justSaved={ideas === "named"} />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

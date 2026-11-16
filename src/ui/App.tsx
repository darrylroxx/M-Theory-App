import { Component, useState, type ReactNode } from "react";
import { ChordSheet } from "./components/ChordSheet";
import { SettingsPanel } from "./components/KeyPicker";
import { AppProvider, useApp, type Tab } from "./state";
import { ChordsView } from "./views/ChordsView";
import { LearnView } from "./views/LearnView";
import { WriteView } from "./views/WriteView";

const TABS: { id: Tab; label: string }[] = [
  { id: "write", label: "Write" },
  { id: "chords", label: "Chords" },
  { id: "learn", label: "Learn" },
];

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
        <button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>Back to Write</button>
      </div>
    );
  }
}

function Shell() {
  const { state, set } = useApp();
  const [settings, setSettings] = useState(false);
  const go = (tab: Tab) => {
    set((s) => ({ ...s, tab }));
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><div className="brand-mark">M</div><span>M-Theory</span></div>
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} className={`tab${state.tab === t.id ? " active" : ""}`} aria-current={state.tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>{t.label}</button>
            ))}
          </nav>
          <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Guitar setup" title="Tuning, capo & display">⚙</button>
        </div>
      </header>
      <main className={state.tab === "write" ? "has-dock" : ""}>
        <ViewBoundary key={state.tab} onReset={() => go("write")}>
          {state.tab === "write" && <WriteView />}
          {state.tab === "chords" && <ChordsView />}
          {state.tab === "learn" && <LearnView />}
        </ViewBoundary>
      </main>
      <ChordSheet />
      {settings && <SettingsPanel onClose={() => setSettings(false)} />}
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

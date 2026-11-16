import { Component, useState, type ReactNode } from "react";
import { displayNote } from "../theory/notes";
import { getScale } from "../theory/scales";
import { ChordSheet } from "./components/ChordSheet";
import { KeyPicker, SettingsPanel } from "./components/KeyPicker";
import { AppProvider, useApp, type Tab } from "./state";
import { ChordsView } from "./views/ChordsView";
import { ComposeView } from "./views/ComposeView";
import { KeyView } from "./views/KeyView";
import { LearnView } from "./views/LearnView";
import { NeckView } from "./views/NeckView";

const TABS: { id: Tab; label: string; ico: string }[] = [
  { id: "key", label: "Key", ico: "🔑" },
  { id: "chords", label: "Chords", ico: "🎸" },
  { id: "compose", label: "Compose", ico: "🎼" },
  { id: "neck", label: "Neck", ico: "🎯" },
  { id: "learn", label: "Learn", ico: "💡" },
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
        <button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>Back to the Key view</button>
      </div>
    );
  }
}

function Shell() {
  const { state, set } = useApp();
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const scale = getScale(state.key.scaleId);
  const go = (tab: Tab) => {
    set((s) => ({ ...s, tab }));
    window.scrollTo({ top: 0 });
  };
  const count = state.progression.chords.length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><div className="brand-mark">M</div>M-Theory <small>chord & progression lab</small></div>
          <div className="top-actions">
            <button className="key-button" onClick={() => setPicker(true)} aria-label="Change key">
              <span className="dot" />{displayNote(state.key.tonic)} {scale.short}
            </button>
            <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Guitar setup" title="Tuning, capo & display">
              {state.settings.capo ? <span style={{ fontSize: "0.7rem", fontWeight: 800 }}>C{state.settings.capo}</span> : "⚙"}
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${state.tab === t.id ? " active" : ""}`} onClick={() => go(t.id)}>
              <span className="ico">{t.ico}</span>{t.label}{t.id === "compose" && count > 0 ? ` (${count})` : ""}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <ViewBoundary key={state.tab} onReset={() => go("key")}>
        {state.tab === "key" && <KeyView />}
        {state.tab === "chords" && <ChordsView />}
        {state.tab === "compose" && <ComposeView />}
        {state.tab === "neck" && <NeckView />}
        {state.tab === "learn" && <LearnView />}
        </ViewBoundary>
      </main>
      <nav className="bottom-nav" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={state.tab === t.id ? "active" : ""} onClick={() => go(t.id)}>
            <span className="ico">{t.ico}</span>{t.label}{t.id === "compose" && count > 0 ? ` ${count}` : ""}
          </button>
        ))}
      </nav>
      <ChordSheet />
      {picker && <KeyPicker onClose={() => setPicker(false)} />}
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

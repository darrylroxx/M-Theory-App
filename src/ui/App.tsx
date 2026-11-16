import { Component, useState, type ReactNode } from "react";
import { displayNote } from "../theory/notes";
import { getScale } from "../theory/scales";
import { ChordSheet } from "./components/ChordSheet";
import { KeyPicker, SettingsPanel } from "./components/KeyPicker";
import { AppProvider, useApp, type Tab } from "./state";
import { ChordsView } from "./views/ChordsView";
import { LearnView } from "./views/LearnView";
import { WriteView } from "./views/WriteView";

const TABS: { id: Tab; label: string; ico: string; hint: string }[] = [
  { id: "write", label: "Write", ico: "🎼", hint: "Pick a key, build your song" },
  { id: "chords", label: "Chords", ico: "🎸", hint: "Look up any chord" },
  { id: "learn", label: "Learn", ico: "💡", hint: "Modes, fretboard, theory" },
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
  const { state, set, keyPicker, openKeyPicker } = useApp();
  const [settings, setSettings] = useState(false);
  const scale = getScale(state.key.scaleId);
  const go = (tab: Tab) => {
    set((s) => ({ ...s, tab }));
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><div className="brand-mark">M</div>M-Theory <small>chord & progression lab</small></div>
          <div className="top-actions">
            <button className="key-button" onClick={() => openKeyPicker(true)} aria-label="Change key or mood" title="Change key or mood">
              <span className="dot" />{displayNote(state.key.tonic)} {scale.short}
            </button>
            <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Guitar setup" title="Tuning, capo & display">
              {state.settings.capo ? <span style={{ fontSize: "0.7rem", fontWeight: 800 }}>C{state.settings.capo}</span> : "⚙"}
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${state.tab === t.id ? " active" : ""}`} onClick={() => go(t.id)} title={t.hint}>
              <span className="ico">{t.ico}</span>{t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <ViewBoundary key={state.tab} onReset={() => go("write")}>
          {state.tab === "write" && <WriteView />}
          {state.tab === "chords" && <ChordsView />}
          {state.tab === "learn" && <LearnView />}
        </ViewBoundary>
      </main>
      <nav className="bottom-nav" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={state.tab === t.id ? "active" : ""} onClick={() => go(t.id)}>
            <span className="ico">{t.ico}</span>{t.label}
          </button>
        ))}
      </nav>
      <ChordSheet />
      {keyPicker && <KeyPicker onClose={() => openKeyPicker(false)} />}
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

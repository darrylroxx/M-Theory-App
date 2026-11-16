import { Component, useState, type ReactNode } from "react";
import { SettingsPanel } from "./components/SettingsPanel";
import { AppProvider, useApp, type Tab } from "./state";
import { GuitarView } from "./views/GuitarView";

const TABS: { id: Tab; label: string }[] = [
  { id: "guitar", label: "Guitar" },
  { id: "piano", label: "Piano" },
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
        <button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>Reload view</button>
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
      <main className={state.tab === "guitar" ? "has-dock" : ""}>
        <ViewBoundary key={state.tab} onReset={() => go("guitar")}>
          {state.tab === "guitar" ? <GuitarView /> : <PianoSoon />}
        </ViewBoundary>
      </main>
      {settings && <SettingsPanel onClose={() => setSettings(false)} />}
    </div>
  );
}

/** Placeholder until the piano side is built. */
function PianoSoon() {
  const whites = Array.from({ length: 14 }, (_, i) => i);
  const blacks = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];
  return (
    <section className="card piano-soon">
      <svg viewBox="0 0 280 90" width="280" role="img" aria-label="Piano keyboard">
        {whites.map((i) => <rect key={i} x={i * 20} y={0} width={19} height={90} rx={3} fill="var(--card-2)" stroke="var(--border-2)" />)}
        {blacks.map((i) => <rect key={i} x={i * 20 + 13} y={0} width={13} height={54} rx={2} fill="var(--text)" />)}
      </svg>
      <h2>Piano</h2>
      <p className="muted">Coming soon</p>
    </section>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

// The bar across the top of the track view: play, loop and record; where the music is; the key, the tempo and the
// time signature; undo and redo; the idea and its Save; Export, Canvas, Ideas and settings.
// Each of key, tempo, signature and Export opens a quiet panel under its button, closed by Escape or a press elsewhere.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TIME_SIGS, sameSig, sigName, type TimeSig } from "../../song/meter";
import type { Key } from "../../theory/keys";
import { barMap } from "../../timeline/bars";
import { songEnd } from "../../timeline/edit";
import type { TimelineSong } from "../../timeline/model";
import { CopyIcon } from "../icons";
import type { PlayerApi } from "./api";
import { positionText } from "./gestures";
import { KeyPopover, keyText } from "./KeyPopover";
import { ESC_OPEN, onEscape } from "./keys";

export interface TopBarProps {
  /** what stands at the bar's left end (the draft badge) */
  badge?: ReactNode;
  idea: { name: string | null; dirty: boolean; count: number; save(): void };
  /** a home note or a mode picked */
  onKey(key: Key): void;
  /** "Move song": the notes and the key, one undo step */
  onMove(semitones: number): void;
  onTempo(bpm: number): void;
  /** the signature of the bars the cursor is in, or (`fromHereOn`) from the cursor's bar on */
  onSig(sig: TimeSig, fromHereOn: boolean): void;
  /** what the recordings that play were sung in, where that differs from the song now; each is shown when it is set */
  sung?: { key?: string; bpm?: number; sig?: string };
  undo(): void; redo(): void; canUndo: boolean; canRedo: boolean;
  exports: { wav(): void; midi(): void; chart(): void; busy?: boolean };
  openCanvas(): void; openIdeas(): void; openSettings(): void;
  /** shown when the song has an audio track */
  record?: { on: boolean; busy: boolean; live: boolean; toggle(): void; monitor: "hardware" | "effects"; setMonitor(m: "hardware" | "effects"): void; /** the pass being sung, while recording (shown beside ●) */ pass?: number };
}

/** What the view adds to the host's part: the song, where the cursor is, and what plays it. */
export interface TopBarLive {
  song: TimelineSong;
  keyOf: Key;
  cursor: number;
  player: PlayerApi;
  /** the loop is on */
  looping: boolean;
  onLoop(): void;
}

type Open = "key" | "tempo" | "sig" | "export" | null;

export function TopBar(p: TopBarProps & TopBarLive) {
  const { song, player, cursor } = p;
  const map = barMap(song);
  const [open, setOpen] = useState<Open>(null);
  const [fromHere, setFromHere] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const pos = useRef<HTMLOutputElement>(null);

  // an open panel is put away by Escape and by a press anywhere outside it
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(".tlv-pop, .tlv-popbtn")) return;
      setOpen(null);
    };
    const off = onEscape(ESC_OPEN, () => (setOpen(null), true));
    window.addEventListener("pointerdown", away, true);
    return () => {
      off();
      window.removeEventListener("pointerdown", away, true);
    };
  }, [open]);

  // where the music is: written every frame while it plays, without drawing the bar again
  useEffect(() => {
    const el = pos.current;
    if (!el) return;
    const write = (beat: number) => {
      const text = positionText(map, beat, song.bpm);
      if (el.textContent !== text) el.textContent = text;
    };
    if (!player.playing) return write(cursor);
    let raf = 0;
    const tick = () => {
      write(player.getBeat() ?? cursor);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player, player.playing, cursor, map, song.bpm]);

  // the tempo: its number is dragged, or clicked for the slider
  const tempoDrag = useRef<{ pointer: number; y0: number; x0: number; bpm0: number; moved: boolean } | null>(null);
  const tempoDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button > 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (a pretend pointer) */
    }
    tempoDrag.current = { pointer: e.pointerId, y0: e.clientY, x0: e.clientX, bpm0: song.bpm, moved: false };
  };
  const tempoMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = tempoDrag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const by = d.y0 - e.clientY + (e.clientX - d.x0);
    if (!d.moved && Math.abs(by) < 4) return;
    d.moved = true;
    const to = Math.max(40, Math.min(200, d.bpm0 + Math.round(by / 3)));
    if (to !== song.bpm) p.onTempo(to);
  };
  const tempoUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = tempoDrag.current;
    if (!d || d.pointer !== e.pointerId) return;
    tempoDrag.current = null;
    if (!d.moved) setOpen((o) => (o === "tempo" ? null : "tempo"));
  };

  const end = songEnd(song);
  const secs = Math.round((end * 60) / Math.max(1, song.bpm));
  const bars = map.barAt(end).bar;
  const sig = map.sigAt(cursor);
  const idea = p.idea;
  const rec = p.record;
  const toggle = (which: Exclude<Open, null>) => setOpen((o) => (o === which ? null : which));

  return (
    <header className={`topbar tlv-top${open ? " popped" : ""}`} ref={bar}>
      <div className="tlv-top-in">
        <div className="brand tlv-brand"><div className="brand-mark">M</div>{p.badge}</div>

        <section className="transport tlv-transport" aria-label="Play">
          <button className={`play-btn sm${player.playing ? " stop" : ""}`} aria-label={player.playing ? "Stop" : p.looping ? "Play the loop" : "Play"} title={player.playing ? "Stop (Space)" : "Play from the cursor (Space)"} onClick={() => player.toggle()}>{player.playing ? "■" : "▶"}</button>
          <button className={`tlv-round${p.looping ? " on" : ""}`} aria-pressed={p.looping} aria-label={p.looping ? "Stop looping" : "Loop"} title={p.looping ? "Stop looping: play straight through (L)" : "Loop (L): drag across the ruler to choose what loops"} onClick={p.onLoop}>↻</button>
          {rec && (
            <>
              <button className={`tlv-round rec${rec.on ? " on" : ""}`} aria-pressed={rec.on} aria-label={rec.on ? "Stop recording" : "Record"} disabled={rec.busy} title={rec.on ? "Stop recording" : "Record onto the armed track"} onClick={rec.toggle}>
                ●{rec.live && <span className="live-dot" title="Your mic is live" aria-label="(mic live)" />}
              </button>
              {rec.on && !!rec.pass && <output className="tlv-pass mono" aria-label="Pass being recorded">Pass {rec.pass}</output>}
              <div className="seg tlv-mon" role="radiogroup" aria-label="How you hear yourself while recording">
                <button role="radio" aria-checked={rec.monitor === "hardware"} className={rec.monitor === "hardware" ? "on" : ""} title="Direct: you hear yourself straight from the interface" onClick={() => rec.setMonitor("hardware")}>Direct</button>
                <button role="radio" aria-checked={rec.monitor === "effects"} className={rec.monitor === "effects" ? "on" : ""} title="Through effects: you hear yourself with the track's sound" onClick={() => rec.setMonitor("effects")}>Effects{rec.live && rec.monitor === "effects" && <span className="live-dot" aria-label="(mic live)" />}</button>
              </div>
            </>
          )}
        </section>

        <output className="tlv-pos mono" ref={pos} aria-label="Position: bar, beat and time" title={`The song is ${bars} bar${bars === 1 ? "" : "s"} long, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}>{positionText(map, cursor, song.bpm)}</output>

        <span className="tlv-popwrap">
          <button className={`tlv-val tlv-popbtn${open === "key" ? " on" : ""}`} aria-expanded={open === "key"} aria-label={`Key: ${keyText(p.keyOf)}`} title="Key and mode" onClick={() => toggle("key")}>{keyText(p.keyOf)}{p.sung?.key && <i className="tlv-warn" />}</button>
          {open === "key" && <div className="tlv-pop wide" role="dialog" aria-label="Key" data-keys="own"><KeyPopover keyOf={p.keyOf} onKey={p.onKey} onMove={p.onMove} sung={p.sung?.key} /></div>}
        </span>

        <span className="tlv-popwrap">
          <button className={`tlv-val mono tlv-popbtn tlv-bpm${open === "tempo" ? " on" : ""}`} aria-expanded={open === "tempo"} aria-label={`Tempo: ${song.bpm} beats a minute`} title="Tempo: drag the number, or click for the slider"
            onPointerDown={tempoDown} onPointerMove={tempoMove} onPointerUp={tempoUp} onPointerCancel={() => { tempoDrag.current = null; }}
            onKeyDown={(e) => { if (e.key === "Enter") toggle("tempo"); }}>{song.bpm}<small>bpm</small>{p.sung?.bpm !== undefined && <i className="tlv-warn" />}</button>
          {open === "tempo" && (
            <div className="tlv-pop" role="dialog" aria-label="Tempo" data-keys="own">
              <div className="fr-row fr-slide tlv-tempo">
                <button className="btn sm" aria-label="Slower" onClick={() => p.onTempo(song.bpm - 1)}>−</button>
                <input type="range" min={40} max={200} value={song.bpm} aria-label="Tempo" onChange={(e) => p.onTempo(Number(e.target.value))} />
                <button className="btn sm" aria-label="Faster" onClick={() => p.onTempo(song.bpm + 1)}>+</button>
              </div>
              {p.sung?.bpm !== undefined && (
                <p className="small fr-note" role="note">Vocals: recorded at {p.sung.bpm} bpm
                  <button className="btn sm" aria-label={`Back to ${p.sung.bpm} bpm`} onClick={() => p.onTempo(p.sung!.bpm!)}>↶ {p.sung.bpm}</button>
                </p>
              )}
            </div>
          )}
        </span>

        <span className="tlv-popwrap">
          <button className={`tlv-val mono tlv-popbtn${open === "sig" ? " on" : ""}`} aria-expanded={open === "sig"} aria-label={`Time signature: ${sigName(sig)}`} title="Time signature of the bars the cursor is in" onClick={() => toggle("sig")}>{sigName(sig)}{p.sung?.sig && <i className="tlv-warn" />}</button>
          {open === "sig" && (
            <div className="tlv-pop" role="dialog" aria-label="Time signature" data-keys="own">
              <div className="tlv-sigs" role="radiogroup" aria-label="Time signature">
                {TIME_SIGS.map((m) => (
                  <button key={sigName(m)} role="radio" aria-checked={sameSig(m, sig)} aria-label={sigName(m)} className={`sig sm${sameSig(m, sig) ? " on" : ""}`} onClick={() => { p.onSig(m, fromHere); setOpen(null); }}><b>{m.num}</b><b>{m.den}</b></button>
                ))}
              </div>
              <label className="toggle tlv-fromhere"><input type="checkbox" checked={fromHere} onChange={(e) => setFromHere(e.target.checked)} />From this bar on</label>
              {p.sung?.sig && <p className="small fr-note" role="note">Vocals: recorded in {p.sung.sig}</p>}
            </div>
          )}
        </span>

        <span className="tlv-undo" role="group" aria-label="Undo and redo">
          <button className="tlv-round flat" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.undo}>↶</button>
          <button className="tlv-round flat" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!p.canRedo} onClick={p.redo}>↷</button>
        </span>

        <span className="tlv-idea">
          <span className={`tlv-idea-name${idea.name ? "" : " none"}`} title={idea.name ?? "This idea is not saved yet"}>{idea.name ?? "New idea"}</span>
          <button className={`btn sm save-btn${idea.dirty ? " primary" : ""}`} onClick={idea.save} disabled={!idea.dirty} title={idea.name ? `Save "${idea.name}" (Ctrl+S)` : "Save this idea to your library (Ctrl+S)"}>{idea.dirty || !idea.name ? "Save" : "Saved ✓"}</button>
        </span>

        <span className="tlv-popwrap end">
          <button className={`btn sm tlv-popbtn${open === "export" ? " on" : ""}`} aria-expanded={open === "export"} onClick={() => toggle("export")}>Export</button>
          {open === "export" && (
            <div className="tlv-pop right" role="dialog" aria-label="Export" data-keys="own">
              <div className="tlv-out">
                <button className="btn" disabled={p.exports.busy} title="The whole song as you hear it, every track and the recordings, with the mixer's levels (24-bit WAV)" onClick={p.exports.wav}>{p.exports.busy ? "…" : "WAV"}</button>
                <button className="btn" title="Every track as notes, each on its own MIDI track" onClick={p.exports.midi}>MIDI</button>
                <button className="btn" title="Chord names and guitar tab, as text" onClick={p.exports.chart}><CopyIcon /> Chords + tab</button>
              </div>
            </div>
          )}
        </span>
        <button className="btn sm" onClick={p.openCanvas} title="The Canvas: the song as a painting">Canvas</button>
        <button className="btn sm ideas-btn" onClick={p.openIdeas} title="Your saved ideas" aria-haspopup="dialog">Ideas{idea.count ? <span className="count">{idea.count}</span> : null}</button>
        <button className="icon-btn" onClick={p.openSettings} aria-label="Settings" title="Tuning, capo, display and audio">⚙</button>
      </div>
    </header>
  );
}

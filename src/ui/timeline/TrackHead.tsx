// One track's panel, at the left of its lane. Two lines: what the track is (its colour and grip, its kind, its name,
// its level, the ⋯ menu), and what can be done with it (compose, sound, mute, solo, volume; ⟳ on a harmony track;
// arm and input on a track that records).
//
// On a phone (`narrow`) the panel holds four things a finger can hit: the name, compose, M and S. A tap on the name
// opens the track's menu, where everything else of the wide panel is (sound, volume, arm, input, rename, move, ⟳).
import { memo, useEffect, useRef } from "react";
import { SOUND_DEFAULT } from "../../audio/rack";
import { MAX_DB, MIN_DB, type TrackMix } from "../../audio/mix";
import type { InputRef, Track } from "../../timeline/model";
import { ClefIcon, GripIcon, KindIcon } from "../icons";
import { letterClass } from "../letters";
import type { MenuAt } from "./Menu";

/** What a panel tells the view. The same object for every panel, always. */
export interface HeadCtl {
  select(id: string): void;
  /** the grip pressed: a drag reorders the tracks */
  grab(e: React.PointerEvent<HTMLElement>, id: string): void;
  startRename(id: string): void;
  /** the name typed (null: left as it was) */
  rename(id: string, name: string | null): void;
  compose(id: string): void;
  sound(id: string, e: React.MouseEvent): void;
  mix(id: string, patch: Partial<TrackMix>): void;
  arm(id: string): void;
  menu(at: MenuAt, id: string): void;
  inputMenu(at: MenuAt, id: string): void;
  again(id: string): void;
}

/** The colour a track has when none was chosen: by its kind. */
export const KIND_COLOR: Record<Track["kind"], number> = { chords: 1, melody: 0, bass: 2, drums: 6, vocals: 4, audio: 5 };
export const colorOf = (t: Track): number => t.color ?? KIND_COLOR[t.kind];

/** A track's level as it is written: "+1.5", "0.0", "−∞". */
export const dbText = (db: number): string => (db <= MIN_DB ? "−∞" : `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)}`);

/** Which input a track records, as its chip says it: "1", "2", "1+2". */
export const inputText = (input: InputRef | undefined): string => {
  const ch = Math.max(0, Math.round(input?.ch ?? 0));
  return input?.pair ? `${ch + 1}+${ch + 2}` : `${ch + 1}`;
};

/** Is any effect of a track's sound on? (Its FX button is lit then.) */
export function fxOn(t: Track): boolean {
  if ("fx" in t) return !!t.fx.on;
  if ("kit" in t) return (t.kit.space ?? 0) > 0 || (t.kit.grit ?? 0) > 0;
  const s = { ...SOUND_DEFAULT, ...t.sound };
  return s.drive > 0 || s.chorus > 0 || s.phaser > 0 || s.trem > 0 || s.wobble > 0 || s.echo > 0 || s.space > 0 || s.shimmer > 0;
}

export const TrackHead = memo(function TrackHead({ track, mix, quiet, selected, armed, fresh, renaming, canAgain, bypassed, level, row, rows, narrow, ctl }: {
  track: Track;
  mix: TrackMix | undefined;
  /** not heard: muted, or another track is soloed */
  quiet: boolean;
  selected: boolean;
  armed: boolean;
  /** just added: its compose button pulses once */
  fresh: boolean;
  renaming: boolean;
  /** a harmony track with a clip to write again */
  canAgain: boolean;
  /** heard without its effects just now (its FX button says so) */
  bypassed?: boolean;
  /** how loud its input is right now, 0 to 1 (while the interface is open) */
  level?: (ch: number) => number;
  /** its place in the list, for what is said aloud */
  row: number; rows: number;
  /** the phone's panel: name, compose, M and S, each large enough for a finger */
  narrow?: boolean;
  ctl: HeadCtl;
}) {
  const db = mix?.db ?? 0;
  const records = track.kind === "vocals" || track.kind === "audio";
  const id = track.id;
  const meter = useRef<HTMLSpanElement>(null);
  const ch = records ? Math.max(0, Math.round(track.input?.ch ?? 0)) : 0;
  const pair = records && !!track.input?.pair;
  // the small input meter (two for a pair: left and right), moved every frame without drawing the panel again
  useEffect(() => {
    const el = meter.current;
    if (!records || !level || !el) return;
    let raf = 0;
    const tick = () => {
      el.querySelectorAll<HTMLElement>("b").forEach((b, i) => {
        b.style.transform = `scaleY(${Math.max(0, Math.min(1, level(ch + i))).toFixed(3)})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [records, level, ch, pair]);
  const at = (e: React.MouseEvent): MenuAt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  };
  const rename = (
    <input className="tlh-rename" autoFocus defaultValue={track.name} maxLength={32} aria-label={`Name of ${track.name}`} enterKeyHint="done"
      onFocus={(e) => e.currentTarget.select()} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") ctl.rename(id, e.currentTarget.value);
        else if (e.key === "Escape") ctl.rename(id, null);
      }}
      onBlur={(e) => ctl.rename(id, e.currentTarget.value)} />
  );
  if (narrow)
    return (
      <div className={`tlh narrow k-${track.kind} ${letterClass(colorOf(track))}${selected ? " on" : ""}${quiet ? " quiet" : ""}${fresh ? " fresh" : ""}`} data-track={id} role="group" aria-label={`${track.name} track`}
        onPointerDown={(e) => { if (e.button === 0 && !(e.target as Element).closest("input")) ctl.select(id); }}
        onContextMenu={(e) => e.preventDefault()}>
        <i className="tlh-grip" aria-hidden="true" />
        <div className="tlh-line">
          {renaming ? rename : (
            <button className="tlh-namebtn" aria-label={`${track.name}: sound, volume and more`} aria-haspopup="menu" onClick={(e) => ctl.menu(at(e), id)}>
              <span className="tlh-kind"><KindIcon kind={track.kind} /></span>
              <span className="tlh-name">{track.name}</span>
              {armed && <i className="tlh-armed" aria-label="(armed: this track records)" />}
              <span className="tlh-dots" aria-hidden="true">⋯</span>
            </button>
          )}
        </div>
        <div className="tlh-line two">
          <button className="tlh-btn tlh-compose" aria-label="Compose" onClick={() => ctl.compose(id)}><ClefIcon /></button>
          <button className={`tlh-ms${mix?.mute ? " on" : ""}`} aria-pressed={!!mix?.mute} aria-label={`Mute ${track.name}`} onClick={() => ctl.mix(id, { mute: !mix?.mute })}>M</button>
          <button className={`tlh-ms solo${mix?.solo ? " on" : ""}`} aria-pressed={!!mix?.solo} aria-label={`Solo ${track.name}`} onClick={() => ctl.mix(id, { solo: !mix?.solo })}>S</button>
        </div>
      </div>
    );
  return (
    <div className={`tlh k-${track.kind} ${letterClass(colorOf(track))}${selected ? " on" : ""}${quiet ? " quiet" : ""}${fresh ? " fresh" : ""}`} data-track={id} role="group" aria-label={`${track.name} track`}
      onPointerDown={(e) => { if (e.button === 0 && !(e.target as Element).closest("input")) ctl.select(id); }}
      onContextMenu={(e) => { e.preventDefault(); ctl.select(id); ctl.menu({ x: e.clientX, y: e.clientY }, id); }}>
      <button className="tlh-grip" aria-label={`Move ${track.name}: ${row + 1} of ${rows}`} title="Drag to move this track" onPointerDown={(e) => ctl.grab(e, id)}><GripIcon /></button>
      <div className="tlh-line">
        <span className="tlh-kind"><KindIcon kind={track.kind} /></span>
        {renaming ? rename : (
          <span className="tlh-name" title={`${track.name}: double-click to rename (F2)`} onDoubleClick={() => ctl.startRename(id)}>{track.name}</span>
        )}
        <span className="tlh-db mono" title="Volume, in dB">{dbText(db)}</span>
        <button className="tlh-more" aria-label={`More for ${track.name}`} aria-haspopup="menu" title="Remove, duplicate, sound, colour" onClick={(e) => ctl.menu(at(e), id)}>⋯</button>
      </div>
      <div className="tlh-line two">
        <button className="tlh-btn tlh-compose" aria-label="Compose" title={`Compose: open ${track.name} to write in`} onClick={() => ctl.compose(id)}><ClefIcon /></button>
        <button className={`tlh-btn tlh-fx${fxOn(track) ? " lit" : ""}${bypassed ? " off" : ""}`} aria-label={`Sound and effects of ${track.name}${bypassed ? " (bypassed: heard without its effects)" : ""}`}
          title={bypassed ? "Bypassed: heard without its effects. Alt + click to hear them again" : "Sound and effects (Alt + click: hear the track without its effects)"} onClick={(e) => ctl.sound(id, e)}>FX</button>
        <button className={`tlh-ms${mix?.mute ? " on" : ""}`} aria-pressed={!!mix?.mute} aria-label={`Mute ${track.name}`} title="Mute" onClick={() => ctl.mix(id, { mute: !mix?.mute })}>M</button>
        <button className={`tlh-ms solo${mix?.solo ? " on" : ""}`} aria-pressed={!!mix?.solo} aria-label={`Solo ${track.name}`} title="Solo: hear only the soloed tracks" onClick={() => ctl.mix(id, { solo: !mix?.solo })}>S</button>
        <input type="range" className="tlh-vol" min={MIN_DB} max={MAX_DB} step={0.5} value={db} aria-label={`${track.name} volume`} title="Volume (double-click: back to 0)"
          onChange={(e) => ctl.mix(id, { db: Number(e.target.value) })} onDoubleClick={() => ctl.mix(id, { db: 0 })} />
        {canAgain && <button className="tlh-btn tlh-again" aria-label={`Write the harmony of ${track.name} again`} title="Write this harmony again" onClick={() => ctl.again(id)}>⟳</button>}
        {records && (
          <>
            <button className={`tlh-arm${armed ? " on" : ""}`} aria-pressed={armed} aria-label={`Arm ${track.name} for recording`} title={armed ? "Armed: this track records" : "Arm: make this the track that records"} onClick={() => ctl.arm(id)}>●</button>
            <button className="tlh-in mono" aria-label={`Input of ${track.name}: ${inputText(track.input)}`} aria-haspopup="menu" title={pair ? "Which inputs it records: these two, in stereo" : "Which input it records"} onClick={(e) => ctl.inputMenu(at(e), id)}>
              {inputText(track.input)}
              {level && <span className="tlh-meters" ref={meter} aria-hidden="true"><i className="tlh-meter"><b /></i>{pair && <i className="tlh-meter"><b /></i>}</span>}
            </button>
          </>
        )}
      </div>
    </div>
  );
});

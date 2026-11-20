import { useState } from "react";
import { ECHO_TIMES } from "../../audio/beats";
import { HARP_VOICES, STRING_DEFAULT, VOICE_GROUPS } from "../../audio/harp";
import { FEEL_DEFAULT, STYLES, STYLE_GROUPS, getStyle, type Feel, type PatternId, type StyleGroup } from "../../audio/patterns";
import { DRIVES, FX_DEFAULT, HARP_VERBS, TREM_SPEEDS, type HarpSound } from "../../audio/rack";
import { SOUNDS, sameSound, soundName, soundOfPreset } from "../../audio/sounds";
import { INSTRUMENTS, KEYS_MODELS, synthOf, type InstId, type Tone } from "../../audio/tone";
import type { SynthParams } from "../../synth/params";
import { newId, useApp } from "../state";
import { Seg } from "./common";
import { Choice, Knob, Picker, toneText } from "./controls";
import { SynthPanel } from "./SynthPanel";

/** The instruments' small pictures, for the switch and the Track page. */
export function InstIcon({ inst }: { inst: InstId }) {
  const d =
    inst === "piano" ? "M2 3h12v10H2zM5.5 3v6M8 3v6M10.5 3v6M5.5 9v4M8 9v4M10.5 9v4"
    : inst === "synth" ? "M1.5 8h2l1.5-4 2 8 2-8 2 8 1.5-4h2"
    : "M11.5 2.5l2 2M12.5 3.5l-5 5M7.5 8.5a2.6 2.6 0 1 0-3.6 3.6 2.6 2.6 0 0 0 3.6-3.6zM5.6 10.4l.01 0";
  return (
    <svg className="inst-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** What a track's instrument is set to, and how to change it (only chords and melody tracks have one). */
export interface ToneProps {
  tone: Tone;
  setTone: (patch: Partial<Tone>) => void;
  /** the track is chords or a melody (a new synth starts on a pad or a lead) */
  kind: "chords" | "melody";
  /** its piano or synth is still loading */
  loading?: boolean;
  /** the section is in 6/8, 9/8 or 12/8 (a synth's arp is fitted to it) */
  compound?: boolean;
}

/** Guitar, Piano or Synth for one track. */
function InstSwitch({ tone, setTone, loading }: ToneProps) {
  return (
    <div className="seg inst-switch" role="radiogroup" aria-label="Instrument">
      {INSTRUMENTS.map((x) => (
        <button key={x.id} role="radio" aria-checked={tone.inst === x.id} className={tone.inst === x.id ? "on" : ""} title={x.name} onClick={() => tone.inst !== x.id && setTone({ inst: x.id })}>
          <InstIcon inst={x.id} />
          <span>{x.name}</span>
          {loading && tone.inst === x.id && <i className="inst-loading" aria-label="Loading" />}
        </button>
      ))}
    </div>
  );
}

/**
 * One track's sound in the section on screen: which instrument, a ready-made sound, and (when
 * asked for) the knobs for the strings and the effects. Used for every chords and melody track:
 * each has its own in every section. "All sections" copies it to the same track in every other
 * section that has it.
 */
export function SoundControls({ sound, setSound, onHear, children, inst: instProps, onAll }: {
  sound: HarpSound;
  setSound: (patch: Partial<HarpSound>) => void;
  /** play something once, to hear a change (when nothing is playing) */
  onHear: () => void;
  /** more pickers for the same row */
  children?: (drawer: string | null, toggle: (d: string) => void) => { pickers: React.ReactNode; drawers: React.ReactNode };
  /** the track's instrument (the strings when not given) */
  inst?: ToneProps;
  /** copy this sound to the same track in every other section (only when another section has it) */
  onAll?: () => void;
}) {
  const { state, set, toast } = useApp();
  const mine = state.mySounds;
  const [drawer, setDrawer] = useState<string | null>(null);
  const [panel, setPanel] = useState<"strings" | "fx" | null>(null);
  const inst = instProps?.tone.inst ?? "guitar";
  const tone = instProps?.tone;
  const strings = inst === "guitar";
  const toggle = (d: string) => setDrawer(drawer === d ? null : d);
  const extra = children?.(drawer, toggle);

  const voiceAt = HARP_VOICES.findIndex((v) => v.id === sound.voice);
  const pickVoice = (i: number) => {
    setSound({ voice: HARP_VOICES[(i + HARP_VOICES.length) % HARP_VOICES.length].id });
    onHear();
  };
  const sounds = [...SOUNDS.map((p) => ({ id: p.id, name: p.name, hint: p.hint, sound: soundOfPreset(p, sound.voice), own: false })), ...mine.map((u) => ({ id: u.id, name: u.name, hint: "Saved by you", sound: u.sound, own: true }))];
  const at = sounds.findIndex((x) => sameSound(x.sound, sound, !x.own));
  const pickSound = (x: (typeof sounds)[number]) => {
    setSound({ ...x.sound, level: sound.level });
    onHear();
  };
  const saveSound = () => {
    let n = mine.length + 1;
    while (mine.some((u) => u.name === `My sound ${n}`)) n++;
    set((s) => ({ ...s, mySounds: [...s.mySounds, { id: `sound-${newId()}`, name: `My sound ${n}`, sound }] }));
    toast(`Saved as My sound ${n}`);
  };
  /** change a knob and hear the result */
  const turn = (patch: Partial<HarpSound>, hear = false) => {
    setSound(patch);
    if (hear) onHear();
  };
  const d = { ...STRING_DEFAULT, ...FX_DEFAULT };

  return (
    <>
      <div className="dm-head sound-row">
        {instProps && <InstSwitch {...instProps} />}
        {extra?.pickers}
        {strings && <Picker label="Harp" name={HARP_VOICES[voiceAt]?.name ?? ""} open={drawer === "harp"} onOpen={() => toggle("harp")} onStep={(dir) => pickVoice(voiceAt + dir)} />}
        {strings && (
          <span className="pick-wrap">
            <Picker label="Sound" name={soundName(sound, mine) ?? "Custom"} open={drawer === "sound"} onOpen={() => toggle("sound")}
              onStep={(dir) => pickSound(sounds[(Math.max(at, 0) + dir + sounds.length) % sounds.length])} />
          </span>
        )}
        {inst === "piano" && tone && (
          <Seg value={tone.keys ?? "grand"} options={KEYS_MODELS.map((k) => ({ value: k.id, label: k.name }))} onChange={(v) => instProps!.setTone({ keys: v })} label="Which piano" />
        )}
      </div>
      {extra?.drawers}
      {inst === "synth" && instProps && (
        <SynthPanel compact compound={instProps.compound} params={synthOf(instProps.tone, instProps.kind)} onChange={(p: SynthParams) => instProps.setTone({ synth: p })} onAudition={onHear} />
      )}
      {strings && drawer === "harp" && (
        <div className="dm-drawer" role="radiogroup" aria-label="Instrument">
          {VOICE_GROUPS.map((g) => (
            <div key={g} className="voice-group">
              <span className="kb-label">{g}</span>
              <div className="dm-tiles">
                {HARP_VOICES.map((v, i) => v.group === g && (
                  <span key={v.id} className={`dm-tile${sound.voice === v.id ? " on" : ""}`}>
                    <button role="radio" aria-checked={sound.voice === v.id} title={v.hint} onClick={() => pickVoice(i)}><b>{v.name}</b></button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {strings && drawer === "sound" && (
        <div className="dm-drawer" role="radiogroup" aria-label="Sound">
          <div className="dm-tiles">
            {sounds.filter((x) => !x.own).map((x) => (
              <span key={x.id} className={`dm-tile${sounds[at]?.id === x.id ? " on" : ""}`}>
                <button role="radio" aria-checked={sounds[at]?.id === x.id} title={x.hint} onClick={() => pickSound(x)}><b>{x.name}</b></button>
              </span>
            ))}
          </div>
          <span className="kb-label">Mine</span>
          <div className="dm-tiles">
            {sounds.filter((x) => x.own).map((x) => (
              <span key={x.id} className={`dm-tile${sounds[at]?.id === x.id ? " on" : ""}`}>
                <button role="radio" aria-checked={sounds[at]?.id === x.id} title={x.hint} onClick={() => pickSound(x)}><b>{x.name}</b></button>
                <button className="dm-x" aria-label={`Delete ${x.name}`} onClick={() => set((s) => ({ ...s, mySounds: s.mySounds.filter((u) => u.id !== x.id) }))}>✕</button>
              </span>
            ))}
            <button className="dm-tile add" title="Keep this instrument, its strings and effects for other songs" onClick={saveSound}>+ Save this sound</button>
          </div>
        </div>
      )}

      <div className="dm-tabs">
        {inst !== "synth" && <button className={`chip${panel === "strings" ? " on" : ""}`} aria-expanded={panel === "strings"} onClick={() => setPanel(panel === "strings" ? null : "strings")}>{strings ? "Strings" : "Keys"}</button>}
        <button className={`chip${panel === "fx" ? " on" : ""}`} aria-expanded={panel === "fx"} onClick={() => setPanel(panel === "fx" ? null : "fx")}>Effects</button>
        {onAll && <button className="chip all-chip" title="This track sounds like this in every section that has it" onClick={onAll}>All sections</button>}
      </div>

      {panel === "strings" && inst === "piano" && tone && (
        <div className="dm-panel dm-mix" role="group" aria-label="Keys">
          <div className="knobs">
            <Knob label="Bright" title="Duller or brighter than the piano was recorded" value={tone.bright ?? 0.5} def={0.5} onChange={(v) => { instProps!.setTone({ bright: v }); onHear(); }} />
            <Knob label="Volume" value={sound.level} def={d.level} onChange={(v) => turn({ level: v })} />
            <div className="knob wide">
              <span><i>Pedal</i></span>
              <button className={`chip${tone.pedal ? " on" : ""}`} aria-pressed={!!tone.pedal} title="The sustain pedal, changed with every chord" onClick={() => { instProps!.setTone({ pedal: !tone.pedal }); onHear(); }}>{tone.pedal ? "On" : "Off"}</button>
            </div>
          </div>
        </div>
      )}

      {panel === "strings" && strings && (
        <div className="dm-panel dm-mix" role="group" aria-label="Strings">
          <div className="knobs">
            <Knob label="Pluck" title="Where the finger plucks. Left: the middle of the string, round and hollow. Right: by the soundboard, thin and bright." value={sound.pluck} def={d.pluck} onChange={(v) => turn({ pluck: v }, true)} />
            <Knob label="Soft" title="Left: nail or pick, sharp. Right: the pad of the finger, mellow." value={sound.soft} def={d.soft} onChange={(v) => turn({ soft: v }, true)} />
            <Knob label="Ring" title="How long the strings ring, and how far one chord runs into the next" value={sound.ring} def={d.ring} onChange={(v) => turn({ ring: v }, true)} />
            <Knob label="Body" title="The soundboard: warmth, and the knock at the start of each note" value={sound.body} def={d.body} onChange={(v) => turn({ body: v }, true)} />
          </div>
          <div className="knobs">
            <Knob label="Octave" title="Doubles every string an octave up, like a twelve-string" value={sound.octave} def={0} onChange={(v) => turn({ octave: v }, true)} />
            <Knob label="Wide" title="How far the strings are spread between the speakers" value={sound.wide} def={d.wide} onChange={(v) => turn({ wide: v })} />
            <Knob label="Volume" value={sound.level} def={d.level} onChange={(v) => turn({ level: v })} />
          </div>
        </div>
      )}

      {panel === "fx" && (
        <div className="dm-panel dm-mix" role="group" aria-label="Effects">
          <div className="knobs">
            <Knob label="Saturation" title="The colour of analogue gear pushed hard: a little is warmth, a lot is distortion" value={sound.drive} def={0} onChange={(v) => turn({ drive: v })} />
            <Choice label="Colour" value={sound.driveType} options={DRIVES} onChange={(v) => turn({ driveType: v, drive: sound.drive || 0.5 }, true)} />
            {sound.drive > 0 && <Knob label="Blend" title="How much of the sound goes through the saturation. Half keeps the clean pluck underneath." value={sound.driveMix} def={1} onChange={(v) => turn({ driveMix: v })} />}
            <Knob label="Squeeze" title="A compressor: evens out loud and quiet notes and lengthens the ring" value={sound.squeeze} def={d.squeeze} onChange={(v) => turn({ squeeze: v })} />
            <Knob label="Tone" min={-1} max={1} value={sound.tone} def={0} fmt={toneText} onChange={(v) => turn({ tone: v })} />
          </div>
          <div className="knobs">
            <Knob label="Chorus" title="Two drifting copies, one in each speaker: wide and lush" value={sound.chorus} def={0} onChange={(v) => turn({ chorus: v })} />
            <Knob label="Phaser" title="A slow sweep moving through the sound" value={sound.phaser} def={0} onChange={(v) => turn({ phaser: v })} />
            <Knob label="Wobble" title="The pitch drifts, like a worn tape" value={sound.wobble} def={0} onChange={(v) => turn({ wobble: v })} />
            <Knob label="Tremolo" title="The volume pulses in time with the song" value={sound.trem} def={0} onChange={(v) => turn({ trem: v })} />
            {sound.trem > 0 && <Choice label="Tremolo speed" value={sound.tremSpeed} options={TREM_SPEEDS} onChange={(v) => turn({ tremSpeed: v })} />}
          </div>
          <div className="knobs">
            <Knob label="Echo" title="Repeats that bounce from side to side" value={sound.echo} def={0} onChange={(v) => turn({ echo: v })} />
            {sound.echo > 0 && (
              <div className="knob wide">
                <span><i>Echo time</i></span>
                <Seg value={sound.echoTime} options={ECHO_TIMES.map((e) => ({ value: e.id, label: e.label }))} onChange={(v) => turn({ echoTime: v })} label="Echo time" />
              </div>
            )}
            <Knob label="Reverb" value={sound.space} def={d.space} onChange={(v) => turn({ space: v })} />
            <Choice label="Reverb type" value={sound.verb} options={HARP_VERBS} onChange={(v) => { turn({ verb: v }); window.setTimeout(onHear, 200); }} />
            <Knob label="Size" title="Small and short … big and long" value={sound.size} def={d.size} onChange={(v) => turn({ size: v })} />
            {strings && <Knob label="Shimmer" title="A halo an octave above, heard in the reverb" value={sound.shimmer} def={0} onChange={(v) => turn({ shimmer: v })} />}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * How the chords are played (the style and its feel) and what plays them (the harp and its effects):
 * the chords track's own in the section on screen. Small at first: the style, the instrument and
 * the sound. The knobs open when asked for.
 */
export function HarpPanel({ sound, setSound, style, onStyle, feel, setFeel, onHear, inst, onAll }: {
  sound: HarpSound;
  setSound: (patch: Partial<HarpSound>) => void;
  style: PatternId;
  onStyle: (id: PatternId) => void;
  /** how the style is played */
  feel: Feel;
  setFeel: (patch: Partial<Feel>) => void;
  /** play the chord on screen once, to hear a change (when nothing is playing) */
  onHear: () => void;
  /** the track's instrument */
  inst?: ToneProps;
  /** copy how it is played and how it sounds to the same track in every other section */
  onAll?: () => void;
}) {
  const st = getStyle(style);
  // on the synth its own way of playing takes the place of the playing style
  const styled = inst?.tone.inst !== "synth";
  const [group, setGroup] = useState<StyleGroup>(st.group);
  const stepStyle = (dir: -1 | 1) => {
    const pool = STYLES.filter((x) => x.group === st.group);
    const next = pool[(pool.findIndex((x) => x.id === st.id) + dir + pool.length) % pool.length];
    setGroup(next.group);
    onStyle(next.id);
  };

  return (
    <section className="card harp" aria-label="How the chords are played">
      <SoundControls sound={sound} setSound={setSound} onHear={onHear} inst={inst} onAll={onAll}>
        {(drawer, toggle) => ({
          pickers: styled && (
            <span className="pick-wrap">
              <Picker label="Style" name={st.name} open={drawer === "style"} onOpen={() => { setGroup(st.group); toggle("style"); }} onStep={stepStyle} />
            </span>
          ),
          drawers: styled && drawer === "style" && (
            <div className="dm-drawer">
              <div className="dm-chips" role="radiogroup" aria-label="Kind of style">
                {STYLE_GROUPS.map((g) => <button key={g.id} role="radio" aria-checked={group === g.id} className={`chip${group === g.id ? " on" : ""}`} onClick={() => setGroup(g.id)}>{g.name}</button>)}
              </div>
              <div className="dm-chips" role="listbox" aria-label="Styles">
                {STYLES.filter((x) => x.group === group).map((x) => (
                  <span key={x.id} className={`beat-item${style === x.id ? " on" : ""}`}>
                    <button role="option" aria-selected={style === x.id} title={x.hint} onClick={() => onStyle(x.id)}>{x.name}</button>
                  </span>
                ))}
              </div>
              <div className="knobs feel" role="group" aria-label="Feel">
                <div className="knob wide">
                  <span><i>Speed</i></span>
                  <Seg value={feel.speed} options={[{ value: 0.5, label: "½×" }, { value: 1, label: "1×" }, { value: 2, label: "2×" }]} onChange={(v) => setFeel({ speed: v })} label="Speed of the pattern" />
                </div>
                <Knob label="Swing" title="How far the off-beats lean back" value={feel.swing} def={FEEL_DEFAULT.swing} onChange={(v) => setFeel({ swing: v })} />
                <Knob label="Touch" title="Left: a whisper. Right: dug in hard." value={feel.touch} def={FEEL_DEFAULT.touch} onChange={(v) => setFeel({ touch: v })} />
                <Knob label="Spread" title="How spread out strums and rolls are" value={feel.spread} def={FEEL_DEFAULT.spread} onChange={(v) => setFeel({ spread: v })} />
                <div className="knob wide">
                  <span><i>Octave</i></span>
                  <Seg value={feel.octave} options={[{ value: -1, label: "Low" }, { value: 0, label: "Mid" }, { value: 1, label: "High" }]} onChange={(v) => setFeel({ octave: v })} label="Octave" />
                </div>
              </div>
            </div>
          ),
        })}
      </SoundControls>
    </section>
  );
}

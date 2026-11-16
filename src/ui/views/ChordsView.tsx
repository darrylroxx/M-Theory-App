import { useMemo, useState } from "react";
import { strum } from "../../audio/synth";
import { CHORD_TYPES, chordSymbol, chordToneMap, displaySuffix, getChordType, identifyChord, type ChordRef } from "../../theory/chords";
import { spellInKey } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { ChordInfo } from "../components/ChordInfo";
import { toneColor, tokenLabel } from "../components/ChordDiagram";
import { Fretboard, type FretDot } from "../components/Fretboard";
import { Disclosure, Seg, ToneLegend } from "../components/common";
import { VoicingBrowser } from "../components/VoicingBrowser";
import { useApp } from "../state";

/** Chord families in everyday words. */
const FAMILIES: { id: string; label: string; hint: string; ids: string[] }[] = [
  { id: "basic", label: "Basic", hint: "Major, minor and friends", ids: ["maj", "min", "5", "dim", "aug"] },
  { id: "sevenths", label: "7ths", hint: "Add a 4th note for richness or tension", ids: ["maj7", "7", "m7", "m7b5", "dim7", "mMaj7", "maj7#5"] },
  { id: "susadd", label: "Sus & add", hint: "Open, airy, modern colours", ids: ["sus2", "sus4", "add9", "madd9", "6", "m6", "69", "m69", "add11", "madd11", "add#11", "7sus4", "7sus2", "9sus4"] },
  { id: "jazzy", label: "Lush (9, 11, 13)", hint: "Neo-soul, jazz and dream-pop sounds", ids: ["maj9", "9", "m9", "mMaj9", "11", "m11", "maj7#11", "maj13", "13", "m13"] },
  { id: "spicy", label: "Spicy", hint: "Bluesy and tense versions of the 7 chord", ids: ["7#9", "7b9", "7#5", "7b5", "7#11", "7b13", "7alt", "majb5"] },
];
// any chord type not placed above still gets a home, so nothing in the library is unreachable
{
  const covered = new Set(FAMILIES.flatMap((f) => f.ids));
  FAMILIES[FAMILIES.length - 1].ids.push(...CHORD_TYPES.filter((t) => !covered.has(t.id)).map((t) => t.id));
}

export function ChordsView() {
  const [mode, setMode] = useState<"find" | "name">("find");
  return (
    <div className="stack">
      <Seg value={mode} options={[{ value: "find", label: "🔎 Look up a chord" }, { value: "name", label: "✋ What chord is this?" }]} onChange={setMode} label="Chords mode" />
      {mode === "find" ? <Finder /> : <NameThatShape />}
    </div>
  );
}

function Finder() {
  const { state, set, tuning, addChord } = useApp();
  const chord = state.explore;
  const type = getChordType(chord.typeId);
  const [family, setFamily] = useState(FAMILIES.find((f) => f.ids.includes(chord.typeId))?.id ?? "basic");
  const fam = FAMILIES.find((f) => f.id === family)!;
  const setChord = (patch: Partial<ChordRef>) => set((s) => ({ ...s, explore: { ...s.explore, ...patch } }));
  const roots = Array.from({ length: 12 }, (_, i) => spellInKey(pc(state.key.tonic) + i, state.key));

  return (
    <>
      <section className="card stack" style={{ gap: 14 }}>
        <div>
          <h3 className="step"><span>1</span> Root note</h3>
          <div className="row tight">
            {roots.map((r) => (
              <button key={r} className={`chip${pc(r) === pc(chord.root) ? " on" : ""}`} onClick={() => setChord({ root: r, bass: undefined })}>{displayNote(r)}</button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="step"><span>2</span> Kind of chord</h3>
          <Seg value={family} options={FAMILIES.map((f) => ({ value: f.id, label: f.label }))} onChange={setFamily} label="Chord family" />
          <p className="small muted" style={{ margin: "6px 0 8px" }}>{fam.hint}</p>
          <div className="row tight">
            {fam.ids.map((id) => {
              const t = getChordType(id);
              return (
                <button key={id} className={`chip${id === chord.typeId ? " on" : ""}`} title={t.feel} onClick={() => setChord({ typeId: id })}>
                  {displayNote(chord.root)}{displaySuffix(t.symbol)} <span className="rn">{t.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Disclosure title="Different bass note (slash chord)" hint={chord.bass ? `Bass: ${displayNote(chord.bass)}` : "e.g. C/G"}>
          <div className="row tight">
            <button className={`chip${!chord.bass ? " on" : ""}`} onClick={() => setChord({ bass: undefined })}>Root ({displayNote(chord.root)})</button>
            {roots.filter((r) => pc(r) !== pc(chord.root)).map((r) => (
              <button key={r} className={`chip${chord.bass && pc(chord.bass) === pc(r) ? " on" : ""}`} onClick={() => setChord({ bass: r })}>/{displayNote(r)}</button>
            ))}
          </div>
        </Disclosure>
      </section>

      <section className="card stack">
        <div>
          <h2 style={{ fontSize: "1.9rem" }}>{chordSymbol(chord)}</h2>
          <p className="muted small">{type.name}</p>
        </div>
        <ChordInfo chord={chord} onOpen={(r) => set((s) => ({ ...s, explore: r }))} />
      </section>

      <section className="card stack">
        <h2>Ways to play {chordSymbol(chord)}</h2>
        <VoicingBrowser chord={chord} onUse={(v) => addChord(chord, { voicingId: v.id })} />
        <Disclosure title="See every note of this chord on the fretboard" hint="Learn to build your own shapes">
          <ChordOnNeck chord={chord} tuning={tuning} />
        </Disclosure>
      </section>
    </>
  );
}

function ChordOnNeck({ chord, tuning }: { chord: ChordRef; tuning: ReturnType<typeof useApp>["tuning"] }) {
  const { state } = useApp();
  const type = getChordType(chord.typeId);
  const dots = useMemo<FretDot[]>(() => {
    const tones = chordToneMap(pc(chord.root), type);
    const out: FretDot[] = [];
    tuning.notes.forEach((open, s) => {
      for (let f = 0; f <= 15; f++) {
        const tok = tones.get(mod12(open + state.settings.capo + f));
        if (tok) out.push({ string: s, fret: f, label: state.settings.labels === "notes" ? displayNote(spellInKey(open + state.settings.capo + f, state.key)) : tokenLabel(tok), color: toneColor(tok), weight: tok === "1" ? 2 : 1 });
      }
    });
    return out;
  }, [chord.root, type, tuning, state.settings.capo, state.settings.labels, state.key]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small muted">Every {chordSymbol(chord)} note on the neck. Grab any 3 or 4 of them that sit close together (include the root, 3rd and 7th if it has one) and you've made your own shape.</p>
      <Fretboard tuning={tuning} capo={state.settings.capo} dots={dots} leftHanded={state.settings.leftHanded} />
      <ToneLegend />
    </div>
  );
}

function NameThatShape() {
  const { state, tuning, openSheet, addChord } = useApp();
  const n = tuning.notes.length;
  const [frets, setFrets] = useState<(number | null)[]>(() => [null, 3, 2, 0, 1, 0]);
  const capo = state.settings.capo;
  const midi = frets.map((f, s) => (f === null ? null : tuning.notes[s] + capo + f));
  const sounding = midi.filter((m): m is number => m !== null);
  const soundingKey = sounding.join(",");
  const matches = useMemo(() => {
    if (sounding.length < 2) return [];
    return identifyChord(sounding.map(mod12), mod12(sounding[0]), (p) => spellInKey(p, state.key)).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundingKey, state.key]);

  const best = matches[0];
  const tones = best ? chordToneMap(pc(best.ref.root), best.type) : null;
  const dots: FretDot[] = frets.flatMap((f, s) => {
    if (f === null) return [];
    const p = mod12(tuning.notes[s] + capo + f);
    const tok = tones?.get(p);
    return [{ string: s, fret: f, label: tok ? tokenLabel(tok) : displayNote(spellInKey(p, state.key)), color: tok ? toneColor(tok) : "var(--other)", weight: 2 as const }];
  });
  const tap = (s: number, f: number) => setFrets((cur) => cur.map((x, i) => (i === s ? (x === f ? null : f) : x)));

  return (
    <section className="card stack">
      <div>
        <h2>What chord is this?</h2>
        <p className="small muted">Tap the fretboard where your fingers are: one note per string. Tap the same spot again to mute that string; the column left of the nut is an open string.</p>
      </div>
      <Fretboard tuning={tuning} capo={capo} dots={dots} onCell={tap} leftHanded={state.settings.leftHanded} />
      <div className="row">
        <span className="mono">{frets.map((f) => (f === null ? "x" : f)).join(" ")}</span>
        <button className="btn sm" onClick={() => strum(midi)} disabled={!sounding.length}>▶ Strum</button>
        <button className="btn sm ghost" onClick={() => setFrets(new Array(n).fill(null))}>Clear</button>
      </div>
      {sounding.length < 2 ? (
        <p className="muted">Place at least two notes.</p>
      ) : !best ? (
        <p className="muted">No standard name for these notes. That doesn't mean it's wrong: if it sounds good, use it.</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <h3>You're playing <span style={{ color: "var(--accent)", fontSize: "1.4rem" }}>{chordSymbol(best.ref)}</span></h3>
          <p className="small muted">{best.type.name}{best.omitted.length ? ` (without the ${best.omitted.map((o) => displaySuffix(o)).join(", ")})` : ""}. {best.type.feel}</p>
          {matches.length > 1 && (
            <div className="row tight">
              <span className="small muted">It can also be called:</span>
              {matches.slice(1).map((m, i) => (
                <button key={i} className="chip" onClick={() => openSheet({ ref: m.ref })}>{chordSymbol(m.ref)}</button>
              ))}
            </div>
          )}
          <div className="row tight">
            <button className="btn sm primary" onClick={() => addChord(best.ref, { voicingId: frets.map((f) => (f === null ? "x" : f)).join(",") })}>+ Add this shape to my song</button>
            <button className="btn sm" onClick={() => openSheet({ ref: best.ref })}>Other ways to play it</button>
          </div>
        </div>
      )}
    </section>
  );
}

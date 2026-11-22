// The four small drawings a clip shows on its lane: chord names to scale, melody notes, drum hits in three rows, and a
// recording's waveform. They are the old Track page's drawings (ChordBlock, MelodyBlock, DrumBlock, TakeBlock), given
// a clip's content and the rounds of it the clip plays instead of a section. Nothing here reads the app's state.
import { heardAt, type Groove } from "../../audio/beats";
import type { DrumId } from "../../audio/drums";
import { inFrame } from "../../song/frame";
import { TICKS } from "../../song/melody";
import { chordSymbol } from "../../theory/chords";
import { analyzeChord, type Key } from "../../theory/keys";
import { contentBeats, cycles, frameCycles, framesToBeats, type AudioClip, type ChordsClip, type DrumsClip, type MelodyClip, type Take5 } from "../../timeline/model";

/** How tall a drawing is (a clip is this tall inside its lane). */
export const DRAW_H = 44;

/** A chords clip: each chord as wide as it is long, with its name where there is room. A round of the content that starts again starts its chords again. */
export function ChordBlock({ clip, ppb, keyOf }: { clip: ChordsClip; ppb: number; keyOf: Key }) {
  const size = contentBeats(clip);
  const items = inFrame(clip.content.chords, size);
  if (!items.some((x) => !x.item.rest)) return <span className="tlc-empty">—</span>;
  /** where each chord starts in the content */
  const starts: number[] = [];
  let at = 0;
  for (const x of items) {
    starts.push(at);
    at += x.item.beats;
  }
  const out: React.ReactNode[] = [];
  cycles(clip).forEach((r, k) => {
    items.forEach(({ item: c }, i) => {
      const a = Math.max(r.from, starts[i]);
      const b = Math.min(r.to, starts[i] + c.beats);
      if (b <= a) return;
      const w = (b - a) * ppb;
      out.push(
        <span key={`${k}:${i}`} className={`tlc-chord${c.rest ? " rest" : ` st-${analyzeChord(c.ref, keyOf).status}`}`} style={{ left: (r.at + a - r.from) * ppb, width: w }}>
          {c.rest || w < 22 ? "" : chordSymbol(c.ref)}
        </span>,
      );
    });
  });
  return <span className="tlc-chords">{out}</span>;
}

/** A melody or bass clip: a small bar for each note. `lo` and `hi`: the lowest and highest note on its track, so every clip of the track is drawn on one scale. */
export function MelodyBlock({ clip, ppb, lo, hi }: { clip: MelodyClip; ppb: number; lo: number; hi: number }) {
  const m = clip.content;
  if (!m.notes.length) return <span className="tlc-empty">—</span>;
  const step = Math.max(2, ppb / Math.max(1, m.div) - 1);
  const y = (midi: number) => 4 + (1 - (midi - lo) / Math.max(1, hi - lo)) * (DRAW_H - 8);
  const out: React.ReactNode[] = [];
  cycles(clip).forEach((r, k) => {
    for (let i = 0; i < m.notes.length; i++) {
      const n = m.notes[i];
      const beat = n.at / TICKS;
      if (beat < r.from - 1e-9 || beat >= r.to - 1e-9) continue;
      out.push(<rect key={`${k}:${i}`} x={(r.at + beat - r.from) * ppb} y={y(n.midi) - 2} width={step} height={4} rx={1.5} />);
    }
  });
  return <svg className="tlc-svg" width={Math.max(1, clip.len * ppb)} height={DRAW_H} aria-hidden="true">{out}</svg>;
}

/** Drum rows drawn top to bottom: cymbals, then the middle of the kit, then the kick. */
const LANES: { ids: DrumId[]; y: number }[] = [
  { ids: ["hat", "open", "shaker", "bell"], y: 0.2 },
  { ids: ["snare", "clap", "rim", "tom"], y: 0.5 },
  { ids: ["kick"], y: 0.82 },
];

/** A drums clip: every hit of the rhythm, round after round. `mutes`: the drums its track's kit keeps silent (not heard, so not drawn). */
export function DrumBlock({ clip, ppb, mutes }: { clip: DrumsClip; ppb: number; mutes?: DrumId[] }) {
  const d: Groove = clip.content;
  const div = Math.max(1, d.div);
  const heard = { rows: d.rows, mutes };
  const w = Math.max(1.5, ppb / div - 1);
  const marks: React.ReactNode[] = [];
  cycles(clip).forEach((r, k) => {
    const first = Math.ceil(r.from * div - 1e-9);
    const last = Math.ceil(r.to * div - 1e-9);
    for (let i = first; i < last; i++)
      for (let l = 0; l < LANES.length; l++) {
        const lane = LANES[l];
        const lv = Math.max(...lane.ids.map((id) => heardAt(heard, id, i)));
        if (lv) marks.push(<rect key={`${k}:${i}:${l}`} x={(r.at + i / div - r.from) * ppb} y={lane.y * DRAW_H - 3} width={w} height={6} rx={1} opacity={0.35 + lv * 0.22} />);
      }
  });
  if (!marks.length) return <span className="tlc-empty">—</span>;
  return <svg className="tlc-svg drums" width={Math.max(1, clip.len * ppb)} height={DRAW_H} aria-hidden="true">{marks}</svg>;
}

/** A waveform as one closed path, 0..n across and −1..1 up and down. Made once for each list of peaks. */
const paths = new WeakMap<Float32Array, string>();
function wavePath(peaks: Float32Array): string {
  let d = paths.get(peaks);
  if (d !== undefined) return d;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const v = Math.max(0.02, Math.min(1, peaks[i] || 0));
    top.push(`${i === 0 ? "M" : "L"}${i} ${(-v).toFixed(3)}L${i + 1} ${(-v).toFixed(3)}`);
    bottom.push(`L${peaks.length - i} ${v.toFixed(3)}L${peaks.length - i - 1} ${v.toFixed(3)}`);
  }
  d = top.join("") + bottom.join("") + "Z";
  paths.set(peaks, d);
  return d;
}

/**
 * A recorded clip: the stretch of its take that it plays, as a waveform; past the take's end the take starts again.
 * `peaks`: how loud the take is along its length, 0 to 1, any number of them spread evenly over the take's frames
 * (none while the audio is not loaded: the clip is then a plain block with the take's number). A stereo take (one
 * recorded from a pair of inputs) is drawn as two waveforms, the left side over the right: `peaks` is then the left
 * side's and `peaksR` the right's.
 */
export function TakeBlock({ clip, take, peaks, peaksR, ppb, bpm }: { clip: AudioClip; take: Take5 | undefined; peaks?: Float32Array; peaksR?: Float32Array; ppb: number; bpm: number }) {
  const rate = take && take.rate > 0 ? take.rate : 48000;
  const total = take?.frames || clip.to;
  const label = take ? `Take ${take.n}` : "";
  const stereo = take?.channels === 2;
  const sides = stereo && peaks && peaksR ? [{ p: peaks, cls: " left" }, { p: peaksR, cls: " right" }] : peaks ? [{ p: peaks, cls: "" }] : [];
  return (
    <span className={`tlc-take${stereo ? " stereo" : ""}`}>
      {total > 0 && sides.map(({ p, cls }) => p.length > 0 && frameCycles(clip).map((r, k) => {
        const x = framesToBeats(r.at, rate, bpm) * ppb;
        const w = framesToBeats(r.to - r.from, rate, bpm) * ppb;
        const scale = p.length / total;
        return (
          <svg key={`${cls}${k}`} className={`tlc-wave${cls}`} style={{ left: x, width: Math.max(1, w) }} viewBox={`${(r.from * scale).toFixed(3)} -1 ${Math.max(0.001, (r.to - r.from) * scale).toFixed(3)} 2`} preserveAspectRatio="none" aria-hidden="true">
            <path d={wavePath(p)} />
          </svg>
        );
      }))}
      {label && <span className="tlc-label">{label}</span>}
    </span>
  );
}

/**
 * A song written in the app and the same music opened as a file should paint alike: the vibe
 * that sets the look is measured from what each path hears, and the two paths hear differently
 * (the app's song through an ear on the mix and on every track, with every note it plays known;
 * a file through the quick split of its mix into layers). Here one piece of music goes down
 * both paths and the two vibes are compared with each other and with other music.
 */
import { describe, expect, it } from "vitest";
import { Ear, type Frame } from "../listen/ear";
import { LayerAnalysis } from "../listen/layers";
import { loudest } from "../listen/songfile";
import { SignalStems } from "../listen/split";
import { fileWhen } from "./clock";
import { hzOfMidi } from "./layout";
import type { LayerKind } from "./layers";
import { Artist, type LayerCue } from "./painting";
import { getPalette } from "./palettes";
import { monoOf, renderPiece, type Piece, type PieceSpec } from "./pieces";
import { lookDistance, lookOf, normalise, vibeDistance } from "./vibe";

const base = (o: Partial<PieceSpec>): PieceSpec => ({ seed: 1, seconds: 10, bpm: 100, key: 0, ...o });
/** Two kinds of music (as in the vibe's own tests): a busy plucked groove, and a slow breathy song over a pad. */
const A = base({ seed: 1, bpm: 96, key: 0, drums: { level: 0.8, busy: true }, bass: { level: 0.7, pulse: true }, pluck: { level: 0.6 }, melody: { level: 0.7, staccato: true } });
const B = base({ seed: 3, bpm: 70, key: 9, minor: true, pad: { level: 0.7 }, vocal: { level: 0.7, breathy: true }, harmony: { level: 0.4 } });

/** The vibe of a song from a file: the worker's hearing, the quick split and all. */
async function viaFile(p: Piece): Promise<Float32Array> {
  const job = new LayerAnalysis({ sr: p.sr, left: p.left, right: p.right }, new SignalStems(), loudest(monoOf(p), p.sr));
  await job.prepare();
  while (await job.step(2));
  return job.vibe.fingerprint();
}

/**
 * The vibe of the app's own song, as the Canvas hears it while it plays: an ear on the mix and
 * one on every track (the live bank's), and every note and hit handed over as it is played.
 */
function viaApp(p: Piece): Float32Array {
  const a = new Artist();
  a.size(1000, 560);
  a.setPalette(getPalette("woodblock"));
  a.setKey(0, [0, 2, 4, 5, 7, 9, 11]);
  const mixEar = new Ear(p.sr, -54);
  const mono = monoOf(p);
  const tracks = Object.entries(p.stems) as [LayerKind, Float32Array][];
  // (the app's tracks: a pluck or a pad is a chords track, the rest are what they say)
  const layerOf = (l: LayerKind): LayerKind => (l === "other" ? "chords" : l);
  const ears = tracks.map(([l]) => ({ key: l, layer: layerOf(l), ear: new Ear(p.sr, -54, { light: l === "drums", every: l === "drums" ? 2 : 1 }) }));
  let id = 1;
  const cues: LayerCue[] = p.notes.map((n): LayerCue =>
    n.layer === "drums"
      ? { layer: "drums", key: "drums", hit: true, cue: { id: -1, t: n.t, hz: n.drum === "kick" ? 60 : n.drum === "snare" ? 1800 : 9000, amp: n.vel, attack: 1, bright: 0.6, rough: n.drum === "kick" ? 0.2 : 0.85, len: 0, ring: n.len, drum: n.drum } }
      : { layer: layerOf(n.layer), key: n.layer, cue: { id: id++, t: n.t, hz: hzOfMidi(n.midi), amp: n.vel, attack: 0.5, bright: 0.5, rough: 0.1, len: n.len, ring: 1.5 } },
  ).sort((x, y) => x.cue.t - y.cue.t);
  const step = Math.round(p.sr / 60);
  let ci = 0;
  for (let i = 0; i < mono.length; i += step) {
    const now = Math.min(mono.length, i + step) / p.sr;
    const mix: Frame[] = mixEar.push(mono.subarray(i, i + step));
    const due: LayerCue[] = [];
    // the app hands its notes over a little ahead of their time
    while (ci < cues.length && cues[ci].cue.t <= now + 0.3) due.push(cues[ci++]);
    const heard = ears.map((e, k) => ({ key: e.key, layer: e.layer, frames: e.ear.push(tracks[k][1].subarray(i, i + step)), exact: true }));
    a.hear({ now, when: fileWhen(16, 2, 1), mix, ears: heard, cues: due });
  }
  return a.vibe.fingerprint();
}

describe("a song written in the app and the same music from a file land close together", () => {
  it("the same music down the two paths is nearer itself than other music is, in the numbers and in the look", async () => {
    const fileA = normalise(await viaFile(renderPiece(A)));
    const appA = normalise(viaApp(renderPiece(A)));
    const fileB = normalise(await viaFile(renderPiece(B)));
    const appB = normalise(viaApp(renderPiece(B)));
    const same = vibeDistance(fileA, appA);
    const sameB = vibeDistance(fileB, appB);

    for (const other of [fileB, appB]) expect(same).toBeLessThan(0.5 * vibeDistance(fileA, other));
    for (const other of [fileA, appA]) expect(sameB).toBeLessThan(0.5 * vibeDistance(fileB, other));
    const look = (v: Float32Array) => lookOf(v);
    expect(lookDistance(look(fileA), look(appA))).toBeLessThan(lookDistance(look(fileA), look(appB)));
    expect(lookDistance(look(fileB), look(appB))).toBeLessThan(lookDistance(look(fileB), look(appA)));
  });
});

/**
 * The legend's swatches: a little painting of each layer's own paint, made by the same hands
 * and the same wet paint as the canvas, in the colours in use.
 *
 * Each layer plays a short phrase of its own (the drums a kick, a snare and hats; the bass a
 * held note and two short ones; the chords a held chord and a stab; the melody a joined phrase
 * and three short notes; the harmony a line of its own; the voice a held note with a vibrato;
 * the other sounds a haze) on a strip of canvas, and the strip is cut into one swatch per layer.
 */
import { hexToRgb, type RGB } from "./color";
import { LAYER_ORDER, layerColours, type LayerKind } from "./layers";
import { noteColors, upOfHz, hzOfMidi } from "./layout";
import type { Palette } from "./palettes";
import type { Place } from "./place";
import { Sim } from "./sim";
import { LayerHand, type Cue } from "./strokes";

/** Each swatch, in real pixels, as it is painted (it is shown smaller, so the marks look as they do on a canvas). */
export const SWATCH_W = 168;
export const SWATCH_H = 84;
/** The phrase lasts this long (seconds), left to right across the swatch. */
const LEN = 2;

/** The stretch of the scale each layer's phrase is drawn in (the swatch is too small for the whole of it). */
const SPAN: Record<LayerKind, [number, number]> = {
  drums: [0.02, 1],
  bass: [upOfHz(30), upOfHz(160)],
  chords: [upOfHz(180), upOfHz(700)],
  melody: [upOfHz(300), upOfHz(900)],
  harmony: [upOfHz(260), upOfHz(800)],
  vocals: [upOfHz(200), upOfHz(600)],
  other: [0.2, 0.9],
};

const cue = (id: number, t: number, midi: number, amp: number, len: number | undefined, attack = 0.6, ring = 1.2): Cue => ({ id, t, hz: hzOfMidi(midi), amp, attack, bright: 0.55, rough: 0.15, len, ring });

/** What each layer plays, as calls on its hand. */
function phrase(layer: LayerKind, hand: LayerHand, step: (t: number) => void) {
  const at = (t: number, f: () => void) => ({ t, f });
  const events: { t: number; f: () => void }[] = [];
  switch (layer) {
    case "drums": {
      const hit = (t: number, drum: string, hz: number, amp: number, ring: number, rough: number) =>
        events.push(at(t, () => hand.hit({ id: -1, t, hz, amp, attack: 1, bright: 0.6, rough, len: 0, ring, drum })));
      hit(0.12, "kick", 60, 0.95, 0.4, 0.2);
      hit(0.62, "snare", 1800, 0.85, 0.3, 0.8);
      hit(1.12, "kick", 60, 0.8, 0.4, 0.2);
      hit(1.52, "snare", 1800, 0.75, 0.3, 0.8);
      for (const t of [0.3, 0.45, 0.85, 1.0, 1.3, 1.75]) hit(t, "hat", 9000, 0.6, 0.05, 0.9);
      hit(1.85, "crash", 7000, 0.7, 1.2, 0.9);
      break;
    }
    case "bass":
      events.push(at(0.1, () => hand.start(cue(1, 0.1, 33, 0.85, 0.85, 0.5, 2))));
      events.push(at(1.15, () => hand.start(cue(2, 1.15, 36, 0.8, 0.12, 0.8, 2))));
      events.push(at(1.45, () => hand.start(cue(3, 1.45, 38, 0.8, 0.12, 0.8, 2))));
      break;
    case "chords":
      for (const [i, m] of [60, 64, 67].entries()) events.push(at(0.1, () => hand.start(cue(10 + i, 0.1, m, 0.7, 1.05, 0.2, 3))));
      for (const [i, m] of [62, 65, 69].entries()) events.push(at(1.45, () => hand.start(cue(20 + i, 1.45, m, 0.8, 0.1, 0.9, 0.6))));
      break;
    case "melody":
    case "harmony": {
      const down = layer === "harmony" ? -3 : 0;
      const line = [72, 74, 76, 74, 77];
      line.forEach((m, i) => events.push(at(0.1 + i * 0.2, () => hand.start(cue(30 + i, 0.1 + i * 0.2, m + down, 0.75, 0.2, 0.5, 1.5)))));
      [79, 76, 72].forEach((m, i) => events.push(at(1.3 + i * 0.2, () => hand.start(cue(40 + i, 1.3 + i * 0.2, m + down, 0.75, 0.07, 0.9, 0.5)))));
      break;
    }
    case "vocals": {
      // a voice, heard as an ear hears it: a pitch that wavers, and its breath
      hand.texture = { bright: 0.55, rough: 0.35, level: 0.7 };
      events.push(at(0.1, () => hand.start({ id: 50, t: 0.1, hz: hzOfMidi(64), amp: 0.8, attack: 0.2, bright: 0.55, rough: 0.35 })));
      for (let t = 0.12; t < 1.8; t += 1 / 60) {
        const hz = hzOfMidi(64 + (t > 1 ? 2 : 0)) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 2));
        events.push(at(t, () => hand.hold(50, t, hz, 0.8)));
      }
      events.push(at(1.8, () => hand.stop(50, 1.8)));
      break;
    }
    case "other":
      hand.texture = { bright: 0.5, rough: 0.3, level: 0.75 };
      break;
  }
  events.sort((a, b) => a.t - b.t);
  let i = 0;
  for (let t = 0; t <= LEN + 0.3; t += 1 / 60) {
    while (i < events.length && events[i].t <= t) events[i++].f();
    step(t);
  }
}

/**
 * Paint every layer's swatch, in a palette (and the casting of its colours the music has
 * chosen). Null where the paint cannot run.
 */
export function paintSwatches(pal: Palette, turn = 0, light = 0, tonic = 0, scale = [0, 2, 4, 5, 7, 9, 11]): Record<LayerKind, HTMLCanvasElement> | null {
  if (typeof document === "undefined" || !Sim.supported()) return null;
  const strip = document.createElement("canvas");
  let sim: Sim;
  try {
    sim = new Sim(strip);
  } catch {
    return null;
  }
  const n = LAYER_ORDER.length;
  const W = SWATCH_W;
  const H = SWATCH_H;
  sim.size(W * n, H);
  sim.setGround(hexToRgb(pal.ground));
  const c = layerColours(pal, turn, light);
  const palette: RGB[] = pal.colors.map(hexToRgb);
  const map = noteColors(tonic, scale, palette.length);
  LAYER_ORDER.forEach((layer, k) => {
    const hand = new LayerHand(layer);
    // the marks are drawn at a little over twice the size they have on a canvas of 560 pixels, as if close up
    hand.size(W, 560 * 0.45);
    hand.colours(c, palette, map);
    hand.manner = { wet: 0.45, loose: 0.3, body: 1.1 };
    hand.run = 1;
    const [lo, hi] = SPAN[layer];
    hand.where = (t: number, up: number): Place => {
      const f = (Math.max(0, Math.min(1, (up - lo) / (hi - lo))) - 0.5) * 0.7 + 0.5;
      return { x: k * W + W * (0.08 + 0.84 * (t / LEN)), y: H * (1 - f), dx: 1, dy: 0, seg: 1, scale: 1 };
    };
    hand.put = (s) => {
      // nothing strays into the next swatch
      if (s.x < k * W + 2 || s.x > (k + 1) * W - 2) return;
      sim.stamp(s);
    };
    phrase(layer, hand, (t) => {
      hand.advance(t);
      if (sim.waiting > 3000) sim.step(1 / 60);
    });
    hand.lift();
  });
  // let it run and settle for a moment, as wet paint does
  for (let i = 0; i < 45; i++) sim.step(1 / 30);
  sim.show();
  const out = {} as Record<LayerKind, HTMLCanvasElement>;
  LAYER_ORDER.forEach((layer, k) => {
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    cv.getContext("2d")!.drawImage(strip, k * W, 0, W, H, 0, 0, W, H);
    out[layer] = cv;
  });
  sim.destroy();
  return out;
}

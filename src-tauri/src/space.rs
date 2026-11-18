//! A hall, and the list of spaces the reverb offers (each of the others is its own design, in
//! its own module: `room`, `chamber`, `cloud`, `spring`, and the plate in `dsp`).
//!
//! The hall is the eight-line feedback delay network of Fons Adriaensen's zita-rev1 as
//! extended in freeverb3's "zrev2" (the hall of Dragonfly Reverb; GPL-3.0-or-later): each line is
//! a delay with an all-pass inside it; the eight outputs are mixed through a Hadamard matrix
//! (every line feeds every other, equally) and written back. Lows and highs decay at their own
//! rates (a real hall keeps its warmth longer than its brilliance), the voice is smeared by a
//! chain of all-passes before it enters, and two slow oscillators move the delays slightly so
//! long tails never ring on one note. A handful of early reflections (freeverb3's tap pattern)
//! put its walls in front of it.

use crate::dsp::{AllPass, Line, OnePole};
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SpaceKind {
    Room,
    Hall,
    Chamber,
    Cloud,
    Spring,
    /// the plate, with its tail climbing an octave
    Shimmer,
    /// the Dattorro plate (also what an unknown name becomes)
    #[default]
    #[serde(other)]
    Plate,
}

/// zrev2: each line's whole loop time, and the all-pass part of it (seconds, for a 70 m hall).
const TOTAL: [f32; 8] = [0.153129, 0.210389, 0.127837, 0.256891, 0.174713, 0.192303, 0.125000, 0.219991];
const DIFF: [f32; 8] = [0.020346, 0.024421, 0.031604, 0.027333, 0.022904, 0.029291, 0.013458, 0.019123];
/// zrev2: the input all-passes, in samples at 34125 Hz, left and right.
const IN_L: [f32; 8] = [617.0, 535.0, 434.0, 347.0, 218.0, 162.0, 122.0, 74.0];
const IN_R: [f32; 8] = [603.0, 547.0, 416.0, 364.0, 236.0, 162.0, 131.0, 79.0];
/// freeverb3 early reflections, preset 1: times (seconds) and gains, left and right.
const ER_L: [(f32, f32); 6] = [(0.0199, 1.020), (0.0354, 0.818), (0.0389, 0.635), (0.0414, 0.719), (0.0699, 0.267), (0.0796, 0.242)];
const ER_R: [(f32, f32); 6] = [(0.0209, 1.021), (0.0364, 0.820), (0.0399, 0.633), (0.0424, 0.722), (0.0709, 0.187), (0.0806, 0.243)];

/// What a space is made of. `size` and `decay` run from the smallest to the largest the knob gives.
struct Recipe {
    /// line lengths as a fraction of the 70 m hall
    size: (f32, f32),
    /// seconds for the mids to fall by 60 dB
    decay: (f32, f32),
    /// how much longer the lows last, below `low_hz`; how much shorter the highs, above `high_hz`
    low: f32,
    low_hz: f32,
    high: f32,
    high_hz: f32,
    /// all-pass coefficient before and inside the loop
    diffusion: f32,
    /// early reflections: level, and how far apart (1 = as measured)
    early: f32,
    early_size: f32,
    /// how far the delays wander, in milliseconds
    wander: f32,
}
/// A concert hall: late, warm, the highs die first.
const HALL: Recipe = Recipe { size: (0.3, 0.6), decay: (1.2, 4.0), low: 1.3, low_hz: 500.0, high: 0.36, high_hz: 5200.0, diffusion: 0.6, early: 0.3, early_size: 1.0, wander: 0.6 };

pub struct Space {
    sr: f32,
    pre: Line,
    pub predelay: f32,
    early: Line,
    er_scale: f32,
    er_level: f32,
    in_l: [AllPass; 8],
    in_r: [AllPass; 8],
    ap: [AllPass; 8],
    line: [Line; 8],
    len: [f32; 8],
    gain: [f32; 8],
    lo: [OnePole; 8],
    hi: [OnePole; 8],
    lo_g: [f32; 8],
    hi_g: [f32; 8],
    lfo: [f32; 2],
    step: [f32; 2],
    wander: f32,
    tone: OnePole,
    tone_r: OnePole,
}

impl Space {
    pub fn new(sr: f32) -> Self {
        let k = sr / 34125.0;
        let ap = |len: f32| AllPass::new(len, 0.6);
        let mut s = Space {
            sr,
            pre: Line::new((sr * 0.26) as usize),
            predelay: 0.02,
            early: Line::new((sr * 0.1) as usize),
            er_scale: 1.0,
            er_level: 0.3,
            in_l: IN_L.map(|n| ap(n * k)),
            in_r: IN_R.map(|n| ap(n * k)),
            // room for the largest space, and for the wander
            ap: DIFF.map(|d| AllPass::new(d * sr + 200.0, 0.6)),
            line: TOTAL.map(|t| Line::new((t * sr) as usize + 400)),
            len: [1.0; 8],
            gain: [0.0; 8],
            lo: [OnePole::default(); 8],
            hi: [OnePole::default(); 8],
            lo_g: [0.0; 8],
            hi_g: [0.0; 8],
            lfo: [0.0, 1.3],
            step: [2.0 * PI * 0.9 / sr, 2.0 * PI * 1.3 / sr],
            wander: 0.0,
            tone: OnePole::default(),
            tone_r: OnePole::default(),
        };
        s.set(0.5, 0.3);
        s
    }

    /// How big the hall is (0..1: its size and its decay together) and how dark (0..1).
    pub fn set(&mut self, size: f32, tone: f32) {
        let size = size.clamp(0.0, 1.0);
        let r = HALL;
        let scale = r.size.0 + (r.size.1 - r.size.0) * size;
        let rt60 = r.decay.0 + (r.decay.1 - r.decay.0) * size * size.max(0.3);
        // darker: the highs die sooner still, and the return is rolled off lower
        let high = r.high * (1.15 - 0.6 * tone.clamp(0.0, 1.0));
        for i in 0..8 {
            let total = (TOTAL[i] * scale * self.sr).max(64.0);
            let diff = (DIFF[i] * scale * self.sr).max(8.0);
            self.ap[i].len = diff;
            self.ap[i].g = if i % 2 == 0 { r.diffusion } else { -r.diffusion };
            self.len[i] = (total - diff).max(16.0);
            // one trip round this line costs so much of the 60 dB
            let trip = -3.0 * total / (rt60 * self.sr);
            self.gain[i] = (1.0f32 / 8.0).sqrt() * 10f32.powf(trip);
            // lows and highs: their own decay times, as a gain against the mids, each trip
            self.lo_g[i] = 10f32.powf(trip * (1.0 / r.low - 1.0)) - 1.0;
            self.hi_g[i] = 10f32.powf(trip * (1.0 / high - 1.0)) - 1.0;
            self.lo[i].tune(r.low_hz, self.sr);
            self.hi[i].tune(r.high_hz, self.sr);
        }
        for a in self.in_l.iter_mut().chain(self.in_r.iter_mut()) {
            a.g = -(r.diffusion + 0.15).min(0.82);
        }
        self.er_scale = r.early_size * (0.6 + 0.8 * size);
        self.er_level = r.early;
        self.wander = r.wander * 0.001 * self.sr;
        let cut = 12000.0 - 8000.0 * tone.clamp(0.0, 1.0);
        self.tone.tune(cut, self.sr);
        self.tone_r.tune(cut, self.sr);
    }

    /// One sample of the voice in, the space's left and right out (wet only).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        self.pre.push(x);
        let x = self.pre.at((self.predelay * self.sr).max(1.0));
        // early reflections: the first walls
        let (mut el, mut er) = (0.0, 0.0);
        if self.er_level > 0.0 {
            self.early.push(x);
            for k in 0..6 {
                el += ER_L[k].1 * self.early.at(ER_L[k].0 * self.er_scale * self.sr);
                er += ER_R[k].1 * self.early.at(ER_R[k].0 * self.er_scale * self.sr);
            }
            el *= 0.3 * self.er_level;
            er *= 0.3 * self.er_level;
        }
        // into the loop: the voice plus a fifth of the early reflections, smeared
        let (mut dl, mut dr) = (x + 0.2 * el, x + 0.2 * er);
        for a in self.in_l.iter_mut() {
            dl = a.run(dl, 0.0);
        }
        for a in self.in_r.iter_mut() {
            dr = a.run(dr, 0.0);
        }
        // two slow oscillators move the delays (never the same way twice in a row)
        for k in 0..2 {
            self.lfo[k] += self.step[k];
            if self.lfo[k] > 2.0 * PI {
                self.lfo[k] -= 2.0 * PI;
            }
        }
        let (m1, m2) = (self.lfo[0].sin() * self.wander, self.lfo[1].sin() * self.wander);
        let mods = [m1, m2, -m1, -m2, m2, -m1, m1, -m2];
        let inject = [dl, dl, -dl, -dl, dr, dr, -dr, -dr];
        let mut v = [0.0f32; 8];
        for i in 0..8 {
            let d = self.line[i].at_smooth(self.len[i] + self.wander + 2.0 + mods[i]) + inject[i];
            // the lows and the highs take their own toll each trip
            let low = self.lo[i].run(d);
            let high = d - self.hi[i].run(d);
            let d = d + self.lo_g[i] * low + self.hi_g[i] * high;
            v[i] = self.ap[i].run(d, 0.0);
        }
        // Hadamard: three rounds of sums and differences
        for (a, b) in [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)] {
            let t = v[a] - v[b];
            v[a] += v[b];
            v[b] = t;
        }
        for i in 0..8 {
            self.line[i].push(v[i] * self.gain[i]);
        }
        let l = 0.2 * (v[0] - v[1] + v[2] - v[3]) * 0.3536 + el;
        let r = 0.2 * (v[4] + v[5] - v[6] - v[7]) * 0.3536 + er;
        (self.tone.run(l), self.tone_r.run(r))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48000.0;
    /// A short burst of noise into a space; the energy (both sides) in each 50 ms after it.
    fn tail(size: f32, seconds: f32) -> Vec<f64> {
        let mut s = Space::new(SR);
        s.set(size, 0.3);
        s.predelay = 0.0;
        let mut seed = 12345u32;
        let mut out = vec![];
        let win = (SR * 0.05) as usize;
        let mut acc = 0.0f64;
        for i in 0..(SR * seconds) as usize {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let x = if i < 2400 { (seed >> 8) as f32 / 8388608.0 - 1.0 } else { 0.0 };
            let (l, r) = s.run(x * 0.5);
            assert!(l.is_finite() && r.is_finite());
            acc += (l * l + r * r) as f64;
            if (i + 1) % win == 0 {
                out.push(acc);
                acc = 0.0;
            }
        }
        out
    }
    /// Seconds until the tail has fallen 60 dB below its level just after the burst.
    fn rt60(e: &[f64]) -> f32 {
        let start = e[2..5].iter().cloned().fold(0.0, f64::max);
        let k = e.iter().enumerate().skip(4).find(|(_, v)| **v < start * 1e-6).map(|(i, _)| i).unwrap_or(e.len());
        k as f32 * 0.05
    }

    #[test]
    fn the_hall_rings_for_seconds_longer_when_larger_and_dies_away() {
        for size in [0.0, 0.5, 1.0] {
            let e = tail(size, 14.0);
            assert!(e[1] > 1e-4, "{size}: it sounds");
            assert!(*e.last().unwrap() < e[1] * 1e-7, "{size}: it dies away ({:e} of {:e})", e.last().unwrap(), e[1]);
        }
        let hall = rt60(&tail(0.5, 14.0));
        assert!(hall > 1.2 && hall < 4.5, "hall {hall}");
        assert!(rt60(&tail(1.0, 14.0)) > hall + 0.5);
    }

    #[test]
    fn left_and_right_differ_from_one_voice() {
        let mut s = Space::new(SR);
        s.set(0.5, 0.3);
        let (mut same, mut ll, mut rr) = (0.0f64, 0.0f64, 0.0f64);
        for i in 0..48000 {
            let x = if i < 4800 { ((i * 7919) % 200) as f32 / 100.0 - 1.0 } else { 0.0 };
            let (l, r) = s.run(x * 0.3);
            same += (l * r) as f64;
            ll += (l * l) as f64;
            rr += (r * r) as f64;
        }
        let corr = same / (ll * rr).sqrt();
        assert!(corr.abs() < 0.5, "left/right correlation {corr}");
        assert!((ll / rr).log10().abs() < 0.5, "balanced: {ll} vs {rr}");
    }

    #[test]
    fn the_highs_die_before_the_lows_in_a_hall() {
        // one second after a burst, compare what is left above 5 kHz with what is left below 500 Hz
        let mut s = Space::new(SR);
        s.set(0.6, 0.3);
        s.predelay = 0.0;
        let mut lo = OnePole::hz(500.0, SR);
        let mut hi = OnePole::hz(5000.0, SR);
        let mut seed = 99u32;
        let (mut e_lo, mut e_hi, mut e_lo0, mut e_hi0) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for i in 0..(SR * 1.6) as usize {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let x = if i < 2400 { (seed >> 8) as f32 / 8388608.0 - 1.0 } else { 0.0 };
            let (l, _) = s.run(x * 0.5);
            let a = lo.run(l);
            let b = l - hi.run(l);
            if (4800..14400).contains(&i) {
                e_lo0 += (a * a) as f64;
                e_hi0 += (b * b) as f64;
            }
            if i >= 62400 {
                e_lo += (a * a) as f64;
                e_hi += (b * b) as f64;
            }
        }
        assert!(e_hi / e_hi0 < 0.2 * e_lo / e_lo0, "highs kept {:e}, lows kept {:e}", e_hi / e_hi0, e_lo / e_lo0);
    }
}

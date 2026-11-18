//! Width: three ways to make one voice wider and thicker. All are added beside the untouched
//! voice, which itself is never delayed.
//!
//! - **Double**: two slightly late copies, one each side, their timing drifting gently and
//!   independently, as a second take would (automatic double tracking).
//! - **Micro**: the studio "micro-pitch" trick: the left copy a few cents flat, the right a few
//!   cents sharp, each a little late. The pitch shifter is the two-head design every open one
//!   uses (mda Detune, Mutable Instruments Clouds, Airwindows): two read heads half a window
//!   apart sweep through a short delay, cross-fading so the jump back is never heard.
//! - **Chorus**: the Juno-60's mode I as measured from the instrument (one triangle oscillator at
//!   0.513 Hz sweeping two short delays in opposite directions between about 1.5 and 5.3 ms).

use crate::dsp::{Line, OnePole};
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum WidthKind {
    Micro,
    Chorus,
    /// (also what an unknown name becomes)
    #[default]
    #[serde(other)]
    Double,
}

pub struct Width {
    sr: f32,
    pub kind: WidthKind,
    line: Line,
    // double
    lfo: [f32; 2],
    // micro: where each side's two heads are in their sweep (0..1)
    ph: [f32; 2],
    // chorus
    tri: f32,
    tone: [OnePole; 2],
}

impl Width {
    pub fn new(sr: f32) -> Self {
        Width { sr, kind: WidthKind::Double, line: Line::new((sr * 0.08) as usize), lfo: [0.0, 1.7], ph: [0.0, 0.37], tri: 0.0, tone: [OnePole::hz(9000.0, sr); 2] }
    }

    /// The voice in; what to add on the left and on the right (at full amount).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        self.line.push(x);
        let sr = self.sr;
        match self.kind {
            WidthKind::Double => {
                // two unrelated slow sways: 13 ms and 21 ms, each wandering by about a millisecond
                self.lfo[0] += 2.0 * PI * 0.31 / sr;
                self.lfo[1] += 2.0 * PI * 0.43 / sr;
                for p in self.lfo.iter_mut() {
                    if *p > 2.0 * PI {
                        *p -= 2.0 * PI;
                    }
                }
                let m = sr * 0.0012;
                let a = self.line.at_smooth(sr * 0.013 + m * self.lfo[0].sin());
                let b = self.line.at_smooth(sr * 0.021 + m * self.lfo[1].sin());
                (a * 0.45, b * 0.45)
            }
            WidthKind::Micro => {
                // 9 cents down on the left, 9 up on the right, through a 30 ms window
                let win = sr * 0.03;
                let cents = 9.0f32;
                let ratio = 2f32.powf(cents / 1200.0);
                let mut out = [0.0f32; 2];
                for (k, r) in [(0usize, 1.0 / ratio), (1usize, ratio)] {
                    // a head reading at speed r falls behind (or catches up) by 1 - r each sample
                    self.ph[k] += (1.0 - r) / win;
                    self.ph[k] -= self.ph[k].floor();
                    let p1 = self.ph[k];
                    let p2 = (p1 + 0.5).fract();
                    // each head is loudest in the middle of its sweep, silent where it jumps
                    let g1 = 0.5 - 0.5 * (2.0 * PI * p1).cos();
                    let g2 = 1.0 - g1;
                    let base = sr * if k == 0 { 0.008 } else { 0.012 };
                    out[k] = g1 * self.line.at_smooth(base + p1 * win) + g2 * self.line.at_smooth(base + p2 * win);
                }
                (out[0] * 0.5, out[1] * 0.5)
            }
            WidthKind::Chorus => {
                self.tri += 0.513 / sr;
                self.tri -= self.tri.floor();
                let t = 1.0 - (2.0 * self.tri - 1.0).abs();
                let dl = 0.00154 + (0.00515 - 0.00154) * t;
                let dr = 0.00151 + (0.00540 - 0.00151) * (1.0 - t);
                let a = self.tone[0].run(self.line.at_smooth(dl * sr));
                let b = self.tone[1].run(self.line.at_smooth(dr * sr));
                (a * 0.55, b * 0.55)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    const SR: f32 = 48000.0;

    #[test]
    fn micro_pitch_is_flat_on_the_left_and_sharp_on_the_right() {
        let mut w = Width::new(SR);
        w.kind = WidthKind::Micro;
        // count the cycles of each side over ten seconds of a 1 kHz tone
        let (mut cl, mut cr) = (0u32, 0u32);
        let (mut pl, mut pr) = (0.0f32, 0.0f32);
        let n = 480000;
        for i in 0..n {
            let (l, r) = w.run((2.0 * PI * 1000.0 * i as f32 / SR).sin());
            if i > 4800 {
                if pl <= 0.0 && l > 0.0 {
                    cl += 1;
                }
                if pr <= 0.0 && r > 0.0 {
                    cr += 1;
                }
            }
            pl = l;
            pr = r;
        }
        let secs = (n - 4800) as f32 / SR;
        let (fl, fr) = (cl as f32 / secs, cr as f32 / secs);
        // 9 cents of 1 kHz is 5.2 Hz
        assert!((fl - 994.8).abs() < 1.5, "left {fl} Hz");
        assert!((fr - 1005.2).abs() < 1.5, "right {fr} Hz");
    }

    #[test]
    fn each_kind_gives_two_different_sides_at_a_steady_level() {
        for k in [WidthKind::Double, WidthKind::Micro, WidthKind::Chorus] {
            let mut w = Width::new(SR);
            w.kind = k;
            let (mut l, mut r) = (vec![], vec![]);
            for i in 0..96000 {
                // something voice-like: several partials at once
                let t = i as f32 / SR;
                let x = [220.0f32, 440.0, 713.0, 1234.0, 2600.0].iter().map(|f| (2.0 * PI * f * t).sin()).sum::<f32>() * 0.08;
                let (a, b) = w.run(x);
                assert!(a.is_finite() && b.is_finite());
                if i >= 48000 {
                    l.push(a as f64);
                    r.push(b as f64);
                }
            }
            let rms = |v: &[f64]| (v.iter().map(|x| x * x).sum::<f64>() / v.len() as f64).sqrt();
            let diff: Vec<f64> = l.iter().zip(&r).map(|(a, b)| a - b).collect();
            assert!(rms(&l) > 0.03 && rms(&r) > 0.03, "{k:?}: both sides sound");
            assert!(db(rms(&l) / rms(&r)).abs() < 3.0, "{k:?}: balanced");
            assert!(rms(&diff) > 0.3 * rms(&l), "{k:?}: the sides differ");
        }
    }

    #[test]
    fn the_micro_shift_has_no_clicks_where_its_heads_jump() {
        let mut w = Width::new(SR);
        w.kind = WidthKind::Micro;
        let mut last = 0.0f32;
        let mut jump = 0.0f32;
        for i in 0..240000 {
            let (l, _) = w.run(0.3 * (2.0 * PI * 200.0 * i as f32 / SR).sin());
            if i > 4800 {
                jump = jump.max((l - last).abs());
            }
            last = l;
        }
        // a 200 Hz tone at this level moves by 0.004 a sample at most
        assert!(jump < 0.012, "{jump}");
    }
}

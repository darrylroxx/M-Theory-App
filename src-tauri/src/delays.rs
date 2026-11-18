//! Echoes: one stereo delay core, six characters. The differences are the ones the well-known
//! open-source delays have in their loops (Surge XT's delay, Cocoa Delay, Calf, Airwindows
//! TapeDelay, CHOW Tape's wow and flutter): what each repeat is filtered through, whether it is
//! saturated, whether the time wavers, and how left and right feed each other.
//!
//! - **Slap**: one repeat, tape-toned; the rock'n'roll doubling.
//! - **Tape**: every repeat a little duller and rounder (a band-pass and a soft curve in the
//!   loop), the time wavering as a tape transport does (a slow wow plus a faster flutter).
//! - **Analog**: a bucket-brigade's darkness: a steep 2.8 kHz low-pass in the loop and a
//!   harder curve, repeats that sink into the track.
//! - **Digital**: clean repeats, only the extremes trimmed.
//! - **Ping-pong**: the voice goes in on the left, and each repeat crosses to the other side.
//! - **Ambient**: all-passes inside the loop smear each repeat into the next, the time drifts
//!   in opposite directions left and right: closer to a reverb than an echo.
//!
//! The delay time glides when it is changed (as a tape head being moved does) instead of
//! clicking, and the lines are read through four points so a moving time never dulls the sound.

use crate::dsp::{AllPass, Line};
use crate::eqm::Bq;
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum EchoKind {
    Slap,
    Analog,
    Digital,
    Pingpong,
    Ambient,
    /// (also what an unknown name becomes)
    #[default]
    #[serde(other)]
    Tape,
}

struct Voice {
    /// loop filters: low cut and high cut (Hz)
    hp: f64,
    lp: f64,
    /// 0 none, 1 soft (tape), 2 harder (analog)
    drive: u8,
    /// wow and flutter depth, as a fraction of the delay time
    wow: f32,
    flutter: f32,
    /// the right side's time against the left's
    spread: f32,
    /// feedback: its ceiling, and how the knob maps onto it
    max_fb: f32,
    cross: bool,
    diffuse: bool,
}
fn voice(k: EchoKind) -> Voice {
    match k {
        EchoKind::Slap => Voice { hp: 150.0, lp: 6000.0, drive: 1, wow: 0.0012, flutter: 0.0004, spread: 1.06, max_fb: 0.12, cross: false, diffuse: false },
        EchoKind::Tape => Voice { hp: 120.0, lp: 5200.0, drive: 1, wow: 0.0022, flutter: 0.0007, spread: 1.03, max_fb: 0.9, cross: false, diffuse: false },
        EchoKind::Analog => Voice { hp: 60.0, lp: 2800.0, drive: 2, wow: 0.0006, flutter: 0.0, spread: 1.0, max_fb: 0.92, cross: false, diffuse: false },
        EchoKind::Digital => Voice { hp: 150.0, lp: 9000.0, drive: 0, wow: 0.0, flutter: 0.0, spread: 1.0, max_fb: 0.9, cross: false, diffuse: false },
        EchoKind::Pingpong => Voice { hp: 200.0, lp: 8000.0, drive: 0, wow: 0.0, flutter: 0.0, spread: 1.0, max_fb: 0.88, cross: true, diffuse: false },
        EchoKind::Ambient => Voice { hp: 250.0, lp: 5500.0, drive: 1, wow: 0.004, flutter: 0.0, spread: 1.31, max_fb: 0.93, cross: true, diffuse: true },
    }
}

pub struct Echoes {
    sr: f32,
    kind: EchoKind,
    v: Voice,
    line: [Line; 2],
    hp: [Bq; 2],
    lp: [Bq; 2],
    ap: [[AllPass; 3]; 2],
    /// where the read head is, and where it is going (samples)
    now: f32,
    want: f32,
    glide: f32,
    feedback: f32,
    wow: f32,
    flut: f32,
    drift: f32,
    seed: u32,
    fb: [f32; 2],
}

impl Echoes {
    pub fn new(sr: f32) -> Self {
        let n = (sr * 2.2) as usize;
        let ap = |a: f32, b: f32, c: f32| [AllPass::new(a * sr, 0.6), AllPass::new(b * sr, 0.6), AllPass::new(c * sr, 0.6)];
        let mut e = Echoes {
            sr,
            kind: EchoKind::Tape,
            v: voice(EchoKind::Tape),
            line: [Line::new(n), Line::new(n)],
            hp: [Bq::default(); 2],
            lp: [Bq::default(); 2],
            ap: [ap(0.0047, 0.0113, 0.0171), ap(0.0053, 0.0127, 0.0189)],
            now: sr * 0.25,
            want: sr * 0.25,
            // the head covers most of a change of time in about a tenth of a second
            glide: 1.0 - (-1.0 / (0.1 * sr)).exp(),
            feedback: 0.2,
            wow: 0.0,
            flut: 0.0,
            drift: 0.0,
            seed: 0x2545_F491,
            fb: [0.0; 2],
        };
        e.set(EchoKind::Tape, 0.25, 0.2);
        e
    }

    /// The kind of echo, its time (seconds), and how much comes back (0..1).
    pub fn set(&mut self, kind: EchoKind, time: f32, feedback: f32) {
        if kind != self.kind || self.hp[0].is_flat() {
            self.kind = kind;
            self.v = voice(kind);
            for k in 0..2 {
                self.hp[k].highpass(self.v.hp, 0.7071, self.sr as f64);
                self.lp[k].lowpass(self.v.lp, if kind == EchoKind::Analog { 0.9 } else { 0.7071 }, self.sr as f64);
            }
        }
        self.want = (time.clamp(0.02, 1.6) * self.sr).max(8.0);
        self.feedback = feedback.clamp(0.0, 1.0) * self.v.max_fb;
    }

    #[inline]
    fn shape(&self, x: f32) -> f32 {
        match self.v.drive {
            // Spiral (Airwindows): straight when quiet, a smooth ceiling when loud
            1 => {
                let a = x.abs().min(1.2);
                if a < 1e-6 { x } else { (x.signum() * a * a).sin() / a }
            }
            2 => (x * 1.4).tanh() / 1.4,
            _ => x.clamp(-1.5, 1.5),
        }
    }

    /// One sample of the voice in; the echoes' left and right out (wet only).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        self.now += (self.want - self.now) * self.glide;
        // wow: a slow sway with a little random drift; flutter: a faster shiver (three partials)
        self.wow += 2.0 * PI * 0.46 / self.sr;
        self.flut += 2.0 * PI * 5.7 / self.sr;
        if self.wow > 2.0 * PI {
            self.wow -= 2.0 * PI;
        }
        if self.flut > 2.0 * PI {
            self.flut -= 2.0 * PI;
        }
        self.seed = self.seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let noise = (self.seed >> 9) as f32 / 4194304.0 - 1.0;
        self.drift += (noise * 0.6 - self.drift) * (6.0 / self.sr);
        let sway = self.v.wow * (self.wow.sin() + self.drift) + self.v.flutter * (self.flut.sin() + 0.35 * (2.0 * self.flut + 2.36).sin() + 0.43 * (3.0 * self.flut - 0.31).sin());
        let dl = self.now * (1.0 + sway);
        let dr = self.now * self.v.spread * (1.0 - if self.v.diffuse { sway } else { -sway });
        let mut out = [self.line[0].at_smooth(dl), self.line[1].at_smooth(dr)];
        for k in 0..2 {
            let mut w = self.lp[k].run(self.hp[k].run(out[k] as f64)) as f32;
            if self.v.diffuse {
                for a in self.ap[k].iter_mut() {
                    w = a.run(w, 0.0);
                }
            }
            out[k] = w;
            self.fb[k] = self.shape(w * self.feedback);
        }
        // what is written back: straight round, or across to the other side
        let (wl, wr) = if self.v.cross {
            if self.kind == EchoKind::Pingpong { (x + self.fb[1], self.fb[0]) } else { (x + self.fb[1], x + self.fb[0]) }
        } else {
            (x + self.fb[0], x + self.fb[1])
        };
        self.line[0].push(wl);
        self.line[1].push(wr);
        (out[0], out[1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48000.0;
    const KINDS: [EchoKind; 6] = [EchoKind::Slap, EchoKind::Tape, EchoKind::Analog, EchoKind::Digital, EchoKind::Pingpong, EchoKind::Ambient];

    /// A click in; the left and right energy in each 10 ms afterwards.
    fn click(kind: EchoKind, time: f32, fb: f32, seconds: f32) -> (Vec<f32>, Vec<f32>) {
        let mut e = Echoes::new(SR);
        e.set(kind, time, fb);
        e.now = e.want;
        let (mut l, mut r) = (vec![], vec![]);
        let (mut al, mut ar) = (0.0, 0.0);
        for i in 0..(SR * seconds) as usize {
            // a short burst, so the band-limited kinds have something to pass on
            let x = if i < 96 { if (i / 12) % 2 == 0 { 0.5 } else { -0.5 } } else { 0.0 };
            let (a, b) = e.run(x);
            assert!(a.is_finite() && b.is_finite());
            al += a * a;
            ar += b * b;
            if (i + 1) % 480 == 0 {
                l.push(al);
                r.push(ar);
                al = 0.0;
                ar = 0.0;
            }
        }
        (l, r)
    }
    fn peak_at(e: &[f32], from: usize, to: usize) -> f32 {
        e[from..to].iter().cloned().fold(0.0, f32::max)
    }

    #[test]
    fn the_first_repeat_comes_when_it_should_and_later_ones_are_quieter() {
        for k in [EchoKind::Tape, EchoKind::Analog, EchoKind::Digital] {
            let (l, _) = click(k, 0.25, 0.5, 1.2);
            // nothing before the delay time, the first repeat at 250 ms, the second at 500 ms, quieter
            assert!(peak_at(&l, 0, 22) < 1e-6, "{k:?}: silent until the echo");
            let first = peak_at(&l, 23, 30);
            let second = peak_at(&l, 48, 56);
            assert!(first > 1e-3, "{k:?}: first repeat {first}");
            assert!(second > 1e-5 && second < first * 0.6, "{k:?}: second {second} vs first {first}");
        }
    }

    #[test]
    fn a_slap_is_one_repeat() {
        let (l, _) = click(EchoKind::Slap, 0.11, 1.0, 0.6);
        let first = peak_at(&l, 10, 14);
        let second = peak_at(&l, 21, 26);
        assert!(first > 1e-3 && second < first * 0.05, "{first} then {second}");
    }

    #[test]
    fn ping_pong_alternates_sides() {
        let (l, r) = click(EchoKind::Pingpong, 0.2, 0.6, 1.0);
        // first repeat on the left, second on the right, third on the left again
        assert!(peak_at(&l, 19, 24) > 20.0 * peak_at(&r, 19, 24));
        assert!(peak_at(&r, 39, 45) > 20.0 * peak_at(&l, 39, 45));
        assert!(peak_at(&l, 59, 66) > 20.0 * peak_at(&r, 59, 66));
    }

    #[test]
    fn analog_repeats_are_darker_than_digital_ones() {
        // how much of a bright (6 kHz) burst survives into the first repeat
        let bright = |kind: EchoKind| {
            let mut e = Echoes::new(SR);
            e.set(kind, 0.2, 0.3);
            e.now = e.want;
            let mut energy = 0.0f32;
            for i in 0..(SR * 0.4) as usize {
                let x = if i < 480 { 0.5 * (2.0 * PI * 6000.0 * i as f32 / SR).sin() } else { 0.0 };
                let (a, _) = e.run(x);
                if i > 9000 {
                    energy += a * a;
                }
            }
            energy
        };
        assert!(bright(EchoKind::Analog) < 0.1 * bright(EchoKind::Digital), "{} vs {}", bright(EchoKind::Analog), bright(EchoKind::Digital));
        assert!(bright(EchoKind::Tape) < 0.8 * bright(EchoKind::Digital));
    }

    #[test]
    fn full_feedback_never_runs_away() {
        for k in KINDS {
            let mut e = Echoes::new(SR);
            e.set(k, 0.12, 1.0);
            let mut peak = 0.0f32;
            for i in 0..(SR * 20.0) as usize {
                let x = if i < 48000 { 0.8 * (i as f32 * 0.05).sin() } else { 0.0 };
                let (a, b) = e.run(x);
                if i > 48000 * 15 {
                    peak = peak.max(a.abs()).max(b.abs());
                }
            }
            assert!(peak.is_finite() && peak < 1.0, "{k:?}: {peak}");
        }
    }

    #[test]
    fn changing_the_time_glides_without_a_click() {
        let mut e = Echoes::new(SR);
        e.set(EchoKind::Digital, 0.3, 0.3);
        let mut last = 0.0f32;
        let mut jump = 0.0f32;
        for i in 0..96000 {
            if i == 48000 {
                e.set(EchoKind::Digital, 0.15, 0.3);
            }
            let (a, _) = e.run(0.3 * (i as f32 * 0.03).sin());
            if i > 20000 {
                jump = jump.max((a - last).abs());
            }
            last = a;
        }
        // a 230 Hz tone at this level moves at most ~0.01 per sample; a click would be far bigger
        assert!(jump < 0.06, "{jump}");
    }
}

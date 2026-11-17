//! The live vocal chain, in the order engineers use:
//! preamp colour → low cut → gate → mud cut → fast (FET) compressor → de-esser →
//! smooth (opto) compressor → presence and air → doubler → echo and plate sends (ducked under
//! the voice) → output level → safety stage. Nothing looks ahead, so it adds no delay.

use crate::dsp::{db_to_gain, safety, Biquad, Compressor, DeEsser, Echo, Line, Plate, Shape, Warmth};
use serde::{Deserialize, Serialize};

/// The chain's settings, as the page sends them. Amounts are 0..1 unless noted.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct VocalFx {
    pub on: bool,
    /// preamp colour (drive)
    pub warmth: f32,
    /// low cut, Hz
    pub lowcut: f32,
    /// quiet parts between phrases turned down (0 = off)
    pub gate: f32,
    /// the boxy 250–400 Hz area turned down
    pub mud: f32,
    /// fast compression: catches peaks, adds punch
    pub punch: f32,
    /// slow, smooth compression: evens the level out
    pub smooth: f32,
    pub deess: f32,
    /// dB at 4 kHz (−6..6)
    pub presence: f32,
    /// dB, shelf from 11 kHz (−6..6)
    pub air: f32,
    pub double: f32,
    pub echo: f32,
    /// seconds
    pub echo_time: f32,
    pub echo_feedback: f32,
    pub verb: f32,
    /// 0 short … 1 long
    pub verb_size: f32,
    /// seconds
    pub verb_predelay: f32,
    /// 0 bright … 1 dark
    pub verb_tone: f32,
    /// dB
    pub level: f32,
}
impl Default for VocalFx {
    fn default() -> Self {
        VocalFx { on: true, warmth: 0.2, lowcut: 90.0, gate: 0.0, mud: 0.3, punch: 0.4, smooth: 0.4, deess: 0.4, presence: 2.0, air: 2.0, double: 0.0, echo: 0.0, echo_time: 0.11, echo_feedback: 0.15, verb: 0.25, verb_size: 0.5, verb_predelay: 0.03, verb_tone: 0.3, level: 0.0 }
    }
}

pub struct Chain {
    sr: f32,
    fx: VocalFx,
    warmth: Warmth,
    lowcut: [Biquad; 2],
    gate_env: f32,
    gate_gain: f32,
    mud: Biquad,
    fet: Compressor,
    deess: DeEsser,
    opto: Compressor,
    presence: Biquad,
    air: Biquad,
    dbl: [Line; 2],
    dbl_phase: f32,
    echo: Echo,
    plate: Plate,
    duck: f32,
}

impl Chain {
    pub fn new(sr: f32, fx: &VocalFx) -> Self {
        let mut c = Chain {
            sr,
            fx: fx.clone(),
            warmth: Warmth::new(sr),
            lowcut: [Biquad::new(Shape::HighPass, 90.0, 0.54, sr), Biquad::new(Shape::HighPass, 90.0, 1.31, sr)],
            gate_env: 0.0,
            gate_gain: 1.0,
            mud: Biquad::new(Shape::Peak(0.0), 320.0, 1.4, sr),
            fet: Compressor::new(sr, -18.0, 4.0, 6.0, 0.0004, 0.08, false, false),
            deess: DeEsser::new(sr, 6500.0),
            opto: Compressor::new(sr, -20.0, 3.0, 8.0, 0.01, 0.06, true, true),
            presence: Biquad::new(Shape::Peak(0.0), 4000.0, 0.9, sr),
            air: Biquad::new(Shape::HighShelf(0.0), 11000.0, 0.707, sr),
            dbl: [Line::new((sr * 0.04) as usize), Line::new((sr * 0.04) as usize)],
            dbl_phase: 0.0,
            echo: Echo::new(sr),
            plate: Plate::new(sr),
            duck: 0.0,
        };
        c.set(fx);
        c
    }

    /// New settings, without resetting what is ringing (no clicks while a knob moves).
    pub fn set(&mut self, fx: &VocalFx) {
        let sr = self.sr;
        self.fx = fx.clone();
        self.warmth.drive = fx.warmth.clamp(0.0, 1.0) * 0.8;
        // a 4th-order Butterworth low cut, as two biquads
        let f = fx.lowcut.clamp(20.0, 400.0);
        self.lowcut[0].set(Shape::HighPass, f, 0.54, sr);
        self.lowcut[1].set(Shape::HighPass, f, 1.31, sr);
        self.mud.set(Shape::Peak(-5.0 * fx.mud.clamp(0.0, 1.0)), 320.0, 1.4, sr);
        let p = fx.punch.clamp(0.0, 1.0);
        self.fet.threshold = -6.0 - 22.0 * p;
        self.fet.ratio = 2.0 + 4.0 * p;
        self.fet.makeup = -self.fet.curve(-14.0) * 0.6;
        self.deess.amount = fx.deess.clamp(0.0, 1.0);
        let s = fx.smooth.clamp(0.0, 1.0);
        self.opto.threshold = -8.0 - 20.0 * s;
        self.opto.ratio = 1.5 + 2.5 * s;
        self.opto.makeup = -self.opto.curve(-16.0) * 0.6;
        self.presence.set(Shape::Peak(fx.presence.clamp(-6.0, 6.0)), 4000.0, 0.9, sr);
        self.air.set(Shape::HighShelf(fx.air.clamp(-6.0, 6.0)), 11000.0, 0.707, sr);
        self.echo.time = fx.echo_time.clamp(0.02, 2.0);
        self.echo.feedback = fx.echo_feedback.clamp(0.0, 0.9);
        self.plate.decay = 0.3 + 0.62 * fx.verb_size.clamp(0.0, 1.0);
        self.plate.predelay = fx.verb_predelay.clamp(0.0, 0.2);
        self.plate.set_damping(fx.verb_tone);
    }

    /// How much the compressors are turning the voice down right now (dB, ≥ 0), for a meter.
    pub fn reduction(&self) -> f32 {
        -(self.fet.reduction() + self.opto.reduction())
    }

    /// One sample of the voice in, left and right out.
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        if !self.fx.on {
            return (x, x);
        }
        let mut v = self.warmth.run(x);
        v = self.lowcut[0].run(v);
        v = self.lowcut[1].run(v);
        // gate: an expander that only turns the quietest moments down (by up to 15 dB)
        if self.fx.gate > 0.0 {
            let a = v.abs();
            self.gate_env = if a > self.gate_env { a } else { self.gate_env * 0.9995 };
            let thr = db_to_gain(-62.0 + 26.0 * self.fx.gate);
            let want = if self.gate_env >= thr { 1.0 } else { (self.gate_env / thr).powf(1.0).max(db_to_gain(-15.0)) };
            let c = if want > self.gate_gain { 0.995 } else { 0.9998 };
            self.gate_gain = want + (self.gate_gain - want) * c;
            v *= self.gate_gain;
        }
        v = self.mud.run(v);
        if self.fx.punch > 0.0 {
            v = self.fet.run(v);
        }
        v = self.deess.run(v);
        if self.fx.smooth > 0.0 {
            v = self.opto.run(v);
        }
        v = self.air.run(self.presence.run(v));
        let mut l = v;
        let mut r = v;
        // doubler: two slightly late, gently wavering copies, one each side
        if self.fx.double > 0.0 {
            self.dbl[0].push(v);
            self.dbl[1].push(v);
            self.dbl_phase += 2.0 * std::f32::consts::PI * 0.31 / self.sr;
            if self.dbl_phase > 6.2832 {
                self.dbl_phase -= 6.2832;
            }
            let m = self.sr * 0.0012;
            let a = self.dbl[0].at(self.sr * 0.013 + m * self.dbl_phase.sin());
            let b = self.dbl[1].at(self.sr * 0.021 + m * (self.dbl_phase * 1.37).cos());
            let g = 0.45 * self.fx.double;
            l += a * g;
            r += b * g;
        }
        // the echo and the plate get quieter while the voice is singing, and bloom in the gaps
        let a = v.abs();
        self.duck = if a > self.duck { self.duck + (a - self.duck) * 0.01 } else { self.duck * 0.99995 };
        let duck = 1.0 - 0.45 * (self.duck * 4.0).min(1.0);
        if self.fx.echo > 0.0 {
            let (el, er) = self.echo.run(v * self.fx.echo);
            l += el * duck;
            r += er * duck;
        }
        if self.fx.verb > 0.0 {
            let (pl, pr) = self.plate.run(v * self.fx.verb * 0.7);
            l += pl * duck;
            r += pr * duck;
        }
        let g = db_to_gain(self.fx.level.clamp(-24.0, 12.0));
        (safety(l * g), safety(r * g))
    }

    /// A whole take through the chain at once (for the version that plays back with the song).
    pub fn render(&mut self, dry: &[f32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(dry.len() * 2);
        for &x in dry {
            let (l, r) = self.run(x);
            out.push(l);
            out.push(r);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    fn voice(n: usize) -> Vec<f32> {
        // a sung vowel: a few harmonics of 220 Hz, coming and going
        (0..n)
            .map(|i| {
                let t = i as f32 / SR;
                let env = (0.5 + 0.5 * (t * 1.3).sin()).powi(2);
                env * 0.4 * ((2.0 * std::f32::consts::PI * 220.0 * t).sin() + 0.5 * (2.0 * std::f32::consts::PI * 440.0 * t).sin() + 0.25 * (2.0 * std::f32::consts::PI * 660.0 * t).sin())
            })
            .collect()
    }

    #[test]
    fn the_default_chain_is_stable_and_never_clips() {
        let mut c = Chain::new(SR, &VocalFx::default());
        let out = c.render(&voice(SR as usize * 3));
        assert!(out.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        assert!(out.iter().map(|v| v.abs()).fold(0.0, f32::max) > 0.05, "the voice comes through");
    }

    #[test]
    fn every_knob_at_its_extremes_stays_stable() {
        let all = VocalFx { warmth: 1.0, gate: 1.0, mud: 1.0, punch: 1.0, smooth: 1.0, deess: 1.0, presence: 6.0, air: 6.0, double: 1.0, echo: 1.0, echo_feedback: 0.9, verb: 1.0, verb_size: 1.0, level: 12.0, ..VocalFx::default() };
        let mut c = Chain::new(SR, &all);
        let mut x = voice(SR as usize * 2);
        x.extend(std::iter::repeat(0.0).take(SR as usize * 4));
        let out = c.render(&x);
        assert!(out.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        // the echo and plate tails die away rather than growing
        let tail = &out[out.len() - 9600..];
        assert!(tail.iter().map(|v| v.abs()).fold(0.0, f32::max) < 0.5);
    }

    #[test]
    fn off_means_untouched() {
        let mut c = Chain::new(SR, &VocalFx { on: false, ..VocalFx::default() });
        assert_eq!(c.run(0.25), (0.25, 0.25));
    }

    #[test]
    fn the_reverb_is_heard_after_the_voice_stops() {
        let mut c = Chain::new(SR, &VocalFx { verb: 0.8, verb_size: 0.8, ..VocalFx::default() });
        let mut x = voice(SR as usize);
        x.extend(std::iter::repeat(0.0).take(SR as usize));
        let out = c.render(&x);
        let after: f32 = out[(SR as usize + 4800) * 2..(SR as usize + 14400) * 2].iter().map(|v| v * v).sum();
        assert!(after > 1e-4, "a tail after the last note ({after})");
    }

    #[test]
    fn settings_arrive_with_defaults_for_anything_missing() {
        let fx: VocalFx = serde_json::from_str(r#"{"verb":0.6,"presence":3}"#).unwrap();
        assert_eq!(fx.verb, 0.6);
        assert_eq!(fx.presence, 3.0);
        assert_eq!(fx.lowcut, 90.0);
    }
}

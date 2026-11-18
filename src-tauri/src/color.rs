//! Preamp colour: five characters for the front of the vocal chain. Each is a short chain of
//! filter, curve and a little memory, ported from open-source code whose sound is well known,
//! and (except Clean) run at twice the sample rate so the harmonics they add never fold back.
//!
//! - **Clean**: Airwindows PurestDrive (MIT). A sine curve blended in only as far as the last
//!   two samples agree, so it backs off on bright and quiet material: glue you barely hear.
//! - **Tube**: the asymmetric "flatten the bottom, point the top" stage of Airwindows Tube2
//!   followed by the Tube polynomial (MIT). The asymmetry is what makes second harmonics,
//!   the warmth of a valve stage, and they rise with level.
//! - **Console**: Airwindows Channel9 in its Neve voicing (MIT): a low cut that moves with the
//!   signal (as a coupling capacitor's does), the Spiral and Density curves, and a slew clamp
//!   that rounds the hardest edges, as an output transformer does to sibilance.
//! - **Tape**: the core of Airwindows ToTape6 (MIT): the highs are split off and compress
//!   themselves, a small low bump, and the Mojo curve, which lifts quiet detail and holds
//!   peaks.
//! - **Drive**: the exciter of Surge XT / chowdsp (GPL-3.0-or-later), the Aphex layout: only
//!   what is above 3 kHz is distorted, by an amount that follows its own level, and added
//!   to the untouched voice.
//!
//! The amount knob pushes the voice further into the curve and takes the same level off after,
//! so turning it changes the colour, not the volume.

use crate::eqm::Bq;
use crate::os::Half2x;
use serde::{Deserialize, Serialize};
use std::f64::consts::{FRAC_PI_2, PI};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ColorKind {
    Clean,
    Console,
    Tape,
    Drive,
    /// (also what an unknown name becomes)
    #[default]
    #[serde(other)]
    Tube,
}

/// Spiral (Airwindows): sin(x·|x|)/|x|. Straight for small signals, a smooth ceiling for big ones.
#[inline]
fn spiral(x: f64) -> f64 {
    let a = x.abs();
    if a < 1e-9 { x } else { (x * a).sin() / a }
}
/// Mojo (Airwindows): lifts the quiet (by up to 3.9 dB) and leaves full scale where it is.
#[inline]
fn mojo(x: f64) -> f64 {
    let m = x.abs().powf(0.25);
    if m < 1e-6 { x * FRAC_PI_2 } else { (x * m * FRAC_PI_2).sin() / m }
}
/// Tube2's first stage then the Tube curve, for a whole "power factor" `pf` (higher = cleaner).
#[inline]
fn tube(x: f64, pf: i32) -> f64 {
    let mut v = x.clamp(-1.0, 1.0);
    // asymmetric: the bottom half flattens, the top half sharpens (even harmonics)
    let pad = pf as f64;
    let a = v / pad;
    let sh = -a;
    let sh = if sh > 0.0 { 1.0 + sh.sqrt() } else { 1.0 - (-sh).sqrt() };
    v = (a - a * a.abs() * sh * 0.25) * pad;
    // the Tube curve, kept odd
    let mut factor = v.powi(pf + 1);
    if pf % 2 == 1 {
        factor = if v == 0.0 { 0.0 } else { factor / v * v.abs() };
    }
    (v - factor / (pad + 1.0)) * (1.0 + 1.0 / pad)
}

#[derive(Clone, Debug)]
pub struct Color {
    kind: ColorKind,
    amount: f64,
    sr: f64,
    os: Half2x,
    /// input drive and the gain that puts the level back
    gain: f64,
    comp: f64,
    // clean
    prev: f64,
    // tube
    pf: i32,
    // console
    pre: Bq,
    post: Bq,
    iir: f64,
    li: f64,
    density: f64,
    phat: f64,
    last: [f64; 3],
    thr: f64,
    // tape
    bump: Bq,
    mid: f64,
    roll: f64,
    // drive
    hp: Bq,
    z: f64,
    att: f64,
    rel: f64,
    drive: f64,
    // a slow high-pass after every curve: no standing offset from the asymmetric ones
    dc_x: f64,
    dc_y: f64,
    dc_r: f64,
}

impl Color {
    pub fn new(sr: f32) -> Self {
        let sr = sr as f64;
        let mut c = Color {
            kind: ColorKind::Tube, amount: 0.0, sr, os: Half2x::default(), gain: 1.0, comp: 1.0, prev: 0.0, pf: 5,
            pre: Bq::default(), post: Bq::default(), iir: 0.0, li: 0.0, density: 0.0, phat: 0.0, last: [0.0; 3], thr: 0.1668,
            bump: Bq::default(), mid: 0.0, roll: 0.4, hp: Bq::default(), z: 0.0, att: 0.0, rel: 0.0, drive: 0.0,
            dc_x: 0.0, dc_y: 0.0, dc_r: 1.0 - 2.0 * PI * 8.0 / sr,
        };
        c.set(ColorKind::Tube, 0.0);
        c
    }

    /// The curve alone (no filters, no memory), used to work out the level to put back.
    fn curve(&self, x: f64) -> f64 {
        match self.kind {
            ColorKind::Clean => x,
            ColorKind::Tube => tube(x, self.pf),
            ColorKind::Console => {
                let v = x.clamp(-1.0, 1.0);
                let d = spiral(v * 1.2533141373155);
                let y = if self.density < 1.0 { v * (1.0 - self.density) + d * self.density } else { d };
                if self.phat > 0.0 { y * (1.0 - self.phat) + (v * FRAC_PI_2).sin() * self.phat } else { y }
            }
            ColorKind::Tape => mojo(x.clamp(-1.0, 1.0)),
            ColorKind::Drive => x,
        }
    }

    pub fn set(&mut self, kind: ColorKind, amount: f32) {
        let a = (amount as f64).clamp(0.0, 1.0);
        self.kind = kind;
        self.amount = a;
        let fsw = 2.0 * self.sr;
        match kind {
            ColorKind::Clean => self.gain = 1.0,
            ColorKind::Tube => {
                // up to +9 dB into the stage; from clean (5) to rich in second harmonic (2)
                self.gain = 10f64.powf(9.0 * a / 20.0);
                self.pf = (5.0 - 3.0 * a).round() as i32;
            }
            ColorKind::Console => {
                self.gain = 10f64.powf(7.0 * a / 20.0);
                let d = 2.0 * (0.25 + 0.75 * a);
                self.phat = (d - 1.0).max(0.0);
                self.density = d.min(1.0);
                // Neve voicing: ultrasonic low-passes at 28.8 kHz (the first a touch resonant)
                if 28811.0 < 0.45 * fsw {
                    self.pre.lowpass(28811.0, 1.618033988749894, fsw);
                    self.post.lowpass(28811.0, 0.618033988749894, fsw);
                } else {
                    self.pre.flat();
                    self.post.flat();
                }
                // its "dielectric" low cut: 0.005832 per sample on alternate samples at 44.1 kHz
                self.li = 0.005832 * 22050.0 / fsw;
                // its slew threshold is per sample at 44.1/48 kHz: half that at twice the rate
                self.thr = 0.33362176 * (48000.0 / fsw);
            }
            ColorKind::Tape => {
                self.gain = 10f64.powf(9.0 * a / 20.0);
                self.roll = (0.8875 / (fsw / 44100.0)).min(1.0);
                self.bump.bell(85.0, 0.8, 1.5 * a, self.sr);
            }
            ColorKind::Drive => {
                self.gain = 1.0;
                let tone: f64 = 0.6;
                self.hp.highpass(500.0 * 20f64.powf(tone), 0.7071, fsw);
                self.drive = 8.0 * a.powf(1.5) * 0.2f64.powf(1.0 - tone);
                self.att = (-2.0 * PI * 1000.0 / (fsw * 10.0)).exp();
                self.rel = (-2.0 * PI * 1000.0 / (fsw * 100.0)).exp();
            }
        }
        // the level a voice sits at comes out as it went in
        let r = 0.2;
        let out = 0.5 * (self.curve(r * self.gain).abs() + self.curve(-r * self.gain).abs());
        self.comp = if out > 1e-9 { r / out } else { 1.0 };
    }

    #[inline]
    fn core(&mut self, x: f64) -> f64 {
        match self.kind {
            ColorKind::Clean => x,
            ColorKind::Tube => tube(x, self.pf),
            ColorKind::Console => {
                let mut x = self.pre.run(x);
                let scale = (1.0 - x / (5.0 - self.density)).abs();
                self.iir = self.iir * (1.0 - self.li * scale) + x * self.li * scale;
                x -= self.iir;
                let dry = x;
                let v = x.clamp(-1.0, 1.0);
                let phat = (v * FRAC_PI_2).sin();
                let dist = spiral(v * 1.2533141373155);
                x = if self.density < 1.0 { dry * (1.0 - self.density) + dist * self.density } else { dist };
                if self.phat > 0.0 {
                    x = x * (1.0 - self.phat) + phat * self.phat;
                }
                // the golden-ratio slew clamp
                let [la, lb, lc] = self.last;
                let clamp = (lb - lc) * 0.381966011250105 - (la - lb) * 0.6180339887498948 + (x - la);
                self.last = [x, la, lb];
                if clamp > self.thr {
                    x = self.last[1] + self.thr;
                }
                if -clamp > self.thr {
                    x = self.last[1] - self.thr;
                }
                self.last[0] = self.last[0] * 0.381966011250105 + x * 0.6180339887498948;
                self.post.run(x)
            }
            ColorKind::Tape => {
                // the highs, split off, soften themselves
                self.mid = self.mid * (1.0 - self.roll) + x * self.roll;
                let highs = x - self.mid;
                let soften = 1.0 - (highs.abs() * FRAC_PI_2).min(FRAC_PI_2).cos();
                let x = x - highs.signum() * soften;
                mojo(x.clamp(-1.0, 1.0))
            }
            ColorKind::Drive => {
                let d = self.hp.run(x * self.drive);
                // a diode rectifier follows the level of the highs
                let r = 5.0 * ((1.9305 * d.clamp(-2.0, 2.0)).exp() - 1.0);
                let tau = if r > self.z { self.att } else { self.rel };
                self.z = (r + tau * (self.z - r)).clamp(0.0, 4.0);
                x + d.tanh() * self.z * 0.35 * self.amount
            }
        }
    }

    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        if self.amount <= 0.0 {
            return x;
        }
        let x = x as f64;
        if self.kind == ColorKind::Clean {
            let s = x.sin();
            let apply = (self.prev + s).abs() * 0.5 * self.amount;
            self.prev = s;
            return (x * (1.0 - apply) + s * apply) as f32;
        }
        let x = if self.kind == ColorKind::Tape { self.bump.run(x) } else { x };
        let (a, b) = self.os.up(x * self.gain);
        let a = self.core(a);
        let b = self.core(b);
        let y = self.os.down(a, b) * self.comp;
        // DC blocker (8 Hz)
        let out = y - self.dc_x + self.dc_r * self.dc_y;
        self.dc_x = y;
        self.dc_y = if out.abs() < 1e-30 { 0.0 } else { out };
        out as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    const KINDS: [ColorKind; 5] = [ColorKind::Clean, ColorKind::Tube, ColorKind::Console, ColorKind::Tape, ColorKind::Drive];
    /// A 1 kHz voice-level tone through a colour: (level change, 2nd harmonic, 3rd harmonic), dB re the tone.
    fn harmonics(kind: ColorKind, amount: f32, amp: f64) -> (f64, f64, f64) {
        let mut c = Color::new(48000.0);
        c.set(kind, amount);
        let out = sine_out(48000.0, 1000.0, amp, 48000, |x| c.run(x));
        let f = level_at(48000.0, 1000.0, &out);
        (db(f / amp), db(level_at(48000.0, 2000.0, &out) / f), db(level_at(48000.0, 3000.0, &out) / f))
    }

    #[test]
    fn turning_a_colour_up_changes_the_tone_not_the_volume() {
        for k in KINDS {
            for amount in [0.2, 0.5, 1.0] {
                let (lvl, _, _) = harmonics(k, amount, 0.2);
                assert!(lvl.abs() < 1.5, "{k:?} at {amount}: level moves {lvl:.2} dB");
            }
        }
    }

    #[test]
    fn each_colour_has_its_own_harmonics() {
        // tube: the second harmonic is there and leads the third at moderate drive (valve warmth)
        let (_, h2, h3) = harmonics(ColorKind::Tube, 0.5, 0.2);
        assert!(h2 > -60.0 && h2 < -20.0, "tube h2 {h2}");
        assert!(h2 > h3 - 6.0, "tube h2 {h2} vs h3 {h3}");
        // it grows with level, as a real stage does
        let (_, quiet, _) = harmonics(ColorKind::Tube, 0.5, 0.05);
        assert!(h2 > quiet + 3.0, "{h2} vs {quiet}");
        // console and tape are symmetric curves: third harmonic, almost no second
        for k in [ColorKind::Console, ColorKind::Tape] {
            let (_, h2, h3) = harmonics(k, 0.7, 0.2);
            assert!(h3 > -70.0 && h3 < -18.0, "{k:?} h3 {h3}");
            // (the console's low cut moves with the signal, which adds a trace of second harmonic)
            assert!(h2 < h3 - 8.0, "{k:?} h2 {h2} h3 {h3}");
        }
        // clean stays clean
        let (_, h2, h3) = harmonics(ColorKind::Clean, 1.0, 0.2);
        assert!(h2 < -70.0 && h3 < -40.0, "clean {h2} {h3}");
        // the exciter leaves a 1 kHz tone alone (it only works above 3 kHz) …
        let (_, _, h3) = harmonics(ColorKind::Drive, 1.0, 0.2);
        assert!(h3 < -30.0, "drive on 1 kHz: {h3}");
        // … and adds harmonics to a 5 kHz one
        let mut c = Color::new(48000.0);
        c.set(ColorKind::Drive, 1.0);
        let out = sine_out(48000.0, 5000.0, 0.1, 48000, |x| c.run(x));
        let f = level_at(48000.0, 5000.0, &out);
        let h = db(level_at(48000.0, 10000.0, &out).max(level_at(48000.0, 15000.0, &out)) / f);
        assert!(h > -56.0, "drive on 5 kHz: harmonics {h}");
        // and it lifts the highs themselves, more the louder they are (the exciter's sparkle)
        assert!(db(f / 0.1) > 1.0, "drive on 5 kHz: level {}", db(f / 0.1));
    }

    #[test]
    fn nothing_folds_back_into_the_voice() {
        // a loud 5 kHz tone, driven hard: its harmonics above 24 kHz must not come back down.
        // The 5th harmonic (25 kHz) would land on 23 kHz, the 7th (35 kHz) on 13 kHz.
        for k in [ColorKind::Tube, ColorKind::Console, ColorKind::Tape] {
            let mut c = Color::new(48000.0);
            c.set(k, 1.0);
            let out = sine_out(48000.0, 5000.0, 0.25, 48000, |x| c.run(x));
            let f = level_at(48000.0, 5000.0, &out);
            let alias = db(level_at(48000.0, 13000.0, &out) / f);
            // the console's slew clamp is a hard edge: a little more gets through, still far below hearing under a voice
            let limit = if k == ColorKind::Console { -60.0 } else { -70.0 };
            assert!(alias < limit, "{k:?}: {alias} dB at 13 kHz");
        }
    }

    #[test]
    fn silence_in_silence_out_and_no_standing_offset() {
        for k in KINDS {
            let mut c = Color::new(48000.0);
            c.set(k, 1.0);
            let out = sine_out(48000.0, 220.0, 0.3, 48000, |x| c.run(x));
            let mean = out.iter().sum::<f64>() / out.len() as f64;
            assert!(mean.abs() < 2e-3, "{k:?}: offset {mean}");
            let mut last = 1.0f32;
            for _ in 0..48000 {
                last = c.run(0.0);
            }
            assert!(last.abs() < 1e-6 && last.is_finite(), "{k:?}: {last}");
        }
    }

    #[test]
    fn an_unknown_colour_name_falls_back_to_tube() {
        let k: ColorKind = serde_json::from_str("\"valve-9000\"").unwrap();
        assert_eq!(k, ColorKind::Tube);
        assert_eq!(serde_json::from_str::<ColorKind>("\"tape\"").unwrap(), ColorKind::Tape);
    }
}

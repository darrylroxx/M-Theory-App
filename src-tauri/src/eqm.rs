//! Filters for the vocal EQ, with double-precision state (a 30 Hz low cut at 96 kHz is noisy in
//! single precision) and curves that match their analog shape right up to the top of hearing.
//!
//! An ordinary digital bell or shelf is squeezed against half the sample rate: at 48 kHz a
//! +6 dB bell at 8 kHz is about 1 dB too narrow on its upper side, and an "air" shelf rises too
//! early. Two designs fix that with no added delay:
//! - bells above 1 kHz use the design of Martin Vicanek's paper "Matched Second Order Digital
//!   Filters" (2016): the poles sit exactly where the analog filter's would, and the zeros are
//!   solved so the response also agrees at three frequencies (written here from the formulas);
//! - the air band is a first-order high-pass mixed in parallel with the voice, its pole placed
//!   by the matched-Z rule, which stays valid when the corner is above half the sample rate
//!   (the construction of lkjb's Luftikus, MIT, after the Maag "air band").

use std::f64::consts::PI;

/// A second-order section (transposed direct form II), f64 inside.
#[derive(Clone, Copy, Debug)]
pub struct Bq {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}
impl Default for Bq {
    fn default() -> Self {
        Bq { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 }
    }
}
impl Bq {
    #[inline]
    pub fn run(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        // keep the state out of the denormal range
        if self.z1.abs() < 1e-30 {
            self.z1 = 0.0;
        }
        if self.z2.abs() < 1e-30 {
            self.z2 = 0.0;
        }
        y
    }
    fn set(&mut self, b: [f64; 3], a: [f64; 3]) {
        self.b0 = b[0] / a[0];
        self.b1 = b[1] / a[0];
        self.b2 = b[2] / a[0];
        self.a1 = a[1] / a[0];
        self.a2 = a[2] / a[0];
    }
    pub fn is_flat(&self) -> bool {
        self.b0 == 1.0 && self.b1 == 0.0 && self.b2 == 0.0 && self.a1 == 0.0 && self.a2 == 0.0
    }
    pub fn flat(&mut self) {
        self.set([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
    }
    /// High-pass (12 dB per octave).
    pub fn highpass(&mut self, fc: f64, q: f64, sr: f64) {
        let w = 2.0 * PI * (fc / sr).min(0.49);
        let (c, al) = (w.cos(), w.sin() / (2.0 * q));
        self.set([(1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0], [1.0 + al, -2.0 * c, 1.0 - al]);
    }
    /// Low-pass (12 dB per octave).
    pub fn lowpass(&mut self, fc: f64, q: f64, sr: f64) {
        let w = 2.0 * PI * (fc / sr).min(0.49);
        let (c, al) = (w.cos(), w.sin() / (2.0 * q));
        self.set([(1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0], [1.0 + al, -2.0 * c, 1.0 - al]);
    }
    /// Low shelf (the cookbook's; below 1 kHz it is indistinguishable from the analog curve).
    pub fn lowshelf(&mut self, fc: f64, db: f64, sr: f64) {
        let a = 10f64.powf(db / 40.0);
        let w = 2.0 * PI * (fc / sr).min(0.49);
        let (c, al) = (w.cos(), w.sin() / (2.0 * 0.7071));
        let s = 2.0 * a.sqrt() * al;
        self.set(
            [a * ((a + 1.0) - (a - 1.0) * c + s), 2.0 * a * ((a - 1.0) - (a + 1.0) * c), a * ((a + 1.0) - (a - 1.0) * c - s)],
            [(a + 1.0) + (a - 1.0) * c + s, -2.0 * ((a - 1.0) + (a + 1.0) * c), (a + 1.0) + (a - 1.0) * c - s],
        );
    }
    /// A bell: `db` at `fc`, as wide as `fc / q` at half its gain. Analog-matched above 1 kHz.
    pub fn bell(&mut self, fc: f64, q: f64, db: f64, sr: f64) {
        if db.abs() < 0.01 {
            return self.flat();
        }
        let fc = fc.min(0.45 * sr);
        if fc < 1000.0 {
            let a = 10f64.powf(db / 40.0);
            let w = 2.0 * PI * fc / sr;
            let (c, al) = (w.cos(), w.sin() / (2.0 * q));
            return self.set([1.0 + al * a, -2.0 * c, 1.0 - al * a], [1.0 + al / a, -2.0 * c, 1.0 - al / a]);
        }
        // Vicanek: design the boost (pole Q = q·A, gain G = A²), and turn it upside down for a cut
        let a = 10f64.powf(db.abs() / 40.0);
        let (g, qp) = (a * a, q * a);
        let w0 = 2.0 * PI * fc / sr;
        let d = 1.0 / (2.0 * qp);
        let e = (-d * w0).exp();
        let a1 = if d <= 1.0 { -2.0 * e * ((1.0 - d * d).sqrt() * w0).cos() } else { -2.0 * e * ((d * d - 1.0).sqrt() * w0).cosh() };
        let a2 = e * e;
        let p1 = (w0 / 2.0).sin().powi(2);
        let p0 = 1.0 - p1;
        let p2 = 4.0 * p0 * p1;
        let (aa0, aa1, aa2) = ((1.0 + a1 + a2).powi(2), (1.0 - a1 + a2).powi(2), -4.0 * a2);
        let r1 = (aa0 * p0 + aa1 * p1 + aa2 * p2) * g * g;
        let r2 = (-aa0 + aa1 + 4.0 * (p0 - p1) * aa2) * g * g;
        let bb0 = aa0;
        let bb2 = (r1 - r2 * p1 - bb0) / (4.0 * p1 * p1);
        let bb1 = r2 + bb0 + 4.0 * (p1 - p0) * bb2;
        let w = 0.5 * (bb0.sqrt() + bb1.max(0.0).sqrt());
        let b0 = 0.5 * (w + (w * w + bb2).max(0.0).sqrt());
        let b1 = 0.5 * (bb0.sqrt() - bb1.max(0.0).sqrt());
        let b2 = -bb2 / (4.0 * b0);
        if db > 0.0 {
            self.set([b0, b1, b2], [1.0, a1, a2]);
        } else {
            self.set([1.0, a1, a2], [b0, b1, b2]);
        }
    }
}

/// The air band: everything above the corner lifted (or lowered) by a gentle 6 dB-per-octave
/// shelf, `H(s) = (G·s + wc)/(s + wc)`. With the corner at 20 kHz or beyond, only its lower
/// slope reaches into hearing: the "air" that brightens without harshness. The digital section
/// is solved to have exactly the analog gain at 0 Hz, at a quarter and at half the sample rate,
/// so it is right even when the corner lies above half the sample rate.
#[derive(Clone, Copy, Debug)]
pub struct Air {
    b0: f64,
    b1: f64,
    a1: f64,
    x1: f64,
    y1: f64,
}
impl Default for Air {
    fn default() -> Self {
        Air { b0: 1.0, b1: 0.0, a1: 0.0, x1: 0.0, y1: 0.0 }
    }
}
impl Air {
    pub fn set(&mut self, fc: f64, db: f64, sr: f64) {
        let g = 10f64.powf(db / 20.0);
        if (g - 1.0).abs() < 1e-3 {
            (self.b0, self.b1, self.a1) = (1.0, 0.0, 0.0);
            return;
        }
        let analog = |f: f64| ((g * g * f * f + fc * fc) / (f * f + fc * fc)).sqrt();
        let (gn, gm) = (analog(sr / 2.0), analog(sr / 4.0));
        let a = (1.0 + gn * gn) / 2.0 - gm * gm;
        let b = 1.0 - gn * gn;
        let a1 = if a.abs() < 1e-12 {
            0.0
        } else {
            let root = (b * b - 4.0 * a * a).max(0.0).sqrt();
            let r = (-b + root) / (2.0 * a);
            if r.abs() < 1.0 { r } else { (-b - root) / (2.0 * a) }
        };
        let (sum, diff) = (1.0 + a1, gn * (1.0 - a1));
        (self.b0, self.b1, self.a1) = ((sum + diff) / 2.0, (sum - diff) / 2.0, a1);
    }
    #[inline]
    pub fn run(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 - self.a1 * self.y1;
        self.x1 = x;
        self.y1 = if y.abs() < 1e-30 { 0.0 } else { y };
        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    /// The analog bell's gain at f (dB): H(s) = (s² + s·A/Q + 1)/(s² + s/(A·Q) + 1).
    fn analog_bell(f: f64, fc: f64, q: f64, db: f64) -> f64 {
        let a = 10f64.powf(db / 40.0);
        let w = f / fc;
        let num = (1.0 - w * w).powi(2) + (w * a / q).powi(2);
        let den = (1.0 - w * w).powi(2) + (w / (a * q)).powi(2);
        10.0 * (num / den).log10()
    }

    #[test]
    fn a_high_bell_keeps_its_analog_shape_to_the_top_of_hearing() {
        let sr = 48000.0;
        for db in [6.0, -6.0] {
            let mut b = Bq::default();
            b.bell(8000.0, 1.0, db, sr);
            for f in [2000.0, 4000.0, 8000.0, 12000.0, 16000.0, 19200.0] {
                let mut bb = b;
                let g = gain_db(sr, f, |x| bb.run(x as f64) as f32);
                let want = analog_bell(sr / (sr / f).round(), 8000.0, 1.0, db);
                assert!((g - want).abs() < 0.3, "{db} dB bell at {f} Hz: {g:.2} dB, analog {want:.2} dB");
            }
        }
        // the ordinary design is a full decibel out at 16 kHz: that is what this avoids
        let a = 10f64.powf(6.0 / 40.0);
        let w = 2.0 * PI * 8000.0 / sr;
        let (c, al) = (w.cos(), w.sin() / 2.0);
        let mut rbj = Bq::default();
        rbj.set([1.0 + al * a, -2.0 * c, 1.0 - al * a], [1.0 + al / a, -2.0 * c, 1.0 - al / a]);
        let g = gain_db(sr, 16000.0, |x| rbj.run(x as f64) as f32);
        assert!((g - analog_bell(16000.0, 8000.0, 1.0, 6.0)).abs() > 0.9);
    }

    #[test]
    fn low_bells_shelves_and_cuts_do_what_they_say() {
        let sr = 48000.0;
        let mut b = Bq::default();
        b.bell(320.0, 1.4, -4.0, sr);
        assert!((gain_db(sr, 320.0, |x| b.run(x as f64) as f32) + 4.0).abs() < 0.1);
        let mut s = Bq::default();
        s.lowshelf(120.0, 3.0, sr);
        assert!((gain_db(sr, 30.0, |x| s.run(x as f64) as f32) - 3.0).abs() < 0.3);
        assert!(gain_db(sr, 2000.0, |x| s.run(x as f64) as f32).abs() < 0.1);
        let mut h = Bq::default();
        h.highpass(90.0, 0.7071, sr);
        assert!((gain_db(sr, 90.0, |x| h.run(x as f64) as f32) + 3.0).abs() < 0.2);
        assert!(gain_db(sr, 1000.0, |x| h.run(x as f64) as f32).abs() < 0.05);
        // a 30 Hz low cut at 96 kHz stays clean (double precision inside)
        let mut h = Bq::default();
        h.highpass(30.0, 0.7071, 96000.0);
        assert!(gain_db(96000.0, 1000.0, |x| h.run(x as f64) as f32).abs() < 0.01);
    }

    #[test]
    fn the_air_band_follows_the_analog_shelf_even_from_beyond_hearing() {
        let sr = 48000.0;
        let analog = |f: f64, fc: f64, db: f64| {
            let g = 10f64.powf(db / 20.0);
            10.0 * ((g * g * f * f + fc * fc) / (f * f + fc * fc)).log10()
        };
        for (fc, db) in [(10000.0, 6.0), (20000.0, 6.0), (40000.0, 12.0), (12000.0, -4.0)] {
            let mut a = Air::default();
            a.set(fc, db, sr);
            for f in [1000.0, 4000.0, 8000.0, 12000.0, 16000.0, 19200.0] {
                let mut aa = a;
                let got = gain_db(sr, f, |x| aa.run(x as f64) as f32);
                let want = analog(sr / (sr / f).round(), fc, db);
                assert!((got - want).abs() < 0.35, "air {fc} Hz {db} dB at {f} Hz: {got:.2}, analog {want:.2}");
            }
        }
    }
}

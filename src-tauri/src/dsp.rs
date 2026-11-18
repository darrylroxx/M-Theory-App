//! The building blocks of the live vocal chain. Everything here is causal and has no
//! look-ahead, so the chain adds no delay to what the singer hears.
//! (See reports/Scarlet Solo and vocal chain DSP.md for where each design comes from.)

use std::f32::consts::PI;

#[inline]
pub fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}
#[inline]
pub fn gain_to_db(g: f32) -> f32 {
    20.0 * g.max(1e-9).log10()
}
/// Keep tiny numbers from turning into denormals (slow on x86) in feedback loops.
#[inline]
fn flush(x: f32) -> f32 {
    if x.abs() < 1e-20 { 0.0 } else { x }
}

/// A second-order filter (RBJ cookbook), transposed direct form II.
#[derive(Clone, Copy, Debug, Default)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

#[allow(dead_code)]
pub enum Shape {
    LowPass,
    HighPass,
    BandPass,
    Peak(f32),
    HighShelf(f32),
    LowShelf(f32),
}

impl Biquad {
    pub fn new(shape: Shape, freq: f32, q: f32, sr: f32) -> Self {
        let mut b = Biquad::default();
        b.set(shape, freq, q, sr);
        b
    }
    pub fn set(&mut self, shape: Shape, freq: f32, q: f32, sr: f32) {
        let f = freq.clamp(10.0, sr * 0.49);
        let w = 2.0 * PI * f / sr;
        let (s, c) = (w.sin(), w.cos());
        let alpha = s / (2.0 * q.max(0.05));
        let (b0, b1, b2, a0, a1, a2) = match shape {
            Shape::LowPass => ((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            Shape::HighPass => ((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            Shape::BandPass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            Shape::Peak(db) => {
                let a = 10f32.powf(db / 40.0);
                (1.0 + alpha * a, -2.0 * c, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * c, 1.0 - alpha / a)
            }
            Shape::HighShelf(db) | Shape::LowShelf(db) => {
                let a = 10f32.powf(db / 40.0);
                let sq = 2.0 * a.sqrt() * alpha;
                if matches!(shape, Shape::HighShelf(_)) {
                    (a * ((a + 1.0) + (a - 1.0) * c + sq), -2.0 * a * ((a - 1.0) + (a + 1.0) * c), a * ((a + 1.0) + (a - 1.0) * c - sq), (a + 1.0) - (a - 1.0) * c + sq, 2.0 * ((a - 1.0) - (a + 1.0) * c), (a + 1.0) - (a - 1.0) * c - sq)
                } else {
                    (a * ((a + 1.0) - (a - 1.0) * c + sq), 2.0 * a * ((a - 1.0) - (a + 1.0) * c), a * ((a + 1.0) - (a - 1.0) * c - sq), (a + 1.0) + (a - 1.0) * c + sq, -2.0 * ((a - 1.0) + (a + 1.0) * c), (a + 1.0) + (a - 1.0) * c - sq)
                }
            }
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }
    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = flush(self.b1 * x - self.a1 * y + self.z2);
        self.z2 = flush(self.b2 * x - self.a2 * y);
        y
    }
}

/// A one-pole low-pass, for smoothing and for damping inside the reverb.
#[derive(Clone, Copy, Debug, Default)]
pub struct OnePole {
    a: f32,
    z: f32,
}
impl OnePole {
    /// `amount` 0 = no filtering, close to 1 = very dark
    pub fn with(amount: f32) -> Self {
        OnePole { a: amount.clamp(0.0, 0.9999), z: 0.0 }
    }
    pub fn hz(freq: f32, sr: f32) -> Self {
        OnePole::with((-2.0 * PI * freq / sr).exp())
    }
    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        self.z = flush(x * (1.0 - self.a) + self.z * self.a);
        self.z
    }
}

/// Time constant (seconds) as a per-sample smoothing coefficient.
#[inline]
pub fn coef(seconds: f32, sr: f32) -> f32 {
    if seconds <= 0.0 { 0.0 } else { (-1.0 / (seconds * sr)).exp() }
}

/// A compressor in the log domain (soft knee, smoothed gain), in two characters:
/// - `feedback` (the FET kind, as in an 1176): the level is read from the compressor's own
///   output, so the harder it works the less it sees. That is why such a unit grabs peaks
///   fast yet never sounds clamped.
/// - `opto` (as in an LA-2A): the gain element is a light and a photo-cell. Its speed depends
///   on how hard it is working (deep reduction recovers fast at first, the last few decibels
///   slowly), the law of the optical stage in mzuther's Squeezer (GPL-3.0-or-later).
#[derive(Clone, Debug)]
pub struct Compressor {
    pub threshold: f32,
    pub ratio: f32,
    pub knee: f32,
    pub makeup: f32,
    att: f32,
    rel: f32,
    rel_slow: f32,
    rms: bool,
    power: f32,
    power_c: f32,
    gr: f32,
    slow: f32,
    opto: bool,
    /// the photo-cell's memory: the last part of the release, which takes seconds
    tail: f32,
    pub feedback: bool,
    last: f32,
    sr: f32,
}
impl Compressor {
    pub fn new(sr: f32, threshold: f32, ratio: f32, knee: f32, attack: f32, release: f32, rms: bool, opto: bool) -> Self {
        Compressor {
            threshold,
            ratio,
            knee,
            makeup: 0.0,
            att: coef(attack, sr),
            rel: coef(release, sr),
            rel_slow: if opto { coef(1.5, sr) } else { coef(release, sr) },
            rms,
            power: 0.0,
            power_c: coef(0.01, sr),
            gr: 0.0,
            slow: 0.0,
            opto,
            tail: 0.0,
            feedback: false,
            last: 0.0,
            sr,
        }
    }
    /// How much the level is turned down for a given input level (dB, ≤ 0).
    pub fn curve(&self, level: f32) -> f32 {
        self.curve_with(level, 1.0 / self.ratio - 1.0)
    }
    fn curve_with(&self, level: f32, slope: f32) -> f32 {
        let over = level - self.threshold;
        if 2.0 * over < -self.knee {
            0.0
        } else if 2.0 * over.abs() <= self.knee && self.knee > 0.0 {
            slope * (over + self.knee / 2.0).powi(2) / (2.0 * self.knee)
        } else {
            slope * over
        }
    }
    /// The gain reduction right now, in dB (≤ 0).
    pub fn reduction(&self) -> f32 {
        if self.opto { 0.75 * self.slow + 0.25 * self.tail } else { self.gr }
    }
    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        // feedback: listen to what came out last time; feed-forward: to what is coming in
        let src = if self.feedback { self.last } else { x };
        let level = if self.rms {
            self.power = flush(self.power * self.power_c + src * src * (1.0 - self.power_c));
            gain_to_db(self.power.sqrt())
        } else {
            gain_to_db(src.abs())
        };
        // read from the output, a ratio of R needs a slope of 1 − R (the output only rises 1/R as far)
        let target = if self.feedback { self.curve_with(level, 1.0 - self.ratio) } else { self.curve(level) };
        // attack when more reduction is wanted, release when less
        let c = if target < self.gr { self.att } else { self.rel };
        self.gr = target + (self.gr - target) * c;
        let g = if self.opto {
            // the photo-cell: the more it is lit, the faster it moves (480/(3 + dB) ms to recover,
            // a tenth of that to respond)
            let res = 480.0 / (3.0 + (-self.slow).max(0.0));
            let ms = if self.gr < self.slow { res / 10.0 } else { res };
            let c = (-1.3093 / (ms * 0.001 * self.sr)).exp();
            self.slow = self.gr + (self.slow - self.gr) * c;
            // and it remembers: a quarter of the reduction comes back only over a second or two
            self.tail = if self.slow < self.tail { self.slow } else { self.slow + (self.tail - self.slow) * self.rel_slow };
            0.75 * self.slow + 0.25 * self.tail
        } else {
            self.gr
        };
        let y = x * db_to_gain(g);
        self.last = y;
        y * db_to_gain(self.makeup)
    }
}

/// A split-band de-esser: the voice is split at `freq` (a Linkwitz-Riley crossover, so the two
/// bands add back up flat), and only the upper band is turned down, only while the highs carry
/// most of the energy (an "s"), never because the voice is simply loud.
#[derive(Clone, Debug)]
pub struct DeEsser {
    lp: [Biquad; 2],
    hp: [Biquad; 2],
    env_hi: f32,
    env_all: f32,
    c: f32,
    gain: f32,
    gc_att: f32,
    gc_rel: f32,
    pub amount: f32,
}
impl DeEsser {
    pub fn new(sr: f32, freq: f32) -> Self {
        let lp = Biquad::new(Shape::LowPass, freq, 0.707, sr);
        let hp = Biquad::new(Shape::HighPass, freq, 0.707, sr);
        DeEsser { lp: [lp, lp], hp: [hp, hp], env_hi: 0.0, env_all: 0.0, c: coef(0.003, sr), gain: 1.0, gc_att: coef(0.0008, sr), gc_rel: coef(0.06, sr), amount: 0.0 }
    }
    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        let lo = self.lp[0].run(x);
        let lo = self.lp[1].run(lo);
        let hi = self.hp[0].run(x);
        let hi = self.hp[1].run(hi);
        self.env_hi = flush(self.env_hi * self.c + hi.abs() * (1.0 - self.c));
        self.env_all = flush(self.env_all * self.c + (lo.abs() + hi.abs()) * (1.0 - self.c));
        let ratio = self.env_hi / (self.env_all + 1e-6);
        let want = if ratio > 0.45 && self.amount > 0.0 { (1.0 - self.amount * ((ratio - 0.45) / 0.3).min(1.0)).max(0.2) } else { 1.0 };
        let c = if want < self.gain { self.gc_att } else { self.gc_rel };
        self.gain = want + (self.gain - want) * c;
        lo + hi * self.gain
    }
}

/// A delay line with fractional reading (linear interpolation).
#[derive(Clone, Debug)]
pub struct Line {
    buf: Vec<f32>,
    w: usize,
}
impl Line {
    pub fn new(len: usize) -> Self {
        Line { buf: vec![0.0; len.max(2) + 2], w: 0 }
    }
    #[inline]
    pub fn push(&mut self, x: f32) {
        self.buf[self.w] = flush(x);
        self.w = (self.w + 1) % self.buf.len();
    }
    /// The sample written `d` samples ago (d ≥ 1).
    #[inline]
    pub fn at(&self, d: f32) -> f32 {
        let n = self.buf.len();
        let d = d.clamp(1.0, (n - 2) as f32);
        let i = d.floor() as usize;
        let f = d - i as f32;
        let a = self.buf[(self.w + n - i) % n];
        let b = self.buf[(self.w + n - i - 1) % n];
        a + (b - a) * f
    }
    /// The same, read through four points (a Hermite curve): for delays whose time is moving
    /// (tape wow, chorus, pitch), where a straight line between two samples would dull the highs.
    #[inline]
    pub fn at_smooth(&self, d: f32) -> f32 {
        let n = self.buf.len();
        let d = d.clamp(2.0, (n - 3) as f32);
        let i = d.floor() as usize;
        let f = d - i as f32;
        let p = |k: usize| self.buf[(self.w + 2 * n - k) % n];
        // points at delays i-1, i, i+1, i+2; the wanted one lies between i and i+1
        let (y0, y1, y2, y3) = (p(i - 1), p(i), p(i + 1), p(i + 2));
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * f + c2) * f + c1) * f + y1
    }
    #[inline]
    pub fn tap(&self, d: usize) -> f32 {
        let n = self.buf.len();
        self.buf[(self.w + n - d.clamp(1, n - 1)) % n]
    }
}

/// A Schroeder all-pass built on a delay line (as used in the plate).
#[derive(Clone, Debug)]
pub struct AllPass {
    line: Line,
    pub len: f32,
    pub g: f32,
}
impl AllPass {
    pub fn new(len: f32, g: f32) -> Self {
        AllPass { line: Line::new(len as usize + 40), len, g }
    }
    #[inline]
    pub fn run(&mut self, x: f32, extra: f32) -> f32 {
        let d = self.line.at(self.len + extra);
        let v = x - self.g * d;
        self.line.push(v);
        d + self.g * v
    }
}

/// The plate reverb of Dattorro's "Effect Design, Part 1" (1997), rescaled from its 29761 Hz
/// design rate, with the two tank all-passes gently modulated so long tails never ring.
#[derive(Clone, Debug)]
pub struct Plate {
    sr: f32,
    pre: Line,
    pub predelay: f32,
    bandwidth: OnePole,
    input: [AllPass; 4],
    l_ap: AllPass,
    l_d1: Line,
    l_damp: OnePole,
    l_ap2: AllPass,
    l_d2: Line,
    r_ap: AllPass,
    r_d1: Line,
    r_damp: OnePole,
    r_ap2: AllPass,
    r_d2: Line,
    pub decay: f32,
    lfo: f32,
    lfo_step: f32,
    k: f32,
    taps_l: [usize; 7],
    taps_r: [usize; 7],
    lens: [usize; 6],
    back_l: f32,
    back_r: f32,
}
impl Plate {
    pub fn new(sr: f32) -> Self {
        let k = sr / 29761.0;
        let s = |n: f32| n * k;
        let line = |n: f32| Line::new((n * k) as usize + 4);
        let t = |n: f32| (n * k).round() as usize;
        Plate {
            sr,
            pre: Line::new((sr * 0.25) as usize),
            predelay: 0.03,
            bandwidth: OnePole::with(1.0 - 0.9995),
            input: [AllPass::new(s(142.0), 0.75), AllPass::new(s(107.0), 0.75), AllPass::new(s(379.0), 0.625), AllPass::new(s(277.0), 0.625)],
            l_ap: AllPass::new(s(672.0), -0.7),
            l_d1: line(4453.0),
            l_damp: OnePole::with(0.0005),
            l_ap2: AllPass::new(s(1800.0), 0.5),
            l_d2: line(3720.0),
            r_ap: AllPass::new(s(908.0), -0.7),
            r_d1: line(4217.0),
            r_damp: OnePole::with(0.0005),
            r_ap2: AllPass::new(s(2656.0), 0.5),
            r_d2: line(3163.0),
            decay: 0.5,
            lfo: 0.0,
            lfo_step: 2.0 * PI * 0.9 / sr,
            k,
            taps_l: [t(266.0), t(2974.0), t(1913.0), t(1996.0), t(1990.0), t(187.0), t(1066.0)],
            taps_r: [t(353.0), t(3627.0), t(1228.0), t(2673.0), t(2111.0), t(335.0), t(121.0)],
            lens: [t(4453.0), t(1800.0), t(3720.0), t(4217.0), t(2656.0), t(3163.0)],
            back_l: 0.0,
            back_r: 0.0,
        }
    }
    /// How dark the tail gets (0 bright … 1 dark).
    pub fn set_damping(&mut self, d: f32) {
        let a = 0.0005 + d.clamp(0.0, 1.0) * 0.7;
        self.l_damp = OnePole::with(a);
        self.r_damp = OnePole::with(a);
    }
    /// One sample in (mono), two out (left, right).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        self.pre.push(x);
        let mut v = self.bandwidth.run(self.pre.at((self.predelay * self.sr).max(1.0)));
        for ap in self.input.iter_mut() {
            v = ap.run(v, 0.0);
        }
        self.lfo += self.lfo_step;
        if self.lfo > 2.0 * PI {
            self.lfo -= 2.0 * PI;
        }
        let ex = 8.0 * self.k;
        // left half of the tank, fed by the right half's end, and the other way round
        let l = self.l_ap.run(v + self.back_r * self.decay, ex * self.lfo.sin());
        self.l_d1.push(l);
        let l = self.l_damp.run(self.l_d1.tap(self.lens[0])) * self.decay;
        let l = self.l_ap2.run(l, 0.0);
        self.l_d2.push(l);
        let r = self.r_ap.run(v + self.back_l * self.decay, ex * self.lfo.cos());
        self.r_d1.push(r);
        let r = self.r_damp.run(self.r_d1.tap(self.lens[3])) * self.decay;
        let r = self.r_ap2.run(r, 0.0);
        self.r_d2.push(r);
        self.back_l = self.l_d2.tap(self.lens[2]);
        self.back_r = self.r_d2.tap(self.lens[5]);
        let (tl, tr) = (&self.taps_l, &self.taps_r);
        let yl = self.r_d1.tap(tl[0]) + self.r_d1.tap(tl[1]) - self.r_ap2.line.tap(tl[2]) + self.r_d2.tap(tl[3]) - self.l_d1.tap(tl[4]) - self.l_ap2.line.tap(tl[5]) - self.l_d2.tap(tl[6]);
        let yr = self.l_d1.tap(tr[0]) + self.l_d1.tap(tr[1]) - self.l_ap2.line.tap(tr[2]) + self.l_d2.tap(tr[3]) - self.r_d1.tap(tr[4]) - self.r_ap2.line.tap(tr[5]) - self.r_d2.tap(tr[6]);
        (yl * 0.6, yr * 0.6)
    }
}

/// A last stage that never lets the level go past full scale, without look-ahead: it is
/// clean below about −3 dBFS and bends smoothly above.
#[inline]
pub fn safety(x: f32) -> f32 {
    let t = 0.7;
    if x.abs() <= t { x } else { x.signum() * (t + (1.0 - t) * ((x.abs() - t) / (1.0 - t)).tanh()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    fn sine(f: f32, n: usize, a: f32) -> Vec<f32> {
        (0..n).map(|i| a * (2.0 * PI * f * i as f32 / SR).sin()).collect()
    }
    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn filters_pass_and_stop_what_they_should() {
        let mut hp = Biquad::new(Shape::HighPass, 100.0, 0.707, SR);
        let low: Vec<f32> = sine(30.0, 48000, 1.0).into_iter().map(|x| hp.run(x)).collect();
        assert!(rms(&low[24000..]) < 0.12, "30 Hz through a 100 Hz high-pass");
        let mut hp = Biquad::new(Shape::HighPass, 100.0, 0.707, SR);
        let mid: Vec<f32> = sine(1000.0, 48000, 1.0).into_iter().map(|x| hp.run(x)).collect();
        assert!((rms(&mid[24000..]) - 0.707).abs() < 0.02);
        let mut sh = Biquad::new(Shape::HighShelf(6.0), 10000.0, 0.707, SR);
        let air: Vec<f32> = sine(16000.0, 48000, 0.25).into_iter().map(|x| sh.run(x)).collect();
        assert!(rms(&air[24000..]) > 0.25 * 0.707 * 1.6, "the air shelf lifts the top");
    }

    #[test]
    fn the_compressor_turns_loud_parts_down_by_its_ratio() {
        let c = Compressor::new(SR, -20.0, 4.0, 0.0, 0.001, 0.1, false, false);
        assert_eq!(c.curve(-30.0), 0.0);
        assert!((c.curve(-8.0) - (-9.0)).abs() < 1e-4, "12 dB over at 4:1 comes out 3 dB over");
        let mut c = Compressor::new(SR, -20.0, 4.0, 6.0, 0.0005, 0.1, false, false);
        let out: Vec<f32> = sine(200.0, 24000, 0.5).into_iter().map(|x| c.run(x)).collect();
        assert!(rms(&out[12000..]) < 0.5 * 0.707 * 0.6);
        assert!(out.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn the_de_esser_leaves_the_voice_and_tames_the_hiss() {
        let mut d = DeEsser::new(SR, 6000.0);
        d.amount = 1.0;
        let voice: Vec<f32> = sine(300.0, 24000, 0.5).into_iter().map(|x| d.run(x)).collect();
        assert!((rms(&voice[12000..]) - 0.5 * 0.707).abs() < 0.03, "a low voice passes untouched");
        let mut d = DeEsser::new(SR, 6000.0);
        d.amount = 1.0;
        let ess: Vec<f32> = sine(8000.0, 24000, 0.5).into_iter().map(|x| d.run(x)).collect();
        assert!(rms(&ess[12000..]) < 0.5 * 0.707 * 0.6, "an 's' is turned down");
    }

    #[test]
    fn the_plate_rings_on_after_a_click_and_then_dies_away() {
        let mut p = Plate::new(SR);
        p.decay = 0.6;
        let mut energy = vec![];
        for i in 0..(SR as usize * 4) {
            let (l, r) = p.run(if i == 0 { 1.0 } else { 0.0 });
            assert!(l.is_finite() && r.is_finite());
            if i % 4800 == 0 {
                energy.push(0.0);
            }
            *energy.last_mut().unwrap() += l * l + r * r;
        }
        assert!(energy[2] > 0.0 && energy[1] > energy[30], "the tail decays");
        assert!(energy[39] < energy[3] * 0.05);
    }

    #[test]
    fn the_safety_stage_never_passes_full_scale() {
        assert_eq!(safety(0.5), 0.5);
        assert!(safety(4.0) <= 1.0 && safety(-4.0) >= -1.0);
        assert!(safety(0.9) > 0.7 && safety(0.9) < 0.9);
    }

    #[test]
    fn the_feedback_compressor_holds_peaks_at_its_ratio_without_chatter() {
        // 4:1 from −20 dB, reading its own output (the FET kind), fast attack
        let mut c = Compressor::new(SR, -20.0, 4.0, 0.0, 0.0004, 0.08, false, false);
        c.feedback = true;
        // a tone 12 dB over the threshold should come out about 3 dB over it
        let x = sine(1000.0, SR as usize, db_to_gain(-8.0));
        let y: Vec<f32> = x.iter().map(|v| c.run(*v)).collect();
        let out = gain_to_db(rms(&y[24000..]) * 1.4142);
        assert!((out - (-17.0)).abs() < 1.5, "peak level out: {out} dB");
        // and the gain is steady: a pure tone stays nearly pure (no chatter from the loop)
        let third: f32 = y[24000..].iter().enumerate().map(|(i, v)| v * (2.0 * PI * 3000.0 * i as f32 / SR).sin()).sum::<f32>().abs() / 12000.0;
        assert!(third < 0.05 * db_to_gain(out), "third harmonic {third}");
    }

    #[test]
    fn the_optical_compressor_lets_go_quickly_at_first_then_slowly() {
        let mut c = Compressor::new(SR, -30.0, 3.0, 6.0, 0.01, 0.06, true, true);
        for v in sine(500.0, SR as usize, 0.5) {
            c.run(v);
        }
        let deep = c.reduction();
        assert!(deep < -6.0, "working: {deep} dB");
        // silence: how long until half the reduction is gone, and how long for nine tenths
        let (mut half, mut most) = (0usize, 0usize);
        for i in 0..(SR as usize * 3) {
            c.run(0.0);
            if half == 0 && c.reduction() > deep * 0.5 {
                half = i;
            }
            if most == 0 && c.reduction() > deep * 0.1 {
                most = i;
            }
        }
        let (half, most) = (half as f32 / SR, most as f32 / SR);
        assert!(half > 0.01 && half < 0.25, "half back after {half} s");
        // a plain exponential would need 3.3 times as long for nine tenths; the photo-cell takes longer still
        assert!(most > half * 3.6, "nine tenths back after {most} s (half after {half} s)");
    }
}

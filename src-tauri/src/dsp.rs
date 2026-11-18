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
    /// A new corner without forgetting what is ringing (no click when a knob moves).
    pub fn tune(&mut self, freq: f32, sr: f32) {
        self.a = (-2.0 * PI * freq / sr).exp().clamp(0.0, 0.9999);
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
        // (a loop that reads its own output answers `ratio` times faster than its smoothing says;
        // moving at most 1/ratio of the way per sample keeps it from ever overshooting and ringing)
        let c = if target >= self.gr {
            self.rel
        } else if self.feedback {
            self.att.max(1.0 - 1.0 / self.ratio.max(1.0))
        } else {
            self.att
        };
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

/// A split-band de-esser. The voice is split at `freq` (a Linkwitz-Riley crossover, so the two
/// bands add back up flat) and only the upper band is turned down, only while the highs carry
/// most of the energy (an "s"), never because the voice is simply loud: it compares the power
/// above the split with the power of the whole voice, so it works the same at any level.
///
/// How far it turns down follows a soft 3:1 law with a 9 dB knee and never more than 9 dB (the
/// ratio and knee of the Calf de-esser, on this level-independent detector), and it lets go in
/// 15 ms, as the open-source de-essers do, so the vowel after an "s" is not dulled.
#[derive(Clone, Debug)]
pub struct DeEsser {
    lp: [Biquad; 2],
    hp: [Biquad; 2],
    p_hi: f32,
    p_all: f32,
    c: f32,
    /// dB taken off the upper band right now (≥ 0)
    gr: f32,
    gc_att: f32,
    gc_rel: f32,
    pub amount: f32,
}
impl DeEsser {
    pub fn new(sr: f32, freq: f32) -> Self {
        let lp = Biquad::new(Shape::LowPass, freq, 0.707, sr);
        let hp = Biquad::new(Shape::HighPass, freq, 0.707, sr);
        DeEsser { lp: [lp, lp], hp: [hp, hp], p_hi: 0.0, p_all: 0.0, c: coef(0.003, sr), gr: 0.0, gc_att: coef(0.001, sr), gc_rel: coef(0.015, sr), amount: 0.0 }
    }
    /// dB taken off the highs right now (≥ 0).
    #[allow(dead_code)]
    pub fn reduction(&self) -> f32 {
        self.gr
    }
    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        const KNEE: f32 = 9.0;
        const SLOPE: f32 = 0.667;
        const MOST: f32 = 9.0;
        let lo = self.lp[0].run(x);
        let lo = self.lp[1].run(lo);
        let hi = self.hp[0].run(x);
        let hi = self.hp[1].run(hi);
        // the same smoothing on both, or the comparison would tip on every consonant
        self.p_hi = flush(self.p_hi * self.c + hi * hi * (1.0 - self.c));
        self.p_all = flush(self.p_all * self.c + x * x * (1.0 - self.c));
        // nothing to do in silence (below −50 dBFS) or when switched off
        let mut want = 0.0;
        if self.amount > 0.0 && self.p_all > 1e-5 {
            // how much of the voice is "s" right now, in dB (0 = all of it)
            let index = 10.0 * ((self.p_hi + 1e-12) / (self.p_all + 1e-12)).log10();
            // the knob moves the point where it starts: light −5 dB … heavy −14 dB
            let over = index - (-5.0 - 9.0 * self.amount);
            want = if over <= -KNEE / 2.0 {
                0.0
            } else if over < KNEE / 2.0 {
                SLOPE * (over + KNEE / 2.0).powi(2) / (2.0 * KNEE)
            } else {
                SLOPE * over
            }
            .min(MOST);
        }
        let c = if want > self.gr { self.gc_att } else { self.gc_rel };
        self.gr = flush(want + (self.gr - want) * c);
        lo + hi * db_to_gain(-self.gr)
    }
}

/// A gentle gate: a 2:1 downward expander that turns the gaps between phrases down by a fixed,
/// modest amount instead of shutting them off, so breaths stay natural and the room never drops
/// to dead silence. It opens in 3 ms, waits 150 ms before it starts to close, closes slowly, and
/// needs the level to fall 4 dB below where it opened before it closes again (so it cannot
/// flutter). Rumble does not hold it open: it listens above 100 Hz.
/// (Ratio and knee as the Calf gate ships them; hold, release and the two-threshold idea as in
/// the OBS and LSP gates.)
#[derive(Clone, Debug)]
pub struct Expander {
    hp: Biquad,
    p: f32,
    c: f32,
    open: bool,
    hold: u32,
    hold_n: u32,
    /// dB turned down right now (≥ 0)
    g: f32,
    c_open: f32,
    c_close: f32,
    /// dBFS: below this the voice counts as a gap
    pub threshold: f32,
    /// dB: the most it ever turns down
    pub range: f32,
}
impl Expander {
    pub fn new(sr: f32) -> Self {
        Expander { hp: Biquad::new(Shape::HighPass, 100.0, 0.707, sr), p: 0.0, c: coef(0.01, sr), open: false, hold: 0, hold_n: (0.15 * sr) as u32, g: 0.0, c_open: coef(0.003, sr), c_close: coef(0.15, sr), threshold: -45.0, range: 10.0 }
    }
    #[allow(dead_code)]
    pub fn reduction(&self) -> f32 {
        self.g
    }
    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        const KNEE: f32 = 9.0;
        const HYST: f32 = 4.0;
        let s = self.hp.run(x);
        self.p = flush(self.p * self.c + s * s * (1.0 - self.c));
        let level = 10.0 * (self.p + 1e-12).log10();
        if !self.open && level > self.threshold {
            self.open = true;
        } else if self.open && level < self.threshold - HYST {
            self.open = false;
        }
        let thr = if self.open { self.threshold - HYST } else { self.threshold };
        // 2:1: one more dB down for every dB below the threshold, eased in over the knee
        let under = thr - level;
        let mut want = if under <= -KNEE / 2.0 {
            0.0
        } else if under < KNEE / 2.0 {
            (under + KNEE / 2.0).powi(2) / (2.0 * KNEE)
        } else {
            under
        }
        .min(self.range);
        // closing only starts once it has been asked for, for the whole hold time
        if want <= self.g {
            self.hold = self.hold_n;
        } else if self.hold > 0 {
            self.hold -= 1;
            want = self.g;
        }
        let c = if want < self.g { self.c_open } else { self.c_close };
        self.g = flush(want + (self.g - want) * c);
        x * db_to_gain(-self.g)
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
///
/// With `shimmer` up, part of what goes round the tank is read back an octave higher, so the
/// tail climbs into a halo above the voice. This is how "Oliverb" does it (Matthias Puech's
/// Parasites firmware for Clouds, on Émilie Gillet's reverb; MIT): two reading points sweep
/// along the tank's delays at double speed, each fading out as it reaches the end while the
/// other, half a delay away, fades in. The shifted part loses its lows and its top on the way
/// (or every trip would add an octave until it screamed), and is softly limited.
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
    /// how much of the feedback comes back an octave up (0 = a plain plate)
    pub shimmer: f32,
    sh_pos: usize,
    sh_lp: [OnePole; 2],
    sh_hp: [OnePole; 2],
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
            shimmer: 0.0,
            sh_pos: 0,
            sh_lp: [OnePole::hz(5500.0, sr); 2],
            sh_hp: [OnePole::hz(150.0, sr); 2],
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
        if self.shimmer > 0.0 {
            // two reading points a half-window apart, each moving one sample nearer the newest
            // sound per sample: read at double speed, which is an octave up
            let win = self.lens[2].min(self.lens[5]) - 2;
            self.sh_pos = if self.sh_pos == 0 { win - 1 } else { self.sh_pos - 1 };
            let other = (self.sh_pos + win / 2) % win;
            let ph = self.sh_pos as f32 / win as f32;
            let tri = 0.5 - 0.5 * (2.0 * PI * ph).cos();
            let up_l = self.l_d2.tap(self.sh_pos + 1) * tri + self.l_d2.tap(other + 1) * (1.0 - tri);
            let up_r = self.r_d2.tap(self.sh_pos + 1) * tri + self.r_d2.tap(other + 1) * (1.0 - tri);
            let up_l = self.sh_lp[0].run(up_l);
            let up_r = self.sh_lp[1].run(up_r);
            let up_l = up_l - self.sh_hp[0].run(up_l);
            let up_r = up_r - self.sh_hp[1].run(up_r);
            let soft = |x: f32| {
                let x = x.clamp(-3.0, 3.0);
                x * (27.0 + x * x) / (27.0 + 9.0 * x * x)
            };
            self.back_l = soft(self.back_l * (1.0 - self.shimmer) + up_l * self.shimmer);
            self.back_r = soft(self.back_r * (1.0 - self.shimmer) + up_r * self.shimmer);
        }
        let (tl, tr) = (&self.taps_l, &self.taps_r);
        let yl = self.r_d1.tap(tl[0]) + self.r_d1.tap(tl[1]) - self.r_ap2.line.tap(tl[2]) + self.r_d2.tap(tl[3]) - self.l_d1.tap(tl[4]) - self.l_ap2.line.tap(tl[5]) - self.l_d2.tap(tl[6]);
        let yr = self.l_d1.tap(tr[0]) + self.l_d1.tap(tr[1]) - self.l_ap2.line.tap(tr[2]) + self.l_d2.tap(tr[3]) - self.r_d1.tap(tr[4]) - self.r_ap2.line.tap(tr[5]) - self.r_d2.tap(tr[6]);
        (yl * 0.6, yr * 0.6)
    }
}

/// −3 dBFS: where the limiter holds a sustained loud note, and below which nothing is touched.
pub const LIMIT: f32 = 0.7079;
/// −1 dBFS: the level nothing ever passes (1 dB is left for the peaks between samples).
pub const CEILING: f32 = 0.8913;

/// The very last bend: exactly clean up to −3 dBFS, then rounding off smoothly to −1 dBFS.
/// Anything that is not a number becomes silence.
#[inline]
pub fn safety(x: f32) -> f32 {
    if !x.is_finite() {
        return 0.0;
    }
    let a = x.abs();
    if a <= LIMIT { x } else { x.signum() * (LIMIT + (CEILING - LIMIT) * ((a - LIMIT) / (CEILING - LIMIT)).tanh()) }
}

/// Output protection with no look-ahead, in two parts. A limiter turns a loud passage down to
/// −3 dBFS and holds it there (so a held loud note is turned down cleanly instead of being
/// clipped for its whole length), and the soft clip above catches the first instant of a peak,
/// which a limiter that cannot see ahead is too late for.
/// The limiter is nhthn's safety-limiter (public domain): it follows the peak, holds for 100 ms,
/// then lets go over 100 ms; the 0.4 ms it takes to grab is stmlib's (MIT). Left and right move
/// together, so the voice does not wander.
#[derive(Clone, Debug)]
pub struct Limiter {
    last: f32,
    hold: u32,
    hold_n: u32,
    k: f32,
    att: f32,
    g: f32,
}
impl Limiter {
    pub fn new(sr: f32) -> Self {
        Limiter { last: 0.0, hold: 0, hold_n: (0.1 * sr) as u32, k: 0.001f32.powf(1.0 / (0.1 * sr)), att: coef(0.0004, sr), g: 1.0 }
    }
    /// dB it is turning down right now (≥ 0).
    pub fn reduction(&self) -> f32 {
        -gain_to_db(self.g)
    }
    #[inline]
    pub fn run(&mut self, l: f32, r: f32) -> (f32, f32) {
        let (l, r) = (if l.is_finite() { l } else { 0.0 }, if r.is_finite() { r } else { 0.0 });
        let a = l.abs().max(r.abs()) / LIMIT;
        let f = if self.hold > 0 {
            self.hold -= 1;
            self.last
        } else {
            self.last * self.k + a * (1.0 - self.k)
        };
        let amp = if f > a {
            f
        } else {
            self.hold = self.hold_n;
            a
        };
        self.last = flush(amp);
        let target = if amp > 1.0 { 1.0 / amp } else { 1.0 };
        self.g = if target < self.g { target + (self.g - target) * self.att } else { target };
        (safety(l * self.g), safety(r * self.g))
    }
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

    /// hiss: every sample random, so its energy is spread up to the top
    fn noise(n: usize, a: f32) -> Vec<f32> {
        let mut s = 12345u32;
        (0..n)
            .map(|_| {
                s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                a * ((s >> 8) as f32 / 8388608.0 - 1.0)
            })
            .collect()
    }

    #[test]
    fn the_de_esser_leaves_the_voice_and_tames_the_hiss() {
        let mut d = DeEsser::new(SR, 6000.0);
        d.amount = 1.0;
        let voice: Vec<f32> = sine(300.0, 24000, 0.5).into_iter().map(|x| d.run(x)).collect();
        assert!((rms(&voice[12000..]) - 0.5 * 0.707).abs() < 0.01, "a low voice passes untouched");
        assert!(d.reduction() < 0.01);
        let mut d = DeEsser::new(SR, 6000.0);
        d.amount = 1.0;
        let ess: Vec<f32> = sine(8000.0, 24000, 0.5).into_iter().map(|x| d.run(x)).collect();
        assert!(rms(&ess[12000..]) < 0.5 * 0.707 * 0.6, "an 's' is turned down");
        assert!(d.reduction() <= 9.0 + 1e-3, "but never by more than 9 dB: {}", d.reduction());
    }

    #[test]
    fn the_de_esser_works_the_same_whether_you_sing_loud_or_soft() {
        // an "s" (hiss above the split) over a little vowel, loud and 20 dB quieter
        let taken = |a: f32| {
            let mut d = DeEsser::new(SR, 6500.0);
            d.amount = 0.5;
            let mut hp = Biquad::new(Shape::HighPass, 5000.0, 0.707, SR);
            let tone = sine(200.0, 24000, 0.3 * a);
            for (n, t) in noise(24000, a).into_iter().zip(tone) {
                d.run(hp.run(n) + t);
            }
            d.reduction()
        };
        let (loud, soft) = (taken(0.3), taken(0.03));
        assert!(loud > 1.5, "the hiss is turned down: {loud} dB");
        assert!((loud - soft).abs() < 0.6, "by the same amount at any level: {loud} vs {soft}");
    }

    #[test]
    fn the_de_esser_lets_go_before_the_next_vowel() {
        let mut d = DeEsser::new(SR, 6500.0);
        d.amount = 1.0;
        for x in sine(9000.0, 9600, 0.3) {
            d.run(x);
        }
        assert!(d.reduction() > 6.0);
        // 60 ms into the vowel that follows it is out of the way
        for x in sine(250.0, 2880, 0.3) {
            d.run(x);
        }
        assert!(d.reduction() < 0.5, "{} dB still held", d.reduction());
    }

    #[test]
    fn the_de_esser_is_flat_when_it_has_nothing_to_do() {
        use crate::testutil::gain_db;
        for f in [200.0, 3000.0, 6500.0, 12000.0] {
            let mut d = DeEsser::new(SR, 6500.0);
            let g = gain_db(SR as f64, f, |x| d.run(x));
            assert!(g.abs() < 0.05, "{f} Hz: {g} dB");
        }
    }

    #[test]
    fn the_expander_turns_gaps_down_a_little_and_never_shuts() {
        let mut e = Expander::new(SR);
        e.threshold = -45.0;
        e.range = 10.0;
        // singing: untouched
        let sung: Vec<f32> = sine(300.0, 24000, 0.2).into_iter().map(|x| e.run(x)).collect();
        assert!((rms(&sung[12000..]) - 0.2 * 0.707).abs() < 0.002);
        assert!(e.reduction() < 0.05);
        // the room afterwards (−70 dBFS): down by the range, no further
        let room: Vec<f32> = sine(300.0, 96000, db_to_gain(-70.0)).into_iter().map(|x| e.run(x)).collect();
        assert!((e.reduction() - 10.0).abs() < 0.3, "{} dB", e.reduction());
        assert!(rms(&room[90000..]) > db_to_gain(-70.0) * 0.707 * 0.3, "still there, only quieter");
    }

    #[test]
    fn the_expander_holds_before_closing_and_opens_at_once() {
        let mut e = Expander::new(SR);
        for x in sine(300.0, 24000, 0.2) {
            e.run(x);
        }
        // 100 ms of silence: still inside the hold, nothing has moved
        for _ in 0..4800 {
            e.run(0.0);
        }
        assert!(e.reduction() < 0.1, "held: {} dB", e.reduction());
        for _ in 0..48000 {
            e.run(0.0);
        }
        assert!(e.reduction() > 9.0, "closed: {} dB", e.reduction());
        // the next word: open again within 20 ms
        for x in sine(300.0, 960, 0.2) {
            e.run(x);
        }
        assert!(e.reduction() < 1.0, "open: {} dB", e.reduction());
    }

    #[test]
    fn the_expander_does_not_flutter_at_its_threshold() {
        // a level wobbling ±2 dB around the threshold: it opens once and stays open
        let mut e = Expander::new(SR);
        e.threshold = -40.0;
        let mut changes = 0;
        let mut was = e.reduction() < 0.5;
        for i in 0..(SR as usize * 4) {
            let t = i as f32 / SR;
            let a = db_to_gain(-37.0 + 2.0 * (2.0 * PI * 3.0 * t).sin());
            e.run(a * (2.0 * PI * 400.0 * t).sin());
            let now = e.reduction() < 0.5;
            if now != was {
                changes += 1;
                was = now;
            }
        }
        assert!(changes <= 1, "{changes} changes");
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
    fn shimmer_lifts_the_tail_an_octave_and_still_dies_away() {
        // a 440 Hz note into the plate, then silence: how much is there around 880 Hz in the tail?
        let octave = |shimmer: f32| {
            let mut p = Plate::new(SR);
            p.decay = 0.85;
            p.shimmer = shimmer;
            let mut band = [Biquad::new(Shape::BandPass, 880.0, 30.0, SR), Biquad::new(Shape::BandPass, 440.0, 30.0, SR)];
            let (mut up, mut root) = (0.0f64, 0.0f64);
            for i in 0..(SR as usize * 14) {
                let x = if i < 24000 { 0.3 * (2.0 * PI * 440.0 * i as f32 / SR).sin() } else { 0.0 };
                let (l, r) = p.run(x);
                assert!(l.is_finite() && r.is_finite() && l.abs() < 4.0);
                let (u, o) = (band[0].run(l), band[1].run(l));
                if (36000..84000).contains(&i) {
                    up += (u * u) as f64;
                    root += (o * o) as f64;
                }
                if i > SR as usize * 13 {
                    assert!(l.abs() < 0.01, "gone in the end ({shimmer})");
                }
            }
            (up.sqrt(), root.sqrt())
        };
        let (up_plain, _) = octave(0.0);
        let (up, root) = octave(0.4);
        assert!(up > up_plain * 4.0 && up > root * 0.15, "octave {up} (plain plate {up_plain}), root {root}");
    }

    #[test]
    fn the_safety_stage_never_passes_its_ceiling() {
        assert_eq!(safety(0.5), 0.5);
        assert_eq!(safety(0.7), 0.7);
        assert!(safety(4.0) <= CEILING && safety(-4.0) >= -CEILING);
        assert!(safety(0.8) > LIMIT && safety(0.8) < 0.8);
        assert_eq!(safety(f32::NAN), 0.0);
        assert_eq!(safety(f32::INFINITY), 0.0);
    }

    #[test]
    fn the_limiter_turns_a_loud_note_down_cleanly_instead_of_clipping_it() {
        let mut lim = Limiter::new(SR);
        // quiet singing is not touched at all
        for x in sine(220.0, 4800, 0.25) {
            assert_eq!(lim.run(x, x), (x, x));
        }
        // then a note 9 dB over the limit
        let x = sine(220.0, 48000, LIMIT * 2.82);
        let y: Vec<f32> = x.iter().map(|v| lim.run(*v, *v).0).collect();
        assert!(y.iter().all(|v| v.abs() <= CEILING), "never past the ceiling");
        // once it has it, the note sits at −3 dBFS and is a pure tone again (turned down, not bent)
        let held = &y[4800..];
        let peak = held.iter().map(|v| v.abs()).fold(0.0, f32::max);
        assert!((peak - LIMIT).abs() < 0.01, "held at {peak}");
        let third: f32 = held.iter().enumerate().map(|(i, v)| v * (2.0 * PI * 660.0 * (i + 4800) as f32 / SR).sin()).sum::<f32>().abs() * 2.0 / held.len() as f32;
        assert!(third < 0.002, "third harmonic {third}");
        assert!((lim.reduction() - 9.0).abs() < 0.3, "{} dB", lim.reduction());
        // and afterwards it lets go: 100 ms hold, then about as long again
        let mut back = 0;
        for i in 0..48000 {
            lim.run(0.1, 0.1);
            if back == 0 && lim.reduction() < 0.1 {
                back = i;
            }
        }
        let back = back as f32 / SR;
        assert!(back > 0.1 && back < 0.3, "back after {back} s");
    }

    #[test]
    fn the_limiter_moves_left_and_right_together() {
        let mut lim = Limiter::new(SR);
        let mut out = (0.0, 0.0);
        for x in sine(220.0, 24000, 1.5) {
            out = lim.run(x, 0.1 * x);
        }
        let _ = out;
        // the quiet side is turned down by the same amount as the loud one
        let (l, r) = lim.run(1.0, 0.1);
        assert!((r / l - 0.1).abs() < 0.02, "{l} {r}");
    }

    #[test]
    fn a_fast_feedback_compressor_at_a_high_ratio_never_rings() {
        // 20:1 with an attack far shorter than such a loop can follow in one sample
        let mut c = Compressor::new(SR, -30.0, 20.0, 0.0, 0.00002, 0.08, false, false);
        c.feedback = true;
        let mut worst = 0.0f32;
        let mut last = 0.0;
        for (i, x) in sine(1000.0, 24000, 0.9).into_iter().enumerate() {
            c.run(x);
            // the gain may only ever move one way while the note is held: no alternation
            let g = c.reduction();
            if i > 4800 {
                worst = worst.max((g - last).abs());
            }
            last = g;
        }
        assert!(worst < 3.0, "the gain jumps by {worst} dB from sample to sample");
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

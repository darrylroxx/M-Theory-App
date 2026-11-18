//! A room: the reverb of Dragonfly Room, which is freeverb3's "progenitor2" by Teru Kamogashira
//! (GPL-2.0-or-later; its header credits David Griesinger for the design it follows).
//!
//! It is nothing like the hall. The voice is smeared by ten all-passes a side, crossed over
//! between the sides, and then goes round a figure-of-eight made of all-passes nested inside
//! all-passes, each of which loses a little every time. At the length of a room (under a second
//! or so) very little goes round twice: what you hear is one dense burst, dark and short, which
//! is what a room is. Thirty-one taps from inside the loop make the left and right outputs, and
//! six early reflections (freeverb3's pattern) put the walls in front of it.
//!
//! Sizes are the source's tables (in samples at 34125 Hz), scaled to the sample rate and to the
//! size of the room and rounded up to primes as the source does. The settings are those of the
//! plugin's own "Vocal Room" presets (small, medium, large) along the size knob.

use std::f32::consts::PI;

const REF: f32 = 34125.0;
/// the largest room the size knob gives, as freeverb3's size factor (16 m)
const RS_MAX: f32 = 1.6;

const IN_L: [f32; 10] = [617.0, 535.0, 434.0, 347.0, 218.0, 162.0, 144.0, 122.0, 109.0, 74.0];
const IN_R: [f32; 10] = [603.0, 547.0, 416.0, 364.0, 236.0, 162.0, 140.0, 131.0, 111.0, 79.0];
const CROSS_L: [f32; 4] = [430.0, 341.0, 264.0, 174.0];
const CROSS_R: [f32; 4] = [447.0, 324.0, 247.0, 191.0];
/// freeverb3 early reflections, preset 1: times (seconds) and gains, left and right.
const ER_L: [(f32, f32); 6] = [(0.0199, 1.020), (0.0354, 0.818), (0.0389, 0.635), (0.0414, 0.719), (0.0699, 0.267), (0.0796, 0.242)];
const ER_R: [(f32, f32); 6] = [(0.0209, 1.021), (0.0364, 0.820), (0.0399, 0.633), (0.0424, 0.722), (0.0709, 0.187), (0.0806, 0.243)];

fn is_prime(n: usize) -> bool {
    if n < 4 {
        return true;
    }
    if n % 2 == 0 {
        return false;
    }
    let mut k = 3;
    while k * k <= n {
        if n % k == 0 {
            return false;
        }
        k += 2;
    }
    true
}
/// freeverb3's `p_`: scale, then go up to the next prime (so no two delays share a period).
fn p_(len: f32, factor: f32) -> usize {
    let mut n = ((len * factor) as usize).max(1);
    while !is_prime(n) {
        n += 1;
    }
    n
}
/// freeverb3's `f_`: scale only (for tap positions).
fn f_(len: f32, factor: f32) -> usize {
    ((len * factor) as usize).max(1)
}

/// A delay of a whole number of samples whose length can change (its memory is as long as it
/// will ever need).
#[derive(Clone, Debug)]
struct Ring {
    buf: Vec<f32>,
    n: usize,
    i: usize,
}
impl Ring {
    fn new(max: usize) -> Self {
        Ring { buf: vec![0.0; max.max(2)], n: 1, i: 0 }
    }
    fn resize(&mut self, n: usize) {
        self.n = n.clamp(1, self.buf.len());
        self.i = 0;
        self.buf.fill(0.0);
    }
    /// What went in `n` samples ago (read this before `put`).
    #[inline]
    fn oldest(&self) -> f32 {
        self.buf[self.i]
    }
    #[inline]
    fn put(&mut self, x: f32) {
        self.buf[self.i] = x;
        self.i += 1;
        if self.i >= self.n {
            self.i = 0;
        }
    }
    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let out = self.oldest();
        self.put(x);
        out
    }
    /// After `put`: what was written `k − 1` samples before the last one (1 = the last one).
    #[inline]
    fn z(&self, k: usize) -> f32 {
        let k = k.clamp(1, self.n);
        self.buf[(self.i + self.n - k) % self.n]
    }
}

/// A delay read at a moving, fractional point.
#[derive(Clone, Debug)]
struct ModRing {
    buf: Vec<f32>,
    w: usize,
}
impl ModRing {
    fn new(max: usize) -> Self {
        ModRing { buf: vec![0.0; max + 4], w: 0 }
    }
    fn clear(&mut self) {
        self.buf.fill(0.0);
    }
    /// What was written `d` samples ago (before this sample's write; d ≥ 1).
    #[inline]
    fn read(&self, d: usize) -> f32 {
        let n = self.buf.len();
        self.buf[(self.w + n - d.clamp(1, n - 1)) % n]
    }
    #[inline]
    fn write(&mut self, x: f32) {
        self.buf[self.w] = x;
        self.w += 1;
        if self.w >= self.buf.len() {
            self.w = 0;
        }
    }
}

/// freeverb3's modulated all-pass (`allpassm`): its length moves by up to `ex` samples either
/// way (read through a first-order all-pass, so the movement does not dull it), its coefficient
/// can be nudged per sample, and what comes back from its delay can be made to lose a little.
#[derive(Clone, Debug)]
struct ApM {
    ring: ModRing,
    size: usize,
    ex: usize,
    z1: f32,
    fb: f32,
    decay: f32,
}
impl ApM {
    fn new(max: usize) -> Self {
        ApM { ring: ModRing::new(max), size: 2, ex: 1, z1: 0.0, fb: 0.5, decay: 1.0 }
    }
    fn resize(&mut self, size: usize, ex: usize) {
        self.ex = ex.max(1).min(size.saturating_sub(1).max(1));
        self.size = size.max(self.ex + 1);
        self.z1 = 0.0;
        self.ring.clear();
    }
    #[inline]
    fn run(&mut self, x: f32, md: f32, fmod: f32) -> f32 {
        let m = (md + 1.0) * self.ex as f32;
        let fl = m as usize;
        let frac = 1.0 - (m - fl as f32);
        let d = self.size - self.ex + fl;
        let (a, b) = (self.ring.read(d), self.ring.read(d + 1));
        self.z1 = b + frac * (a - self.z1);
        let fb = self.fb + fmod;
        let v = x + self.z1 * fb;
        self.ring.write(v);
        self.decay * self.z1 - v * fb
    }
}

/// A plain all-pass (`allpass::_process`).
#[derive(Clone, Debug)]
struct Ap {
    ring: Ring,
    fb: f32,
}
impl Ap {
    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        let z = self.ring.oldest();
        let v = x + self.fb * z;
        self.ring.put(v);
        z - self.fb * v
    }
}

/// An all-pass inside an all-pass (`allpass2`): `b1` the inner, `b2` the outer.
#[derive(Clone, Debug)]
struct Ap2 {
    b1: Ring,
    b2: Ring,
    fb1: f32,
    fb2: f32,
    decay1: f32,
    decay2: f32,
}
impl Ap2 {
    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        let (z1, z2) = (self.b1.oldest(), self.b2.oldest());
        let x = x + self.fb2 * z2;
        let out = self.decay2 * z2 - x * self.fb2;
        let x = x + self.fb1 * z1;
        self.b2.put(self.decay1 * z1 - x * self.fb1);
        self.b1.put(x);
        out
    }
}

/// Three deep (`allpass3`): `b1` the innermost, whose length moves; `b2`; `b3` the outermost.
#[derive(Clone, Debug)]
struct Ap3 {
    b1: ModRing,
    size1: usize,
    ex: usize,
    b2: Ring,
    b3: Ring,
    fb1: f32,
    fb2: f32,
    fb3: f32,
    decay1: f32,
    decay2: f32,
    decay3: f32,
}
impl Ap3 {
    #[inline]
    fn run(&mut self, x: f32, md: f32) -> f32 {
        let (z2, z3) = (self.b2.oldest(), self.b3.oldest());
        let x = x + self.fb3 * z3;
        let out = self.decay3 * z3 - self.fb3 * x;
        let x = x + self.fb2 * z2;
        self.b3.put(self.decay2 * z2 - self.fb2 * x);
        let m = (md + 1.0) * self.ex as f32;
        let fl = m as usize;
        let frac = m - fl as f32;
        let d = self.size1 - self.ex + fl;
        let t = self.b1.read(d + 1) * frac + self.b1.read(d) * (1.0 - frac);
        let x = x + self.fb1 * t;
        self.b2.put(self.decay1 * t - self.fb1 * x);
        self.b1.write(x);
        out
    }
    /// A tap inside the innermost delay (after `run`).
    #[inline]
    fn z1(&self, k: usize) -> f32 {
        self.b1.read(self.size1 - self.ex + k)
    }
}

/// freeverb3's first-order low-pass (`iir_1st`, Butterworth).
#[derive(Clone, Copy, Debug, Default)]
struct Lp1 {
    a2: f32,
    b: f32,
    y1: f32,
}
impl Lp1 {
    fn set(&mut self, fc: f32, sr: f32) {
        let t = (PI * fc.min(0.45 * sr) / sr).tan();
        self.b = t / (1.0 + t);
        self.a2 = (1.0 - t) / (1.0 + t);
    }
    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        let out = x * self.b + self.y1;
        self.y1 = out * self.a2 + x * self.b;
        out
    }
}

/// An RBJ biquad set by its bandwidth in octaves, as freeverb3 does: a low-pass or an all-pass.
#[derive(Clone, Copy, Debug, Default)]
struct Rbj {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}
impl Rbj {
    fn set(&mut self, allpass: bool, fc: f32, bw: f32, sr: f32) {
        let w = 2.0 * PI * fc.min(0.4 * sr) / sr;
        let alpha = w.sin() * (std::f32::consts::LN_2 / 2.0 * bw * w / w.sin()).sinh();
        let a0 = 1.0 + alpha;
        if allpass {
            self.b0 = (1.0 - alpha) / a0;
            self.b1 = -2.0 * w.cos() / a0;
            self.b2 = 1.0;
        } else {
            self.b0 = (1.0 - w.cos()) / 2.0 / a0;
            self.b1 = (1.0 - w.cos()) / a0;
            self.b2 = self.b0;
        }
        self.a1 = -2.0 * w.cos() / a0;
        self.a2 = (1.0 - alpha) / a0;
    }
    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = if y.abs() < 1e-20 { 0.0 } else { y };
        self.y1
    }
}

/// One side of the figure-of-eight.
#[derive(Clone, Debug)]
struct Half {
    input: Vec<ApM>,
    cross: Vec<Ap>,
    lp_in: Lp1,
    bass_ap: Rbj,
    bass_lp: Rbj,
    damp: Lp1,
    m1: ApM,
    d_a: Ring,
    m2: ApM,
    d_b: Ring,
    ap2: Ap2,
    d_c: Ring,
    ap3: Ap3,
    d_d: Ring,
    comb: Ring,
    out_lp: Rbj,
    early: Ring,
    early_lp: Lp1,
}

/// The tables of one side, at 34125 Hz: the two modulated all-passes, the four plain delays, the
/// double (inner, outer) and the triple (inner, its movement, middle, outer).
struct Sizes {
    m: [f32; 2],
    d: [f32; 4],
    ap2: [f32; 2],
    ap3: [f32; 4],
}
const LEFT: Sizes = Sizes { m: [239.0, 392.0], d: [2.0, 1055.0, 344.0, 1572.0], ap2: [1944.0, 612.0], ap3: [1212.0, 121.0, 816.0, 1264.0] };
const RIGHT: Sizes = Sizes { m: [205.0, 329.0], d: [1.0, 1460.0, 500.0, 16.0], ap2: [2032.0, 368.0], ap3: [1452.0, 5.0, 688.0, 1340.0] };

impl Half {
    fn new(sr: f32, s: &Sizes, input: &[f32; 10], cross: &[f32; 4]) -> Self {
        // room for the largest room, the prime above it, and the movement
        let cap = |len: f32| (len * sr * RS_MAX / REF) as usize + 400;
        let ring = |len: f32| Ring::new(cap(len));
        Half {
            input: input.iter().map(|&n| ApM::new(cap(n))).collect(),
            cross: cross.iter().map(|&n| Ap { ring: ring(n), fb: 0.78 }).collect(),
            lp_in: Lp1::default(),
            bass_ap: Rbj::default(),
            bass_lp: Rbj::default(),
            damp: Lp1::default(),
            m1: ApM::new(cap(s.m[0])),
            d_a: ring(s.d[0]),
            m2: ApM::new(cap(s.m[1])),
            d_b: ring(s.d[1]),
            ap2: Ap2 { b1: ring(s.ap2[0]), b2: ring(s.ap2[1]), fb1: 0.25, fb2: 0.406, decay1: 1.0, decay2: 1.0 },
            d_c: ring(s.d[2]),
            ap3: Ap3 { b1: ModRing::new(cap(s.ap3[0] + s.ap3[1])), size1: 2, ex: 1, b2: ring(s.ap3[2]), b3: ring(s.ap3[3]), fb1: 0.25, fb2: 0.25, fb3: 0.406, decay1: 1.0, decay2: 1.0, decay3: 1.0 },
            d_d: ring(s.d[3]),
            comb: Ring::new((0.022 * sr) as usize + 200),
            out_lp: Rbj::default(),
            early: Ring::new((0.0806 * RS_MAX * sr) as usize + 8),
            early_lp: Lp1::default(),
        }
    }
    fn resize(&mut self, sr: f32, rs: f32, s: &Sizes, input: &[f32; 10], cross: &[f32; 4]) {
        let k = sr * rs / REF;
        // the movement of the input all-passes and of the two at the head of the loop follows the
        // sample rate only; the one inside the triple follows the size of the room too
        let ex_in = p_(10.0, sr / REF);
        let ex = p_(32.0, sr / REF);
        for (a, &n) in self.input.iter_mut().zip(input) {
            a.resize(p_(n, k), ex_in);
        }
        for (a, &n) in self.cross.iter_mut().zip(cross) {
            a.ring.resize(p_(n, k));
        }
        self.m1.resize(p_(s.m[0], k), ex);
        self.m2.resize(p_(s.m[1], k), ex);
        self.d_a.resize(p_(s.d[0], k));
        self.d_b.resize(p_(s.d[1], k));
        self.d_c.resize(p_(s.d[2], k));
        self.d_d.resize(p_(s.d[3], k));
        self.ap2.b1.resize(p_(s.ap2[0], k));
        self.ap2.b2.resize(p_(s.ap2[1], k));
        self.ap3.size1 = p_(s.ap3[0], k);
        self.ap3.ex = p_(s.ap3[1], k).min(self.ap3.size1 - 1);
        self.ap3.b1.clear();
        self.ap3.b2.resize(p_(s.ap3[2], k));
        self.ap3.b3.resize(p_(s.ap3[3], k));
        self.comb.resize(p_(22.0, sr * 0.001));
        self.early.resize((0.0806 * rs * sr) as usize + 4);
        self.lp_in = Lp1::default();
        self.damp.y1 = 0.0;
        self.early_lp.y1 = 0.0;
        for f in [&mut self.bass_ap, &mut self.bass_lp, &mut self.out_lp] {
            (f.x1, f.x2, f.y1, f.y2) = (0.0, 0.0, 0.0, 0.0);
        }
    }
}

pub struct Room {
    sr: f32,
    /// the size the delays are cut for (the size knob, or −1 before the first setting)
    cut_for: f32,
    rs: f32,
    l: Half,
    r: Half,
    /// tap positions, scaled to the room: freeverb3's `idxOutCo` and `idxOutCo2`
    t: [usize; 11],
    t2: [usize; 20],
    loop_decay: f32,
    bass: f32,
    lfo1: (f32, f32),
    lfo2: (f32, f32),
    rot1: (f32, f32),
    rot2: (f32, f32),
    lfo1_lp: Lp1,
    lfo2_lp: Lp1,
    wander: f32,
    noise: u32,
    pink: [f32; 3],
    renorm: u32,
}

const IDX: [f32; 11] = [276.0, 468.0, 625.0, 312.0, 8.0, 24.0, 36.0, 40.0, 1.0, 192.0, 1572.0];
const IDX2: [f32; 20] = [110.0, 790.0, 2.0, 189.0, 121.0, 10.0, 480.0, 359.0, 103.0, 30.0, 26.0, 10.0, 780.0, 109.0, 1200.0, 1310.0, 780.0, 10.0, 310.0, 800.0];

impl Room {
    pub fn new(sr: f32) -> Self {
        let mut r = Room {
            sr,
            cut_for: -1.0,
            rs: 1.2,
            l: Half::new(sr, &LEFT, &IN_L, &CROSS_L),
            r: Half::new(sr, &RIGHT, &IN_R, &CROSS_R),
            t: [1; 11],
            t2: [1; 20],
            loop_decay: 0.0,
            bass: 0.0,
            lfo1: (1.0, 0.0),
            lfo2: (1.0, 0.0),
            rot1: (1.0, 0.0),
            rot2: (1.0, 0.0),
            lfo1_lp: Lp1::default(),
            lfo2_lp: Lp1::default(),
            wander: 0.16,
            noise: 0x2545F491,
            pink: [0.0; 3],
            renorm: 0,
        };
        r.lfo1_lp.set(20.0, sr);
        r.lfo2_lp.set(12.0, sr);
        r.set(0.5, 0.3);
        r
    }

    /// How big the room is (0..1: a small booth to a large live room; size and decay together)
    /// and how dark (0..1).
    pub fn set(&mut self, size: f32, tone: f32) {
        let (size, tone) = (size.clamp(0.0, 1.0), tone.clamp(0.0, 1.0));
        let sr = self.sr;
        // the plugin's Small, Medium and Large Vocal Room lie along this line:
        // 8 m / 0.3 s … 12 m / 0.6 s … 15 m / 1.0 s
        let rs = 0.8 + 0.8 * size;
        let rt60 = 0.3 * 4.5f32.powf(size);
        let diffuse = (0.86 + 0.13 * size) / 1.2;
        let damp = 10000.0 * 0.3f32.powf(tone);
        let boost = (20.0 + 10.0 * size) / 20.0 / rt60.powf(1.5) * rs;
        let spin = 2.4 + 0.7 * size;
        if (size - self.cut_for).abs() > 1e-4 {
            // a different room: new lengths everywhere, starting from silence
            self.cut_for = size;
            self.rs = rs;
            self.l.resize(sr, rs, &LEFT, &IN_L, &CROSS_L);
            self.r.resize(sr, rs, &RIGHT, &IN_R, &CROSS_R);
            let k = sr * rs / REF;
            self.t = IDX.map(|n| f_(n, k));
            self.t2 = IDX2.map(|n| f_(n, k));
        }
        let t = rt60 / rs;
        self.loop_decay = 0.237f32.powf(1.0 / t);
        let (d1, d2, d3) = (0.938f32.powf(1.0 / t), 0.844f32.powf(1.0 / t), 0.906f32.powf(1.0 / t));
        self.bass = boost;
        for h in [&mut self.l, &mut self.r] {
            for a in h.input.iter_mut() {
                a.fb = -diffuse;
                a.decay = 1.0;
            }
            for a in h.cross.iter_mut() {
                a.fb = diffuse;
            }
            h.lp_in.set(20000.0, sr);
            h.bass_ap.set(true, 150.0, 4.0, sr);
            h.bass_lp.set(false, 400.0, 2.0, sr);
            h.damp.set(damp, sr);
            h.out_lp.set(false, damp, 2.0, sr);
            h.early_lp.set(damp + 1500.0, sr);
            (h.m1.fb, h.m1.decay) = (0.375, d2);
            (h.m2.fb, h.m2.decay) = (0.312, d3);
            (h.ap2.decay1, h.ap2.decay2) = (d1, d2);
            (h.ap3.decay1, h.ap3.decay2, h.ap3.decay3) = (d1, d1, d2);
        }
        // the plugin's Spin and Wander: two slow oscillators, 12 % wander
        let spin2 = (100.0 - (10.0 - spin) * (10.0 - spin)).max(0.0).sqrt() / 2.0;
        let rot = |f: f32| ((2.0 * PI * f / sr).cos(), (2.0 * PI * f / sr).sin());
        self.rot1 = rot(spin);
        self.rot2 = rot(spin2);
        self.wander = 0.12 / 2.0 + 0.1;
    }

    /// Something close to pink noise in −1..1, for the modulation (the source reads a table of
    /// it; this is Paul Kellet's three-pole filter on white noise).
    #[inline]
    fn noise(&mut self) -> f32 {
        self.noise = self.noise.wrapping_mul(1664525).wrapping_add(1013904223);
        let w = (self.noise >> 8) as f32 / 8388608.0 - 1.0;
        self.pink[0] = 0.99765 * self.pink[0] + w * 0.0990460;
        self.pink[1] = 0.96300 * self.pink[1] + w * 0.2965164;
        self.pink[2] = 0.57000 * self.pink[2] + w * 1.0526913;
        ((self.pink[0] + self.pink[1] + self.pink[2] + w * 0.1848) * 0.25).clamp(-1.0, 1.0)
    }

    /// One sample of the voice in, the room's left and right out (wet only).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        let sr = self.sr;
        // the walls: six reflections a side, a little duller than the voice
        let (mut el, mut er) = (0.0, 0.0);
        self.l.early.put(x);
        for k in 0..6 {
            el += ER_L[k].1 * self.l.early.z((ER_L[k].0 * self.rs * sr) as usize + 1);
            er += ER_R[k].1 * self.l.early.z((ER_R[k].0 * self.rs * sr) as usize + 1);
        }
        let el = self.l.early_lp.run(el);
        let er = self.r.early_lp.run(er);

        // the two oscillators (a point going round a circle) and the noise that roughens them
        self.lfo1 = (self.lfo1.0 * self.rot1.0 - self.lfo1.1 * self.rot1.1, self.lfo1.1 * self.rot1.0 + self.lfo1.0 * self.rot1.1);
        self.lfo2 = (self.lfo2.0 * self.rot2.0 - self.lfo2.1 * self.rot2.1, self.lfo2.1 * self.rot2.0 + self.lfo2.0 * self.rot2.1);
        self.renorm += 1;
        if self.renorm >= 10000 {
            self.renorm = 0;
            let n1 = (self.lfo1.0 * self.lfo1.0 + self.lfo1.1 * self.lfo1.1).sqrt();
            let n2 = (self.lfo2.0 * self.lfo2.0 + self.lfo2.1 * self.lfo2.1).sqrt();
            self.lfo1 = (self.lfo1.0 / n1, self.lfo1.1 / n1);
            self.lfo2 = (self.lfo2.0 / n2, self.lfo2.1 / n2);
        }
        let mnoise = self.noise();
        let lfo = self.lfo1_lp.run((self.lfo1.1 + 0.09 * mnoise) * self.wander);
        let mnoise = mnoise * 0.06;

        // a fifth of the early reflections goes into the late part with the voice
        let (mut ol, mut or) = (x + 0.2 * el, x + 0.2 * er);
        let mut sign = -1.0;
        for i in 0..10 {
            ol = self.l.input[i].run(ol, lfo * sign, mnoise);
            or = self.r.input[i].run(or, lfo, mnoise * sign);
            sign = -sign;
        }
        let (mut cl, mut cr) = (ol, or);
        for i in 0..4 {
            cl = self.l.cross[i].run(cl);
            cr = self.r.cross[i].run(cr);
        }
        ol = self.l.lp_in.run(ol + 0.4 * cr);
        or = self.r.lp_in.run(or + 0.4 * cl);

        // the end of each side feeds the start of the other, the lows a little more than the rest
        let (back_r, back_l) = (self.r.d_d.oldest(), self.l.d_d.oldest());
        ol += self.loop_decay * (back_r + self.bass * self.l.bass_lp.run(self.l.bass_ap.run(back_r)));
        or += self.loop_decay * (back_l + self.bass * self.r.bass_lp.run(self.r.bass_ap.run(back_l)));

        let v = self.l.damp.run(ol);
        let v = self.l.m1.run(v, lfo, mnoise);
        let v = self.l.d_a.process(v);
        let v = self.l.m2.run(v, -lfo, -mnoise);
        let v = self.l.d_b.process(v);
        let v = self.l.ap2.run(v);
        let v = self.l.d_c.process(v);
        let v = self.l.ap3.run(v, lfo);
        self.l.d_d.put(v);

        let v = self.r.damp.run(or);
        let v = self.r.m1.run(v, -lfo, -mnoise);
        let v = self.r.d_a.process(v);
        let v = self.r.m2.run(v, lfo, mnoise);
        let v = self.r.d_b.process(v);
        let v = self.r.ap2.run(v);
        let v = self.r.d_c.process(v);
        let v = self.r.ap3.run(v, -lfo);
        self.r.d_d.put(v);

        // the outputs: taps from all round the loop, exactly as the source reads them
        let (t, t2) = (&self.t, &self.t2);
        let (l, r) = (&self.l, &self.r);
        let dout = 0.469 * l.d_b.z(t[8])
            + 0.219 * (l.d_c.z(t[7]) - r.d_c.z(t[9]) + l.d_c.z(t[0]) - r.d_b.z(t2[0]) - r.d_c.z(t[1]))
            + 0.064 * (l.d_d.z(t[10]) + l.ap2.b1.z(t2[4]) + l.ap2.b2.z(t2[6]) - r.ap2.b2.z(t2[8]) + l.ap3.z1(t2[10]) + l.ap3.b2.z(t2[12]) + l.ap3.b3.z(t2[14]) - r.ap3.b2.z(t2[18]))
            + 0.045 * l.d_d.z(t2[16]);
        let bout = 0.469 * r.d_b.z(t[2])
            + 0.219 * (r.d_c.z(t[1]) - l.d_c.z(t[3]) + r.d_c.z(t[5]) - l.d_d.z(t[6]) - l.d_b.z(t2[1]) - l.d_c.z(t2[3]))
            + 0.064 * (r.d_d.z(t[4]) + r.ap2.b1.z(t2[5]) + r.ap2.b2.z(t2[7]) - l.ap2.b2.z(t2[9]) + r.ap3.z1(t2[11]) + r.ap3.b2.z(t2[13]) + r.ap3.b3.z(t2[15]) - l.ap3.b2.z(t2[19]))
            + 0.045 * r.d_d.z(t2[17]);

        // a slow echo of itself 22 ms later, swelling on one side as it fades on the other
        let lfo2 = self.lfo2_lp.run(self.lfo2.1 * self.wander);
        let yl = self.l.comb.oldest() * lfo2 + dout;
        self.l.comb.put(dout);
        let yr = self.r.comb.oldest() * -lfo2 + bout;
        self.r.comb.put(bout);
        let (yl, yr) = (self.l.out_lp.run(yl), self.r.out_lp.run(yr));
        // the plugin's own balance: early 10, late 20
        (0.1 * el + 0.2 * yl, 0.1 * er + 0.2 * yr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    #[test]
    fn lengths_match_the_sources_arithmetic() {
        // freeverb3's own sizes at 48 kHz for a 10 m and a 12 m room
        assert_eq!(IN_L.map(|n| p_(n, 48000.0 / REF)), [877, 757, 613, 491, 307, 227, 211, 173, 157, 107]);
        assert_eq!(IN_R.map(|n| p_(n, 48000.0 * 1.2 / REF)), [1019, 929, 709, 617, 401, 277, 239, 223, 191, 137]);
        assert_eq!(CROSS_L.map(|n| p_(n, 48000.0 / REF)), [607, 479, 373, 251]);
        assert_eq!([2.0, 1055.0, 344.0, 1572.0].map(|n| p_(n, 48000.0 / REF)), [2, 1483, 487, 2213]);
        assert_eq!([1.0, 1460.0, 500.0, 16.0].map(|n| p_(n, 48000.0 / REF)), [1, 2053, 709, 23]);
        assert_eq!((p_(32.0, 48000.0 / REF), p_(10.0, 48000.0 / REF), p_(22.0, 48.0)), (47, 17, 1061));
        assert_eq!(IDX.map(|n| f_(n, 48000.0 / REF)), [388, 658, 879, 438, 11, 33, 50, 56, 1, 270, 2211]);
    }

    /// The energy in each 50 ms after a short burst of noise.
    fn tail(size: f32, sr: f32, seconds: f32) -> (Vec<f64>, f64) {
        let mut room = Room::new(sr);
        room.set(size, 0.3);
        let mut seed = 12345u32;
        let win = (sr * 0.05) as usize;
        let (mut out, mut acc, mut cross) = (vec![], 0.0f64, 0.0f64);
        for i in 0..(sr * seconds) as usize {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let x = if i < (sr * 0.05) as usize { (seed >> 8) as f32 / 8388608.0 - 1.0 } else { 0.0 };
            let (l, r) = room.run(x * 0.5);
            assert!(l.is_finite() && r.is_finite());
            acc += (l * l + r * r) as f64;
            cross += (l * r) as f64;
            if (i + 1) % win == 0 {
                out.push(acc);
                acc = 0.0;
            }
        }
        let all: f64 = out.iter().sum();
        (out, cross / all * 2.0)
    }

    #[test]
    fn it_is_dense_at_once_short_and_wide() {
        let (e, corr) = tail(0.5, SR, 3.0);
        assert!(e[0] > 0.0 && e[1] > e[0] * 0.01, "it starts at once");
        // a medium room is all but gone within a second and a half
        assert!(e[29] < e[1] * 1e-4, "{} vs {}", e[29], e[1]);
        assert!(corr.abs() < 0.5, "left and right differ: {corr}");
    }

    #[test]
    fn a_bigger_room_rings_longer() {
        let after = |size: f32| {
            let (e, _) = tail(size, SR, 2.0);
            e[10..].iter().sum::<f64>() / e.iter().sum::<f64>()
        };
        assert!(after(1.0) > after(0.0) * 4.0, "{} vs {}", after(1.0), after(0.0));
    }

    #[test]
    fn it_dies_away_at_every_size_and_rate() {
        for sr in [44100.0, 48000.0, 96000.0] {
            for size in [0.0, 0.37, 1.0] {
                let (e, _) = tail(size, sr, 6.0);
                assert!(e[119] < e[1] * 1e-6, "{sr} Hz, size {size}: {} of {}", e[119], e[1]);
            }
        }
    }

    #[test]
    fn turning_the_size_knob_while_it_rings_is_safe() {
        let mut room = Room::new(SR);
        let mut seed = 1u32;
        for i in 0..96000 {
            if i % 4800 == 0 {
                room.set((i / 4800) as f32 / 20.0, 0.5);
            }
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let (l, r) = room.run(((seed >> 8) as f32 / 8388608.0 - 1.0) * 0.5);
            assert!(l.is_finite() && r.is_finite() && l.abs() < 4.0 && r.abs() < 4.0);
        }
    }
}

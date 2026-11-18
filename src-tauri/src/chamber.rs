//! An echo chamber: dense from the first instant, bright, with no walls to pick out.
//!
//! No open reverb models a real chamber, so this is the open design that behaves most like one:
//! freeverb3's "nrevb" by Teru Kamogashira (GPL-2.0-or-later), as its author wrote it (a
//! descendant of the classic Schroeder/Moorer design of CCRMA's NRev). The voice feeds eighteen
//! combs side by side, each a delay that feeds back on itself and loses a little treble every
//! time; their sum, with the voice itself, is smeared by six all-passes in a row, softened, and
//! smeared by two more. The whole network sits inside one more all-pass. Because the combs are
//! in parallel there is no single loop time and no early pattern: the voice comes through the
//! all-passes at once, and the combs fill in behind it within a tenth of a second.
//!
//! Lengths are the source's (samples at 25641 Hz), scaled and rounded up to primes; the right
//! side is a little longer than the left throughout, which is all its stereo is.

use crate::dsp::OnePole;

const REF: f32 = 25641.0;
const COMBS: [f32; 18] = [1433.0, 1601.0, 1867.0, 2053.0, 2251.0, 2399.0, 1257.0, 1333.0, 1499.0, 1501.0, 1535.0, 1637.0, 1738.0, 1904.0, 1999.0, 2020.0, 2120.0, 2509.0];
/// the all-passes in the order the voice meets them: 347, 113, 37, then 57, 87, 103, then
/// (after the softening) 59 and a last one (43 on the left, 37 on the right)
const APS: [f32; 8] = [347.0, 113.0, 37.0, 57.0, 87.0, 103.0, 59.0, 43.0];
const SPREAD: f32 = 13.0;

fn prime_up(mut n: usize) -> usize {
    let is_prime = |n: usize| n < 4 || (n % 2 != 0 && (3..).step_by(2).take_while(|k| k * k <= n).all(|k| n % k != 0));
    while !is_prime(n) {
        n += 1;
    }
    n
}

#[derive(Clone, Debug)]
struct Comb {
    buf: Vec<f32>,
    i: usize,
    store: f32,
    fb: f32,
}
impl Comb {
    fn new(n: usize) -> Self {
        Comb { buf: vec![0.0; n], i: 0, store: 0.0, fb: 0.0 }
    }
    #[inline]
    fn run(&mut self, x: f32, damp: f32) -> f32 {
        let out = self.buf[self.i];
        self.store = out * (1.0 - damp) + self.store * damp;
        self.buf[self.i] = x + self.store * self.fb;
        self.i += 1;
        if self.i >= self.buf.len() {
            self.i = 0;
        }
        out
    }
}

#[derive(Clone, Debug)]
struct Ap {
    buf: Vec<f32>,
    i: usize,
}
impl Ap {
    fn new(n: usize) -> Self {
        Ap { buf: vec![0.0; n], i: 0 }
    }
    #[inline]
    fn run(&mut self, x: f32, fb: f32) -> f32 {
        let z = self.buf[self.i];
        let v = x + fb * z;
        self.buf[self.i] = v;
        self.i += 1;
        if self.i >= self.buf.len() {
            self.i = 0;
        }
        z - fb * v
    }
}

#[derive(Clone, Debug)]
struct Side {
    combs: Vec<Comb>,
    aps: Vec<Ap>,
    lp: f32,
    last: f32,
    tone: OnePole,
}

pub struct Chamber {
    sr: f32,
    l: Side,
    r: Side,
    hpf: f32,
    damp: f32,
    /// the softening between the all-passes, as a per-sample coefficient
    soft: f32,
}

impl Chamber {
    pub fn new(sr: f32) -> Self {
        let k = sr / REF;
        let spread = (SPREAD * k) as usize;
        let side = |extra: usize, last: f32| Side {
            combs: COMBS.iter().map(|&n| Comb::new(prime_up((n * k) as usize + extra))).collect(),
            aps: APS.iter().enumerate().map(|(i, &n)| Ap::new(prime_up(((if i == 7 { last } else { n }) * k) as usize + if i == 7 { 0 } else { extra }))).collect(),
            lp: 0.0,
            last: 0.0,
            tone: OnePole::default(),
        };
        // (the source takes the right side's last all-pass, 37, from the left side's table)
        let mut c = Chamber { sr, l: side(0, 43.0), r: side(spread, 37.0), hpf: 0.0, damp: 0.1, soft: 0.5 };
        c.set(0.5, 0.3);
        c
    }

    /// How long it rings (0..1: 0.6 to 2 seconds; longer and combs begin to sound like metal)
    /// and how dark (0..1).
    pub fn set(&mut self, size: f32, tone: f32) {
        let (size, tone) = (size.clamp(0.0, 1.0), tone.clamp(0.0, 1.0));
        let rt60 = 0.6 + 1.4 * size;
        for side in [&mut self.l, &mut self.r] {
            for c in side.combs.iter_mut() {
                c.fb = 10f32.powf(-3.0 * c.buf.len() as f32 / (rt60 * self.sr));
            }
            // it is the brightest reverb there is: the return is rolled off, more when darker
            side.tone.tune(12000.0 - 7500.0 * tone, self.sr);
        }
        // the treble each comb loses per trip (the source's 0.1, up to 0.4), and the softening
        // (the source's 0.5 at 48 kHz), both kept the same at any sample rate
        let per_rate = |c: f32| c.powf(48000.0 / self.sr);
        self.damp = per_rate(0.05 + 0.35 * tone);
        self.soft = per_rate(0.5);
    }

    /// One sample of the voice in, the chamber's left and right out (wet only).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        // the source's first filter: it leans the input towards the top
        self.hpf = 0.5 * x - 0.5 * self.hpf;
        let (h, damp, soft) = (self.hpf, self.damp, self.soft);
        let mut out = [0.0f32; 2];
        for (k, side) in [&mut self.l, &mut self.r].into_iter().enumerate() {
            // the whole network sits where the delay of one more all-pass would be
            let v = h + 0.2 * side.last;
            let y = side.last - 0.2 * v;
            let mut s = v;
            for c in side.combs.iter_mut() {
                s += c.run(h, damp);
            }
            for a in side.aps[..6].iter_mut() {
                s = a.run(s, 0.5);
            }
            side.lp = soft * side.lp + (1.0 - soft) * s;
            let mut s = side.lp;
            for a in side.aps[6..].iter_mut() {
                s = a.run(s, 0.5);
            }
            side.last = if s.abs() < 1e-20 { 0.0 } else { s };
            out[k] = side.tone.run(y) * 0.05;
        }
        (out[0], out[1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    fn tail(size: f32, sr: f32, seconds: f32) -> (Vec<f64>, f64) {
        let mut c = Chamber::new(sr);
        c.set(size, 0.3);
        let mut seed = 12345u32;
        let win = (sr * 0.05) as usize;
        let (mut out, mut acc, mut cross) = (vec![], 0.0f64, 0.0f64);
        for i in 0..(sr * seconds) as usize {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let x = if i < (sr * 0.05) as usize { (seed >> 8) as f32 / 8388608.0 - 1.0 } else { 0.0 };
            let (l, r) = c.run(x * 0.5);
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
    fn it_is_there_at_once_and_decays_as_long_as_asked() {
        let (e, _) = tail(0.3, SR, 4.0);
        // the voice comes through the all-passes at once; the combs join it 50 to 100 ms later
        assert!(e[0] > 0.0);
        let peak = e.iter().cloned().fold(0.0, f64::max);
        assert!(e[..4].contains(&peak), "at its loudest within the first 200 ms");
        // 1.02 s for 60 dB: 30 dB down (a thousandth of the energy) after about half a second
        let at = e.iter().position(|v| *v < e[1] * 1e-3).unwrap() as f32 * 0.05;
        assert!(at > 0.3 && at < 0.9, "30 dB down after {at} s");
        assert!(e[79] < e[1] * 1e-9);
    }

    #[test]
    fn the_knob_makes_it_longer_and_it_always_dies_away() {
        for sr in [44100.0, 48000.0, 96000.0] {
            let late = |size: f32| {
                let (e, _) = tail(size, sr, 6.0);
                assert!(e[119] < e[1] * 1e-7, "{sr} Hz, size {size}");
                e[10..].iter().sum::<f64>() / e.iter().sum::<f64>()
            };
            assert!(late(1.0) > late(0.0) * 3.0);
        }
    }

    #[test]
    fn left_and_right_differ() {
        let (_, corr) = tail(0.5, SR, 2.0);
        assert!(corr.abs() < 0.6, "{corr}");
    }
}

//! A spring: the splashy, boingy reverb of a guitar amplifier, for surf, dub, rockabilly and
//! lo-fi vocals. It is not a room at all: a spring carries some notes faster than others, so
//! every echo arrives smeared, with the drip and boing that no room has.
//!
//! This follows the spring reverb Jatin Chowdhury wrote for Surge XT and BYOD (GPL-3.0-or-later),
//! itself "based loosely" on Välimäki, Parker and Abel's parametric spring. The voice, gently
//! overdriven, goes through sixteen all-passes (each with another inside it) that do the
//! smearing; what comes out goes back through sixteen more, down a long delay, and round
//! again. Four further echoes stand for the reflections along the wire. Like a real spring tank
//! it is one channel: the same on both sides.
//!
//! Differences from the source: the all-pass delays are whole samples (they only need to be
//! fractional while the size is moving, and here it is not), and the long delay's fixed part is
//! a time (20.8 ms) rather than 1000 samples, so it sounds the same at any sample rate.

use crate::dsp::{Biquad, Shape};

const STAGES: usize = 16;
/// the source's Size, fixed at its default
const SIZE: f32 = 0.5;

#[derive(Clone, Debug)]
struct Delay {
    buf: Vec<f32>,
    i: usize,
}
impl Delay {
    fn new(n: usize) -> Self {
        Delay { buf: vec![0.0; n.max(1)], i: 0 }
    }
    #[inline]
    fn pop(&self) -> f32 {
        self.buf[self.i]
    }
    #[inline]
    fn push(&mut self, x: f32) {
        self.buf[self.i] = if x.abs() < 1e-20 { 0.0 } else { x };
        self.i += 1;
        if self.i >= self.buf.len() {
            self.i = 0;
        }
    }
}

/// An all-pass with another inside its delay (the source's `SchroederAllpass`, order 2).
#[derive(Clone, Debug)]
struct Nested {
    outer: Delay,
    inner: Delay,
}
impl Nested {
    #[inline]
    fn run(&mut self, x: f32, g: f32) -> f32 {
        let v = self.outer.pop();
        let d2 = self.inner.pop();
        let v = v + g * d2;
        self.inner.push(v);
        let d = d2 - g * v;
        let x = x + g * d;
        self.outer.push(x);
        d - g * x
    }
}

pub struct Spring {
    sr: f32,
    main: Vec<Nested>,
    back: Vec<Nested>,
    long: Delay,
    hp: Biquad,
    lp: Biquad,
    refl: [Delay; 4],
    refl_gain: [f32; 4],
    shelf_lo: f32,
    shelf_hi: f32,
    shelf_a: f32,
    last: f32,
    fb: f32,
    damping: f32,
}

impl Spring {
    pub fn new(sr: f32) -> Self {
        let element = ((0.35 + 3.0 * SIZE) * 0.001 * sr).round() as usize;
        let stage = || Nested { outer: Delay::new(element), inner: Delay::new(element) };
        let long = ((0.0208 + SIZE * 0.099) * sr) as usize;
        let mut s = Spring {
            sr,
            main: (0..STAGES).map(|_| stage()).collect(),
            back: (0..STAGES).map(|_| stage()).collect(),
            long: Delay::new(long),
            hp: Biquad::new(Shape::HighPass, 40.0, 0.707, sr),
            lp: Biquad::new(Shape::LowPass, 8485.0, 0.707, sr),
            refl: [0.07, 0.17, 0.23, 0.29].map(|t| Delay::new((t * SIZE * sr) as usize)),
            refl_gain: [0.0; 4],
            shelf_lo: 0.0,
            shelf_hi: 1.0,
            shelf_a: (-2.0 * std::f32::consts::PI * 800.0 / sr).exp(),
            last: 0.0,
            fb: 0.3,
            damping: -1.0,
        };
        s.set(0.5, 0.3);
        s
    }

    /// How long it rings (0..1) and how dark (0..1).
    pub fn set(&mut self, size: f32, tone: f32) {
        let (decay, damping) = (0.2 + 0.7 * size.clamp(0.0, 1.0), 0.2 + 0.6 * tone.clamp(0.0, 1.0));
        let t60 = 0.5 * 9f32.powf(0.95 * decay - 0.7 * (1.0 - SIZE * SIZE));
        self.fb = 0.001f32.powf(self.long.buf.len() as f32 / (t60 * self.sr));
        // the reflections along the wire: each fades with its length, all at the source's level
        let level = 0.23 * 0.95 * (0.735 + 0.235 * SIZE);
        for k in 0..4 {
            self.refl_gain[k] = 0.001f32.powf(self.refl[k].buf.len() as f32 / (t60 * self.sr)) * level;
        }
        if (damping - self.damping).abs() > 1e-4 {
            self.damping = damping;
            self.lp.set(Shape::LowPass, 4000.0 * 4.5f32.powf(1.0 - damping), 0.707, self.sr);
            self.shelf_hi = 10f32.powf((-1.0 - 9.0 * damping) / 20.0);
        }
    }

    /// One sample of the voice in, the spring out (the same on both sides, as from a real tank).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        // spin at its default: the main lane's all-passes at +0.3, the returning lane's at −0.3
        const G: f32 = 0.3;
        let mut m = self.hp.run((x - self.fb * self.long.pop()).tanh());
        let mut b = self.last;
        for k in 0..STAGES {
            m = self.main[k].run(m, G);
            b = self.back[k].run(b, -G);
        }
        self.long.push(b);
        // the four reflections, mixed so that each hears the others (a Householder mix), then dulled
        let o = [self.refl[0].pop(), self.refl[1].pop(), self.refl[2].pop(), self.refl[3].pop()];
        let sum = o[0] + o[1] + o[2] + o[3];
        let mut r = 0.0;
        for k in 0..4 {
            r += (o[k] - 0.5 * sum) * self.refl_gain[k];
        }
        let r = r * 0.25;
        self.shelf_lo = r * (1.0 - self.shelf_a) + self.shelf_lo * self.shelf_a;
        let r = self.shelf_lo + (r - self.shelf_lo) * self.shelf_hi;
        m -= r;
        for d in self.refl.iter_mut() {
            d.push(m);
        }
        let y = self.lp.run(m);
        self.last = y;
        (y, y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    #[test]
    fn its_parts_are_the_sources_at_the_default_settings() {
        let s = Spring::new(SR);
        // 1.85 ms all-pass elements, a 70.3 ms long delay, reflections at 35 / 85 / 115 / 145 ms
        assert_eq!(s.main[0].outer.buf.len(), 89);
        assert!((s.long.buf.len() as f32 / SR - 0.0703).abs() < 0.0002);
        assert_eq!(s.refl.iter().map(|d| (d.buf.len() as f32 / 48.0).round() as u32).collect::<Vec<_>>(), [35, 85, 115, 145]);
    }

    #[test]
    fn a_click_comes_out_smeared() {
        // the chain of all-passes spreads a single click over tens of milliseconds
        let mut s = Spring::new(SR);
        let out: Vec<f32> = (0..4800).map(|i| s.run(if i == 0 { 0.5 } else { 0.0 }).0).collect();
        let all: f32 = out.iter().map(|v| v * v).sum();
        let peak = out.iter().map(|v| v * v).fold(0.0, f32::max);
        assert!(all > 0.0 && peak < all * 0.2, "the largest sample holds {} of the energy", peak / all);
        let late: f32 = out[960..].iter().map(|v| v * v).sum();
        assert!(late > all * 0.05, "and much of it arrives after 20 ms: {}", late / all);
    }

    #[test]
    fn it_rings_then_dies_away_and_longer_when_asked() {
        for sr in [44100.0, 48000.0, 96000.0] {
            let left = |size: f32| {
                let mut s = Spring::new(sr);
                s.set(size, 0.3);
                let mut seed = 5u32;
                let (mut early, mut late, mut end) = (0.0f64, 0.0f64, 0.0f64);
                let n = (sr * 10.0) as usize;
                for i in 0..n {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    let x = if i < (sr * 0.05) as usize { (seed >> 8) as f32 / 8388608.0 - 1.0 } else { 0.0 };
                    let (l, _) = s.run(x * 0.5);
                    assert!(l.is_finite());
                    if i < (sr * 0.5) as usize {
                        early += (l * l) as f64;
                    } else if i < n - (sr as usize) {
                        late += (l * l) as f64;
                    } else {
                        end += (l * l) as f64;
                    }
                }
                assert!(early > 0.0 && end < early * 1e-6, "{sr} Hz, {size}: {end} of {early}");
                late / early
            };
            assert!(left(1.0) > left(0.0) * 3.0);
        }
    }
}

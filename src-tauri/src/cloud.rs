//! A cloud: a wash that arrives a moment after the voice and hangs behind it, always moving.
//!
//! This is the design of Cloud Seed by Valdemar Erlingsson (CloudSeedCore, MIT; Ghost Note
//! Audio), set up as its "Dark Plate" program. Each side has twelve delays that feed back only
//! on themselves, of unrelated lengths; inside every loop are four all-passes that smear each
//! trip into the next, and a filter that takes a little treble each time. Every delay and every
//! all-pass drifts slowly at its own rate, so the tail never settles on a note. Left and right
//! share nothing but the voice, which is why it is so wide.
//!
//! The lengths come from the program's seeds through the same small random-number generator as
//! the original, so the delays are the ones its author chose. Unlike the original, each loop is
//! exactly as long as its delay (there, the host's buffer is added to it) and the memory is only
//! as large as the delays need.

use crate::dsp::{Biquad, OnePole, Shape};
use std::f32::consts::PI;

/// "Dark Plate", in units: twelve lines around 96 ms; four all-passes of up to 31.6 ms in each.
const LINE_MS: f32 = 96.08;
const LINE_MOD_MS: f32 = 0.68;
const LINE_MOD_HZ: f32 = 0.0947;
const AP_MS: f32 = 31.6;
const AP_FB: f32 = 0.8507;
const AP_MOD_MS: f32 = 0.367;
const AP_MOD_HZ: f32 = 0.0583;
const SHELF_HZ: f32 = 4518.0;
const LOW_CUT_HZ: f32 = 340.0;
const SEED_DELAY: u32 = 218;
const SEED_POST: u32 = 365;
const LINES: usize = 12;
const STAGES: usize = 4;

/// Cloud Seed's generator: `count` numbers in 0..1 from a seed. `cross` blends the series with
/// the one from the inverted seed (its left side is the one, its right the other).
fn random(seed: u32, count: usize, cross: f32) -> Vec<f32> {
    let series = |mut x: u32| -> Vec<f32> {
        (0..count)
            .map(|_| {
                x = x.wrapping_mul(22695477).wrapping_add(1);
                x as f32 / u32::MAX as f32
            })
            .collect()
    };
    let (a, b) = (series(seed), series(!seed));
    a.iter().zip(&b).map(|(a, b)| a * (1.0 - cross) + b * cross).collect()
}

/// A delay read at a slowly moving point (straight line between two samples, as the source).
#[derive(Clone, Debug)]
struct Moving {
    buf: Vec<f32>,
    w: usize,
    delay: f32,
    amount: f32,
    phase: f32,
    step: f32,
    now: f32,
}
impl Moving {
    fn new(delay: f32, amount: f32, hz: f32, phase: f32, sr: f32) -> Self {
        let amount = amount.min(delay - 2.0).max(0.0);
        Moving { buf: vec![0.0; (delay + amount) as usize + 4], w: 0, delay, amount, phase, step: hz / sr, now: delay }
    }
    /// Every eighth sample the reading point moves on (it moves far too slowly to need more).
    #[inline]
    fn drift(&mut self) {
        self.phase += self.step * 8.0;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        self.now = self.delay + self.amount * (2.0 * PI * self.phase).sin();
    }
    #[inline]
    fn read(&self) -> f32 {
        let n = self.buf.len();
        let i = self.now as usize;
        let f = self.now - i as f32;
        let a = self.buf[(self.w + n - i) % n];
        let b = self.buf[(self.w + n - i - 1) % n];
        a + (b - a) * f
    }
    #[inline]
    fn write(&mut self, x: f32) {
        self.buf[self.w] = if x.abs() < 1e-20 { 0.0 } else { x };
        self.w += 1;
        if self.w >= self.buf.len() {
            self.w = 0;
        }
    }
}

struct LineOf {
    delay: Moving,
    aps: Vec<Moving>,
    shelf: Biquad,
    fb: f32,
    out: f32,
}

struct Side {
    low_cut: OnePole,
    lines: Vec<LineOf>,
}

pub struct Cloud {
    sr: f32,
    sides: [Side; 2],
    tick: u32,
    shelf_db: f32,
    tone: [OnePole; 2],
}

impl Cloud {
    pub fn new(sr: f32) -> Self {
        let ms = |t: f32| t * 0.001 * sr;
        // (the source cuts its two base lengths to whole samples before scaling them)
        let (line, stage) = (ms(LINE_MS).floor(), ms(AP_MS).floor());
        // the source starts its oscillators at random points; here they are spread by one more series
        let phases = random(977, 2 * LINES * (STAGES + 1), 0.0);
        let side = |cross: f32, which: usize| {
            let r = random(SEED_DELAY, 36, cross);
            let lines = (0..LINES)
                .map(|i| {
                    let amount = ms(LINE_MOD_MS) * (0.7 + 0.3 * r[i]);
                    let hz = LINE_MOD_HZ * (0.7 + 0.3 * r[12 + i]);
                    // (one less than the source's count: there the feedback comes round a sample late)
                    let len = (((0.5 + r[24 + i]) * line) as usize).max(amount as usize + 2) as f32;
                    let q = random(SEED_POST.wrapping_mul(i as u32 + 1), 36, cross);
                    let ph = |k: usize| phases[(which * LINES + i) * (STAGES + 1) + k];
                    let aps = (0..STAGES)
                        .map(|k| {
                            let d = (stage * 10f32.powf(q[k]) * 0.1) as usize as f32;
                            Moving::new(d.max(4.0), ms(AP_MOD_MS) * (0.85 + 0.3 * q[12 + k]), AP_MOD_HZ * (0.85 + 0.3 * q[24 + k]), ph(k + 1), sr)
                        })
                        .collect();
                    LineOf { delay: Moving::new(len - 1.0, amount, hz, ph(0), sr), aps, shelf: Biquad::new(Shape::HighShelf(-4.64), SHELF_HZ, 0.707, sr), fb: 0.0, out: 0.0 }
                })
                .collect();
            Side { low_cut: OnePole::hz(LOW_CUT_HZ, sr), lines }
        };
        // cross seed 0: the left side reads the inverted series, the right the plain one
        let mut c = Cloud { sr, sides: [side(1.0, 0), side(0.0, 1)], tick: 0, shelf_db: 0.0, tone: [OnePole::default(); 2] };
        c.set(0.5, 0.3);
        c
    }

    /// How long it hangs (0..1: its decay setting from 2 to 8 seconds; the smearing makes what
    /// you hear about half as long again) and how dark (0..1).
    pub fn set(&mut self, size: f32, tone: f32) {
        let (size, tone) = (size.clamp(0.0, 1.0), tone.clamp(0.0, 1.0));
        let decay = 2.0 * 4.0f32.powf(size);
        // the program's own shelf is −4.64 dB; brighter and darker lie either side of it
        let db = -2.0 - 7.0 * tone;
        let shelf = (db - self.shelf_db).abs() > 0.01;
        self.shelf_db = db;
        for (k, side) in self.sides.iter_mut().enumerate() {
            for l in side.lines.iter_mut() {
                l.fb = 10f32.powf(-3.0 * (l.delay.delay + 1.0) / (decay * self.sr));
                if shelf {
                    l.shelf.set(Shape::HighShelf(db), SHELF_HZ, 0.707, self.sr);
                }
            }
            self.tone[k].tune(14000.0 - 8000.0 * tone, self.sr);
        }
    }

    /// One sample of the voice in, the cloud's left and right out (wet only).
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        self.tick = self.tick.wrapping_add(1);
        let drift = self.tick % 8 == 0;
        let mut out = [0.0f32; 2];
        for (k, side) in self.sides.iter_mut().enumerate() {
            let v = x - side.low_cut.run(x);
            let mut sum = 0.0;
            for l in side.lines.iter_mut() {
                if drift {
                    l.delay.drift();
                    for a in l.aps.iter_mut() {
                        a.drift();
                    }
                }
                let d = l.delay.read();
                l.delay.write(v + l.fb * l.out);
                let mut s = d;
                for a in l.aps.iter_mut() {
                    let z = a.read();
                    let w = s + z * AP_FB;
                    a.write(w);
                    s = z - w * AP_FB;
                }
                l.out = l.shelf.run(s);
                sum += l.out;
            }
            out[k] = self.tone[k].run(sum) * 0.2887;
        }
        (out[0], out[1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    #[test]
    fn the_generator_and_the_lengths_are_the_originals() {
        let r = random(1, 3, 0.0);
        for (got, want) in r.iter().zip([0.005284203, 0.501993477, 0.667579949]) {
            assert!((got - want).abs() < 1e-6, "{got} vs {want}");
        }
        let right = random(218, 36, 0.0);
        let left = random(218, 36, 1.0);
        for (got, want) in right[24..28].iter().zip([0.023407, 0.651329, 0.044498, 0.716252]) {
            assert!((got - want).abs() < 2e-6, "{got} vs {want}");
        }
        for (got, want) in left[24..28].iter().zip([0.140516, 0.357801, 0.753165, 0.763153]) {
            assert!((got - want).abs() < 2e-6, "{got} vs {want}");
        }
        // the program's line lengths at 48 kHz, as computed from the original
        let c = Cloud::new(SR);
        let lens = |s: &Side| s.lines.iter().map(|l| l.delay.delay as usize + 1).collect::<Vec<_>>();
        assert_eq!(lens(&c.sides[0]), [2953, 3955, 5778, 5824, 6034, 4131, 4926, 2826, 3844, 2620, 3335, 2565]);
        assert_eq!(lens(&c.sides[1]), [2413, 5308, 2510, 5608, 3144, 6816, 4646, 2672, 5953, 4128, 5992, 4202]);
        let stages = |l: &LineOf| l.aps.iter().map(|a| a.delay as usize).collect::<Vec<_>>();
        assert_eq!(stages(&c.sides[0].lines[0]), [176, 245, 1196, 1232]);
        assert_eq!(stages(&c.sides[1].lines[1]), [1091, 607, 363, 462]);
    }

    fn tail(size: f32, sr: f32, seconds: f32) -> (Vec<f64>, f64) {
        let mut c = Cloud::new(sr);
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
    fn it_arrives_late_hangs_for_seconds_and_is_wide() {
        let (e, corr) = tail(0.5, SR, 12.0);
        // nothing for the first 50 ms (the shortest delay), then the wash
        assert!(e[0] < e[2] * 0.2, "late: {} then {}", e[0], e[2]);
        // still clearly there after three seconds, gone in the end
        assert!(e[60] > e[2] * 1e-4, "{} of {}", e[60], e[2]);
        assert!(e[239] < e[60]);
        assert!(corr.abs() < 0.3, "the two sides share nothing: {corr}");
    }

    #[test]
    fn it_dies_away_at_every_length_and_rate() {
        for sr in [44100.0, 96000.0] {
            let (e, _) = tail(1.0, sr, 40.0);
            assert!(e[799] < e[5] * 1e-4, "{sr}: {} of {}", e[799], e[5]);
            let (short, _) = tail(0.0, sr, 12.0);
            assert!(short[239] < short[5] * 1e-5, "{sr}");
        }
    }
}

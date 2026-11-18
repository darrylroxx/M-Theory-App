//! Measuring what a processor does, for the tests: its gain at a frequency, its harmonics.
#![cfg(test)]

use std::f64::consts::PI;

/// Run a sine of `amp` at `freq` through `f` and give back the settled output (the last `n` samples).
pub fn sine_out(sr: f64, freq: f64, amp: f64, n: usize, mut f: impl FnMut(f32) -> f32) -> Vec<f64> {
    let warm = (sr * 0.5) as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..warm + n {
        let x = (amp * (2.0 * PI * freq * i as f64 / sr).sin()) as f32;
        let y = f(x) as f64;
        if i >= warm {
            out.push(y);
        }
    }
    out
}

/// The amplitude of one frequency in a signal (a single-bin Fourier measurement).
pub fn level_at(sr: f64, freq: f64, x: &[f64]) -> f64 {
    let (mut re, mut im) = (0.0, 0.0);
    for (i, v) in x.iter().enumerate() {
        let p = 2.0 * PI * freq * i as f64 / sr;
        re += v * p.cos();
        im += v * p.sin();
    }
    2.0 * (re * re + im * im).sqrt() / x.len() as f64
}

/// Gain in dB of `f` at `freq` (small signal). `n` should hold a whole number of cycles.
pub fn gain_db(sr: f64, freq: f64, f: impl FnMut(f32) -> f32) -> f64 {
    let n = ((sr / freq).round() * 200.0) as usize;
    let freq = sr / (sr / freq).round();
    let out = sine_out(sr, freq, 0.05, n, f);
    20.0 * (level_at(sr, freq, &out) / 0.05).log10()
}

pub fn db(x: f64) -> f64 {
    20.0 * x.max(1e-12).log10()
}

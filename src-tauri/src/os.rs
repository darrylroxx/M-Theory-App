//! Twice the sample rate and back, for the stages that bend the waveform (bending makes new,
//! higher frequencies, and above half the sample rate those fold back as harsh, unmusical
//! tones). The filters are the two-path polyphase half-band IIR design of Laurent de Soras'
//! HIIR library (WTFPL): minimum phase, so the round trip costs about 0.06 ms and nothing
//! rings before a sound. Five coefficients give about 80 dB of rejection with a response flat
//! to 20 kHz at 48 kHz.

/// HIIR designer output for a transition band of 0.0833 (20 kHz to 28 kHz at 96 kHz), 5 coefficients.
const COEFS: [f64; 5] = [0.061090700071086, 0.221065199762536, 0.430463831503146, 0.650964800633457, 0.876656677083713];

#[derive(Clone, Copy, Debug, Default)]
struct Ap {
    x1: f64,
    y1: f64,
}
impl Ap {
    #[inline]
    fn run(&mut self, a: f64, x: f64) -> f64 {
        let y = a * (x - self.y1) + self.x1;
        self.x1 = x;
        self.y1 = y;
        y
    }
}

/// One direction of the half-band filter: the even coefficients form one path, the odd ones the other.
#[derive(Clone, Copy, Debug, Default)]
struct Paths {
    ap: [Ap; 5],
}
impl Paths {
    #[inline]
    fn path0(&mut self, mut x: f64) -> f64 {
        for i in [0, 2, 4] {
            x = self.ap[i].run(COEFS[i], x);
        }
        x
    }
    #[inline]
    fn path1(&mut self, mut x: f64) -> f64 {
        for i in [1, 3] {
            x = self.ap[i].run(COEFS[i], x);
        }
        x
    }
}

/// A 2× oversampler: `up` gives two samples for one, `down` one for two.
#[derive(Clone, Copy, Debug, Default)]
pub struct Half2x {
    u: Paths,
    d: Paths,
}
impl Half2x {
    #[inline]
    pub fn up(&mut self, x: f64) -> (f64, f64) {
        (self.u.path0(x), self.u.path1(x))
    }
    #[inline]
    pub fn down(&mut self, a: f64, b: f64) -> f64 {
        0.5 * (self.d.path0(b) + self.d.path1(a))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    #[test]
    fn up_and_down_again_leaves_the_voice_band_untouched() {
        for f in [100.0, 1000.0, 8000.0, 16000.0, 19000.0] {
            let mut h = Half2x::default();
            let g = gain_db(48000.0, f, |x| {
                let (a, b) = h.up(x as f64);
                h.down(a, b) as f32
            });
            assert!(g.abs() < 0.01, "{f} Hz: {g} dB");
        }
    }

    #[test]
    fn what_would_fold_back_is_removed() {
        // a tone made at the high rate above 28 kHz would fold to below 20 kHz at 48 kHz
        let mut h = Half2x::default();
        let n = 9600;
        let mut out = vec![];
        for i in 0..96000 + n {
            let p = 2.0 * std::f64::consts::PI * 30000.0 / 96000.0;
            let a = (p * (2 * i) as f64).sin();
            let b = (p * (2 * i + 1) as f64).sin();
            let y = h.down(a, b);
            if i >= 96000 {
                out.push(y);
            }
        }
        // 30 kHz at 96 kHz folds to 18 kHz at 48 kHz
        assert!(db(level_at(48000.0, 18000.0, &out)) < -75.0, "{}", db(level_at(48000.0, 18000.0, &out)));
    }

    #[test]
    fn the_round_trip_is_a_few_hundredths_of_a_millisecond() {
        // how late a 1 kHz and a 5 kHz tone come out, from their phase
        for (f, max_us) in [(1000.0, 70.0), (5000.0, 75.0)] {
            let mut h = Half2x::default();
            let sr = 48000.0;
            let n = 4800;
            let (mut re, mut im) = (0.0, 0.0);
            for i in 0..48000 + n {
                let p = 2.0 * std::f64::consts::PI * f * i as f64 / sr;
                let (a, b) = h.up(p.sin());
                let y = h.down(a, b);
                if i >= 48000 {
                    re += y * p.sin();
                    im += y * p.cos();
                }
            }
            let lag = (-im).atan2(re) / (2.0 * std::f64::consts::PI * f) * 1e6;
            assert!(lag > 0.0 && lag < max_us, "{f} Hz: {lag} microseconds");
        }
    }
}

//! The live vocal chain, in the order a voice meets things in a studio:
//! preamp colour → low cut → gate (a gentle expander) → EQ (low shelf, low mid) → fast FET
//! compressor → smooth optical compressor → EQ (presence, air) → de-esser → high cut → width →
//! echo and reverb sends (filtered, and ducked under the voice) → output level → limiter.
//!
//! The de-esser comes after the brightening EQ on purpose: it judges how much of the voice is
//! "s" (not how loud it is), so there it also tames what presence and air add, and the echo and
//! the reverb are fed a voice whose esses are already under control.
//! Nothing looks ahead, so the voice is never delayed (the oversampled colour stages cost
//! about 0.05 ms). Where each part comes from is said in its own module.

use crate::color::{Color, ColorKind};
use crate::delays::{EchoKind, Echoes};
use crate::chamber::Chamber;
use crate::cloud::Cloud;
use crate::dsp::{db_to_gain, Compressor, DeEsser, Expander, Limiter, Line, OnePole, Plate};
use crate::eqm::{Air, Bq};
use crate::room::Room;
use crate::space::{Space, SpaceKind};
use crate::spring::Spring;
use crate::width::{Width, WidthKind};
use serde::{Deserialize, Serialize};

/// The chain's settings, as the page sends them. Amounts are 0..1 unless noted.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct VocalFx {
    pub on: bool,
    /// preamp colour: which, and how much
    pub color: ColorKind,
    pub warmth: f32,
    /// low cut, Hz
    pub lowcut: f32,
    /// quiet parts between phrases turned down (0 = off)
    pub gate: f32,
    /// dB (−12..12), a shelf below `low_freq`: body
    pub low: f32,
    pub low_freq: f32,
    /// the low-mid band: dB (−12..12) at `mud_freq`, as wide as `mid_q` says. (`mud`, from older
    /// sounds, is a cut of up to 5 dB added to it.)
    pub mid: f32,
    pub mid_q: f32,
    pub mud: f32,
    pub mud_freq: f32,
    /// fast compression: catches peaks, adds punch
    pub punch: f32,
    /// slow, smooth compression: evens the level out
    pub smooth: f32,
    pub deess: f32,
    pub deess_freq: f32,
    /// the presence band: dB (−12..12), where (Hz), and how wide
    pub presence: f32,
    pub presence_freq: f32,
    pub presence_q: f32,
    /// dB (−12..12) from the air band's corner (Hz: 10000, 20000 or 40000 are the classic ones)
    pub air: f32,
    pub air_freq: f32,
    /// everything above this is rolled off (Hz; 20000 = off): telephone and lo-fi sounds
    pub highcut: f32,
    /// width: which kind, and how much
    pub width: WidthKind,
    pub double: f32,
    pub echo_type: EchoKind,
    pub echo: f32,
    /// seconds
    pub echo_time: f32,
    pub echo_feedback: f32,
    pub verb_type: SpaceKind,
    pub verb: f32,
    /// 0 short … 1 long
    pub verb_size: f32,
    /// seconds
    pub verb_predelay: f32,
    /// 0 bright … 1 dark
    pub verb_tone: f32,
    /// how far the echo and reverb step back while the voice sings (0 = not at all)
    pub duck: f32,
    /// dB
    pub level: f32,
}
impl Default for VocalFx {
    fn default() -> Self {
        VocalFx {
            on: true, color: ColorKind::Tube, warmth: 0.2, lowcut: 90.0, gate: 0.0, low: 0.0, low_freq: 120.0, mid: 0.0, mid_q: 1.4, mud: 0.3, mud_freq: 320.0, punch: 0.4, smooth: 0.4, deess: 0.4, deess_freq: 6500.0,
            presence: 2.0, presence_freq: 4000.0, presence_q: 0.9, air: 2.0, air_freq: 12000.0, highcut: 20000.0, width: WidthKind::Double, double: 0.0,
            echo_type: EchoKind::Tape, echo: 0.0, echo_time: 0.11, echo_feedback: 0.15, verb_type: SpaceKind::Plate, verb: 0.25, verb_size: 0.5, verb_predelay: 0.03, verb_tone: 0.3, duck: 0.45, level: 0.0,
        }
    }
}

/// What each space's return is multiplied by: plate, room, hall, chamber, cloud, spring, shimmer
/// (measured: see the `levels` test).
const LEVELS: [f32; 7] = [1.0, 8.2, 3.0, 37.0, 1.2, 2.2, 0.94];

pub struct Chain {
    sr: f32,
    fx: VocalFx,
    color: Color,
    lowcut: [Bq; 2],
    gate: Expander,
    low: Bq,
    mud: Bq,
    fet: Compressor,
    deess: DeEsser,
    opto: Compressor,
    presence: Bq,
    air: Air,
    highcut: Bq,
    width: Width,
    echoes: Echoes,
    plate: Plate,
    space: Space,
    room: Room,
    chamber: Chamber,
    cloud: Cloud,
    spring: Spring,
    /// the pre-delay of the spaces that have none of their own
    verb_pre: Line,
    /// the sends' own tone: lows kept out of the echo and the reverb
    send_lo: [OnePole; 2],
    duck: f32,
    limiter: Limiter,
    /// the EQ as it is now and as it is wanted: it glides there, so a preset can be changed mid-note
    /// (low cut, low dB, low Hz, mid dB, mid Hz, mid Q, presence dB, presence Hz, presence Q, air dB, air Hz, high cut)
    eq_now: [f64; 12],
    eq_want: [f64; 12],
    eq_tick: u32,
}

impl Chain {
    pub fn new(sr: f32, fx: &VocalFx) -> Self {
        let mut fet = Compressor::new(sr, -18.0, 4.0, 6.0, 0.0004, 0.08, false, false);
        fet.feedback = true;
        let mut c = Chain {
            sr,
            fx: fx.clone(),
            color: Color::new(sr),
            lowcut: [Bq::default(); 2],
            gate: Expander::new(sr),
            low: Bq::default(),
            mud: Bq::default(),
            fet,
            deess: DeEsser::new(sr, 6500.0),
            opto: Compressor::new(sr, -20.0, 3.0, 8.0, 0.01, 0.06, true, true),
            presence: Bq::default(),
            air: Air::default(),
            highcut: Bq::default(),
            width: Width::new(sr),
            echoes: Echoes::new(sr),
            plate: Plate::new(sr),
            space: Space::new(sr),
            room: Room::new(sr),
            chamber: Chamber::new(sr),
            cloud: Cloud::new(sr),
            spring: Spring::new(sr),
            verb_pre: Line::new((sr * 0.26) as usize),
            send_lo: [OnePole::hz(250.0, sr); 2],
            duck: 0.0,
            limiter: Limiter::new(sr),
            eq_now: [0.0; 12],
            eq_want: [0.0; 12],
            eq_tick: 0,
        };
        c.fx.deess_freq = -1.0;
        c.set(fx);
        // at the start the EQ is simply where it should be
        c.eq_now = c.eq_want;
        c.eq_apply();
        c
    }

    /// New settings, without resetting what is ringing (no clicks while a knob moves).
    pub fn set(&mut self, fx: &VocalFx) {
        let was = std::mem::replace(&mut self.fx, fx.clone());
        self.color.set(fx.color, fx.warmth);
        self.eq_want = [
            fx.lowcut.clamp(20.0, 400.0) as f64,
            fx.low.clamp(-12.0, 12.0) as f64,
            fx.low_freq.clamp(40.0, 600.0) as f64,
            (fx.mid - 5.0 * fx.mud.clamp(0.0, 1.0)).clamp(-12.0, 12.0) as f64,
            fx.mud_freq.clamp(100.0, 2000.0) as f64,
            fx.mid_q.clamp(0.3, 6.0) as f64,
            fx.presence.clamp(-12.0, 12.0) as f64,
            fx.presence_freq.clamp(800.0, 12000.0) as f64,
            fx.presence_q.clamp(0.3, 6.0) as f64,
            fx.air.clamp(-12.0, 12.0) as f64,
            fx.air_freq.clamp(3000.0, 40000.0) as f64,
            if fx.highcut < 18000.0 { fx.highcut.clamp(1500.0, 18000.0) as f64 } else { 20000.0 },
        ];
        // the gate knob moves the level that counts as a gap (−60 … −35 dBFS) and how far gaps
        // are turned down (6 … 18 dB): never to silence
        let g = fx.gate.clamp(0.0, 1.0);
        self.gate.threshold = -60.0 + 25.0 * g;
        self.gate.range = 6.0 + 12.0 * g;
        let p = fx.punch.clamp(0.0, 1.0);
        self.fet.threshold = -6.0 - 22.0 * p;
        self.fet.ratio = 3.0 + 5.0 * p;
        // make-up is fixed by the settings, never by the singing: four fifths of what the
        // compressor takes off a loud passage (−12 dBFS), which keeps the voice about as loud
        self.fet.makeup = -self.fet.curve(-12.0) * 0.8;
        if (was.deess_freq - fx.deess_freq).abs() > 1.0 {
            self.deess = DeEsser::new(self.sr, fx.deess_freq.clamp(3000.0, 10000.0));
        }
        self.deess.amount = fx.deess.clamp(0.0, 1.0);
        let s = fx.smooth.clamp(0.0, 1.0);
        self.opto.threshold = -8.0 - 20.0 * s;
        self.opto.ratio = 2.0 + 2.0 * s;
        self.opto.makeup = -self.opto.curve(-12.0) * 0.8;
        self.width.kind = fx.width;
        self.echoes.set(fx.echo_type, fx.echo_time, fx.echo_feedback);
        // only the space in use is set up (a room is rebuilt when its size changes)
        let (size, tone) = (fx.verb_size.clamp(0.0, 1.0), fx.verb_tone.clamp(0.0, 1.0));
        match fx.verb_type {
            SpaceKind::Plate | SpaceKind::Shimmer => {
                let shimmer = fx.verb_type == SpaceKind::Shimmer;
                // a shimmer wants a longer tail to climb in
                self.plate.decay = if shimmer { 0.5 + 0.42 * size } else { 0.3 + 0.62 * size };
                self.plate.shimmer = if shimmer { 0.4 } else { 0.0 };
                self.plate.predelay = fx.verb_predelay.clamp(0.0, 0.2);
                self.plate.set_damping(tone);
            }
            SpaceKind::Hall => {
                self.space.set(size, tone);
                self.space.predelay = fx.verb_predelay.clamp(0.0, 0.2);
            }
            SpaceKind::Room => self.room.set(size, tone),
            SpaceKind::Chamber => self.chamber.set(size, tone),
            SpaceKind::Cloud => self.cloud.set(size, tone),
            SpaceKind::Spring => self.spring.set(size, tone),
        }
    }

    /// The EQ's filters, from where its settings are right now.
    fn eq_apply(&mut self) {
        let sr = self.sr as f64;
        let e = self.eq_now;
        // a 4th-order Butterworth low cut, as two sections
        self.lowcut[0].highpass(e[0], 0.54, sr);
        self.lowcut[1].highpass(e[0], 1.31, sr);
        self.low.lowshelf(e[2], e[1], sr);
        self.mud.bell(e[4], e[5], e[3], sr);
        self.presence.bell(e[7], e[8], e[6], sr);
        self.air.set(e[10], e[9], sr);
        if e[11] < 18000.0 {
            self.highcut.lowpass(e[11], 0.7071, sr);
        } else {
            self.highcut.flat();
        }
    }
    /// Every 16 samples the EQ moves a step towards where it is wanted (most of the way in 10 ms).
    #[inline]
    fn eq_glide(&mut self) {
        self.eq_tick = self.eq_tick.wrapping_add(1);
        if self.eq_tick % 16 != 0 || self.eq_now == self.eq_want {
            return;
        }
        let step = 1.0 - (-16.0 / (0.004 * self.sr as f64)).exp();
        for k in 0..12 {
            let d = self.eq_want[k] - self.eq_now[k];
            // frequencies move in proportion, decibels in decibels; close enough is there
            let near = if matches!(k, 0 | 2 | 4 | 7 | 10 | 11) { self.eq_want[k] * 0.002 } else { 0.01 };
            self.eq_now[k] = if d.abs() < near { self.eq_want[k] } else { self.eq_now[k] + d * step };
        }
        self.eq_apply();
    }

    /// How much the compressors are turning the voice down right now (dB, ≥ 0), for a meter.
    pub fn reduction(&self) -> f32 {
        -(self.fet.reduction() + self.opto.reduction())
    }
    /// How much the limiter at the very end is holding back (dB, ≥ 0). It should rest at 0:
    /// if it works often, the level going in is too high.
    pub fn limiting(&self) -> f32 {
        self.limiter.reduction()
    }

    /// One sample of the voice in, left and right out.
    #[inline]
    pub fn run(&mut self, x: f32) -> (f32, f32) {
        if !self.fx.on {
            return (x, x);
        }
        self.eq_glide();
        let v = self.color.run(x) as f64;
        let v = self.lowcut[0].run(v);
        let mut v = self.lowcut[1].run(v) as f32;
        if self.fx.gate > 0.0 {
            v = self.gate.run(v);
        }
        let w = self.low.run(v as f64);
        v = self.mud.run(w) as f32;
        if self.fx.punch > 0.0 {
            v = self.fet.run(v);
        }
        if self.fx.smooth > 0.0 {
            v = self.opto.run(v);
        }
        let w = self.presence.run(v as f64);
        let w = self.air.run(w);
        let w = self.deess.run(w as f32);
        let v = self.highcut.run(w as f64) as f32;
        let mut l = v;
        let mut r = v;
        if self.fx.double > 0.0 {
            let (a, b) = self.width.run(v);
            l += a * self.fx.double;
            r += b * self.fx.double;
        }
        // the echo and the reverb step back while the voice is singing, and bloom in the gaps
        let a = v.abs();
        self.duck = if a > self.duck { self.duck + (a - self.duck) * 0.01 } else { self.duck * 0.99995 };
        let duck = 1.0 - self.fx.duck.clamp(0.0, 0.9) * (self.duck * 4.0).min(1.0);
        let mut to_verb = v * self.fx.verb * 0.7;
        if self.fx.echo > 0.0 {
            let (el, er) = self.echoes.run(v * self.fx.echo);
            l += el * duck;
            r += er * duck;
            // the repeats go into the room too, as they would in one
            to_verb += 0.25 * (el + er) * self.fx.verb;
        }
        if self.fx.verb > 0.0 {
            let (pl, pr) = self.space_run(to_verb);
            // the return's lows are kept out of the mix (they only make mud)
            l += (pl - self.send_lo[0].run(pl)) * duck;
            r += (pr - self.send_lo[1].run(pr)) * duck;
        }
        let g = db_to_gain(self.fx.level.clamp(-24.0, 12.0));
        self.limiter.run(l * g, r * g)
    }

    /// The reverb in use: one sample of the send in, left and right back. Each space is scaled
    /// so that, at the middle of its size knob, a sung phrase comes back about as loud from any
    /// of them (a long one therefore starts quieter, as it should).
    #[inline]
    fn space_run(&mut self, x: f32) -> (f32, f32) {
        let kind = self.fx.verb_type;
        let (l, r, g) = match kind {
            SpaceKind::Plate => {
                let (l, r) = self.plate.run(x);
                (l, r, LEVELS[0])
            }
            SpaceKind::Shimmer => {
                let (l, r) = self.plate.run(x);
                (l, r, LEVELS[6])
            }
            SpaceKind::Hall => {
                let (l, r) = self.space.run(x);
                (l, r, LEVELS[2])
            }
            _ => {
                self.verb_pre.push(x);
                let x = self.verb_pre.at((self.fx.verb_predelay.clamp(0.0, 0.2) * self.sr).max(1.0));
                match kind {
                    SpaceKind::Room => {
                        let (l, r) = self.room.run(x);
                        (l, r, LEVELS[1])
                    }
                    SpaceKind::Chamber => {
                        let (l, r) = self.chamber.run(x);
                        (l, r, LEVELS[3])
                    }
                    SpaceKind::Cloud => {
                        let (l, r) = self.cloud.run(x);
                        (l, r, LEVELS[4])
                    }
                    _ => {
                        let (l, r) = self.spring.run(x);
                        (l, r, LEVELS[5])
                    }
                }
            }
        };
        (l * g, r * g)
    }

    /// A whole take through the chain at once. (The app streams a recording through `run`
    /// instead, a block at a time; this is what that must match, sample for sample.)
    #[cfg(test)]
    pub fn render(&mut self, dry: &[f32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(dry.len() * 2);
        for &x in dry {
            let (l, r) = self.run(x);
            out.push(l);
            out.push(r);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    fn voice(n: usize) -> Vec<f32> {
        // a sung vowel: a few harmonics of 220 Hz, coming and going
        (0..n)
            .map(|i| {
                let t = i as f32 / SR;
                let env = (0.5 + 0.5 * (t * 1.3).sin()).powi(2);
                env * 0.4 * ((2.0 * std::f32::consts::PI * 220.0 * t).sin() + 0.5 * (2.0 * std::f32::consts::PI * 440.0 * t).sin() + 0.25 * (2.0 * std::f32::consts::PI * 660.0 * t).sin())
            })
            .collect()
    }

    #[test]
    fn the_default_chain_is_stable_and_never_clips() {
        let mut c = Chain::new(SR, &VocalFx::default());
        let out = c.render(&voice(SR as usize * 3));
        assert!(out.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        assert!(out.iter().map(|v| v.abs()).fold(0.0, f32::max) > 0.05, "the voice comes through");
    }

    #[test]
    fn every_knob_at_its_extremes_stays_stable() {
        let all = VocalFx { warmth: 1.0, gate: 1.0, mud: 1.0, punch: 1.0, smooth: 1.0, deess: 1.0, presence: 6.0, air: 6.0, double: 1.0, echo: 1.0, echo_feedback: 0.9, verb: 1.0, verb_size: 1.0, level: 12.0, ..VocalFx::default() };
        let mut c = Chain::new(SR, &all);
        let mut x = voice(SR as usize * 2);
        x.extend(std::iter::repeat(0.0).take(SR as usize * 4));
        let out = c.render(&x);
        assert!(out.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        // the echo and plate tails die away rather than growing
        let tail = &out[out.len() - 9600..];
        assert!(tail.iter().map(|v| v.abs()).fold(0.0, f32::max) < 0.5);
    }

    #[test]
    fn off_means_untouched() {
        let mut c = Chain::new(SR, &VocalFx { on: false, ..VocalFx::default() });
        assert_eq!(c.run(0.25), (0.25, 0.25));
    }

    #[test]
    fn the_reverb_is_heard_after_the_voice_stops() {
        let mut c = Chain::new(SR, &VocalFx { verb: 0.8, verb_size: 0.8, ..VocalFx::default() });
        let mut x = voice(SR as usize);
        x.extend(std::iter::repeat(0.0).take(SR as usize));
        let out = c.render(&x);
        let after: f32 = out[(SR as usize + 4800) * 2..(SR as usize + 14400) * 2].iter().map(|v| v * v).sum();
        assert!(after > 1e-4, "a tail after the last note ({after})");
    }

    #[test]
    fn settings_arrive_with_defaults_for_anything_missing() {
        let fx: VocalFx = serde_json::from_str(r#"{"verb":0.6,"presence":3}"#).unwrap();
        assert_eq!(fx.verb, 0.6);
        assert_eq!(fx.presence, 3.0);
        assert_eq!(fx.lowcut, 90.0);
    }

    #[test]
    fn every_colour_echo_space_and_width_is_stable_at_full_tilt() {
        let colors = ["clean", "tube", "console", "tape", "drive", "silk"];
        let echoes = ["slap", "tape", "analog", "digital", "pingpong", "ambient"];
        let spaces = ["plate", "room", "hall", "chamber", "cloud", "spring", "shimmer"];
        let widths = ["double", "micro", "chorus"];
        let mut x = voice(SR as usize);
        x.extend(std::iter::repeat(0.0).take(SR as usize * 2));
        for k in 0..7 {
            let json = format!(
                r#"{{"color":"{}","echo_type":"{}","verb_type":"{}","width":"{}","warmth":1,"gate":1,"low":6,"mud":1,"punch":1,"smooth":1,"deess":1,"presence":6,"air":9,"air_freq":40000,"double":1,"echo":1,"echo_feedback":1,"verb":1,"verb_size":1,"level":12}}"#,
                colors[k % 6], echoes[k % 6], spaces[k], widths[k % 3]
            );
            let fx: VocalFx = serde_json::from_str(&json).unwrap();
            let mut c = Chain::new(SR, &fx);
            let out = c.render(&x);
            assert!(out.iter().all(|v| v.is_finite() && v.abs() <= 1.0), "{json}");
            assert!(out[..9600].iter().map(|v| v.abs()).fold(0.0, f32::max) > 0.05, "the voice comes through: {json}");
        }
    }

    #[test]
    fn changing_any_setting_while_singing_makes_no_click() {
        // switch type after type under a steady tone: the dry voice must stay smooth
        let mut c = Chain::new(SR, &VocalFx { verb: 0.0, echo: 0.0, ..VocalFx::default() });
        let mut last = 0.0f32;
        let mut jump = 0.0f32;
        for i in 0..96000 {
            if i % 9600 == 4800 {
                let k = i / 9600;
                let fx = VocalFx { verb: 0.0, echo: 0.0, presence: (k as f32) - 4.0, air: (k % 5) as f32, mud: (k % 3) as f32 / 2.0, low: (k % 4) as f32 - 2.0, ..VocalFx::default() };
                c.set(&fx);
            }
            let (l, _) = c.run(0.2 * (2.0 * std::f32::consts::PI * 300.0 * i as f32 / SR).sin());
            if i > 4000 {
                jump = jump.max((l - last).abs());
            }
            last = l;
        }
        assert!(jump < 0.05, "{jump}");
    }

    #[test]
    fn older_settings_and_unknown_names_still_load() {
        // a sound saved before colours, spaces and echo types existed
        let old: VocalFx = serde_json::from_str(r#"{"on":true,"warmth":0.3,"lowcut":100,"echo":0.2,"echo_time":0.3,"verb":0.4}"#).unwrap();
        assert_eq!(old.color, ColorKind::Tube);
        assert_eq!(old.verb_type, SpaceKind::Plate);
        assert_eq!(old.echo_type, EchoKind::Tape);
        assert_eq!(old.width, WidthKind::Double);
        // a name from a newer version than this one
        let newer: VocalFx = serde_json::from_str(r#"{"verb_type":"cathedral","color":"ribbon"}"#).unwrap();
        assert_eq!(newer.verb_type, SpaceKind::Plate);
        assert_eq!(newer.color, ColorKind::Tube);
    }

    /// How long one sample takes with everything on (run with `--release -- --ignored`).
    #[test]
    #[ignore]
    fn speed() {
        let fx: VocalFx = serde_json::from_str(r#"{"color":"console","echo_type":"ambient","verb_type":"cloud","width":"micro","warmth":0.6,"gate":0.3,"double":0.5,"echo":0.4,"echo_feedback":0.5,"verb":0.5}"#).unwrap();
        let mut c = Chain::new(SR, &fx);
        let x = voice(SR as usize * 10);
        let t = std::time::Instant::now();
        let out = c.render(&x);
        let ns = t.elapsed().as_nanos() as f64 / x.len() as f64;
        println!("{ns:.0} ns per sample = {:.1}% of one core at 48 kHz; a 64-sample block takes {:.0} of its 1333 microseconds ({})", ns * 48000.0 / 1e7, ns * 64.0 / 1000.0, out.len());
    }

    /// Only the reverb of a chain: the voice in, what the space gives back (both sides).
    fn wet(kind: &str, size: f32, x: &[f32]) -> Vec<f32> {
        let json = format!(r#"{{"verb_type":"{kind}","verb":1,"verb_size":{size},"verb_predelay":0,"duck":0,"warmth":0,"punch":0,"smooth":0,"deess":0,"presence":0,"air":0,"mud":0,"level":-12}}"#);
        let mut with = Chain::new(SR, &serde_json::from_str(&json).unwrap());
        let mut without = Chain::new(SR, &serde_json::from_str(&json.replace(r#""verb":1"#, r#""verb":0"#)).unwrap());
        let (a, b) = (with.render(x), without.render(x));
        a.iter().zip(&b).map(|(a, b)| a - b).collect()
    }
    const KINDS: [&str; 7] = ["plate", "room", "hall", "chamber", "cloud", "spring", "shimmer"];

    /// Prints what `LEVELS` should be (run with `-- --ignored --nocapture levels`).
    #[test]
    #[ignore]
    fn levels() {
        let x = voice(SR as usize * 8);
        let rms = |k: &str| {
            let w = wet(k, 0.5, &x);
            (w[w.len() / 2..].iter().map(|v| (v * v) as f64).sum::<f64>() / (w.len() / 2) as f64).sqrt()
        };
        let plate = rms("plate");
        for (i, k) in KINDS.iter().enumerate() {
            println!("{k}: {:.3}", LEVELS[i] as f64 * plate / rms(k));
        }
    }

    #[test]
    fn every_space_comes_back_about_as_loud_and_each_has_its_own_length() {
        let x = voice(SR as usize * 6);
        let mut burst = voice(SR as usize / 2);
        burst.extend(std::iter::repeat(0.0).take(SR as usize * 12));
        let mut lengths = vec![];
        let mut plate = 0.0;
        for k in KINDS {
            let w = wet(k, 0.5, &x);
            let rms = (w[w.len() / 2..].iter().map(|v| (v * v) as f64).sum::<f64>() / (w.len() / 2) as f64).sqrt();
            if k == "plate" {
                plate = rms;
            }
            assert!((rms / plate).log10().abs() * 20.0 < 3.0, "{k} is {:.1} dB from the plate", 20.0 * (rms / plate).log10());
            // how long after the voice stops until it is 40 dB down
            let t = wet(k, 0.5, &burst);
            let e: Vec<f64> = t.chunks(4800).map(|c| c.iter().map(|v| (v * v) as f64).sum()).collect();
            let start = e[4] + e[5];
            let gone = e.iter().enumerate().skip(10).find(|(_, v)| **v < start * 0.5e-4).map(|(i, _)| i).unwrap_or(e.len());
            lengths.push((gone as f32 - 10.0) * 0.05);
        }
        let [plate, room, hall, chamber, cloud, spring, shimmer] = lengths[..] else { panic!() };
        assert!(room < 0.9, "a room is short: {room} s");
        assert!(chamber > room && chamber < hall, "a chamber lies between: {room} {chamber} {hall}");
        assert!(cloud > hall && cloud > 3.0, "a cloud hangs longest: {cloud} s (hall {hall})");
        assert!(plate > room && shimmer > room, "the plates outlast the room: {plate} {shimmer}");
        assert!(spring > 0.2 && spring < 3.0, "spring {spring}");
    }

    #[test]
    fn the_eq_is_what_the_page_draws() {
        use crate::testutil::gain_db;
        // only the EQ: no colour, dynamics, width or sends
        let fx = VocalFx { warmth: 0.0, punch: 0.0, smooth: 0.0, deess: 0.0, verb: 0.0, lowcut: 100.0, low: 4.0, low_freq: 150.0, mud: 0.0, mid: -6.0, mud_freq: 500.0, mid_q: 2.0, presence: 5.0, presence_freq: 3000.0, presence_q: 1.5, air: 6.0, air_freq: 12000.0, ..VocalFx::default() };
        let at = |f: f64| {
            let mut c = Chain::new(SR, &fx);
            gain_db(SR as f64, f, |x| c.run(x).0)
        };
        // the bells reach their gain at their centres (their neighbours add a little)
        assert!((at(500.0) - (-6.0)).abs() < 1.0, "mid bell: {}", at(500.0));
        assert!((at(3000.0) - 5.0).abs() < 1.0, "presence bell: {}", at(3000.0));
        // the low cut is 3 dB down at its corner (plus what the shelf adds there) and steep below it
        assert!(at(50.0) < at(100.0) - 15.0, "low cut slope: {} vs {}", at(50.0), at(100.0));
        // the shelf lifts the lows that the cut leaves, the air band the very top
        assert!(at(200.0) > 0.5 && at(200.0) < 4.5, "shelf: {}", at(200.0));
        assert!(at(16000.0) > 3.5 && at(16000.0) < 6.5, "air: {}", at(16000.0));
        // between the bands it is flat
        assert!(at(1200.0).abs() < 1.2, "between: {}", at(1200.0));
    }
}

//! The work of splitting one song, apart from the network itself: reading the file, changing
//! its sample rate to the network's and back, cutting it into overlapping stretches, joining
//! what comes back with cross-fades, and writing each stem to its own file as it is finished.
//!
//! The network only ever sees one stretch of 7.8 seconds at a time (that is how it was trained).
//! Stretches overlap by a quarter, and where two overlap their results are faded into each
//! other, so no seam can be heard or seen. Everything is streamed: the song is read a little at
//! a time and each stem is written as soon as a part of it can no longer change, so an hour-long
//! file costs no more memory than a short one, and the first seconds of every stem can be painted
//! while the rest is still being worked on.
//!
//! Demucs' own command first scales the whole song to a standard level; the network also does
//! that for each stretch, inside, so the whole-song step changes little. As in demucs-onnx it is
//! left out here, which is what lets the stems be written in one pass while the song is read.
//!
//! The network is behind a small trait, so the whole path (file in, stem files out) is tested
//! here with stand-ins: one that hands the mix straight back, one that splits it by fixed shares.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

// ── changing the sample rate ──

/// Changes a stream's sample rate, a block at a time, with a windowed-sinc filter (the
/// textbook band-limited interpolation, with a Kaiser window). The ratio is kept as a fraction
/// in whole numbers (48000 → 44100 is 147/160), so a long song never drifts by even one sample.
/// Each output sample sits exactly at its place in time: the filter is symmetrical, so nothing is
/// delayed and a stem lines up with the song it came from.
pub struct Resampler {
    /// output rate / input rate, as l / m in lowest terms
    l: u64,
    m: u64,
    /// filter taps on each side of an output sample (in input samples)
    half: usize,
    /// cut-off (cycles per input sample) and the window's shape
    fc: f64,
    beta: f64,
    /// one row of taps for each of the `phases` positions an output sample can fall between two
    /// input samples: every one of the `l` there are, or, for an odd pair of rates where there are
    /// thousands, the nearest of 4096 evenly spaced ones (a timing error under 1/8192 of a sample,
    /// more than 70 dB down even at 18 kHz) rather than working each one out, which would make
    /// such a song dozens of times slower to split
    table: Vec<f32>,
    phases: u64,
    /// input not yet used up, per channel, and the number (in the whole stream) of its first sample
    buf: Vec<Vec<f32>>,
    base: u64,
    pushed: u64,
    /// the next output sample to make
    next: u64,
}

/// Taps from the centre to where the filter's window ends, counted in zero crossings of the sinc,
/// and where the band is cut. Together they put the end of the filter's slope at the lower of the
/// two half rates, so nothing above it folds back (about 85 dB down), and keep the band flat to
/// about 18.5 kHz: the network hears everything that matters, and a stem keeps its top end.
const ZEROS: f64 = 32.0;
const ROLLOFF: f64 = 0.92;
const KAISER_BETA: f64 = 8.6;
/// The most rows of taps a resampler keeps (see `Resampler::table`).
const MAX_PHASES: u64 = 4096;

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// The zeroth-order modified Bessel function (for the Kaiser window).
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let q = x * x / 4.0;
    for k in 1..64 {
        term *= q / (k as f64 * k as f64);
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

impl Resampler {
    pub fn new(from: u32, to: u32, channels: usize) -> Self {
        let g = gcd(from as u64, to as u64).max(1);
        let (l, m) = (to as u64 / g, from as u64 / g);
        // going down, the band must stop below the new, lower half rate
        let fc = 0.5 * ROLLOFF * (l as f64 / m as f64).min(1.0);
        let half = (ZEROS / (2.0 * fc)).ceil() as usize;
        let phases = l.min(MAX_PHASES);
        let mut r = Resampler { l, m, half, fc, beta: KAISER_BETA, table: Vec::new(), phases, buf: vec![Vec::new(); channels], base: 0, pushed: 0, next: 0 };
        if l != m {
            let taps = 2 * half;
            let mut t = vec![0.0f32; phases as usize * taps];
            for p in 0..phases {
                let row = r.taps(p as f64 / phases as f64);
                t[p as usize * taps..(p as usize + 1) * taps].copy_from_slice(&row);
            }
            r.table = t;
        }
        r
    }

    pub fn passthrough(&self) -> bool {
        self.l == self.m
    }

    /// The taps for an output sample that falls `frac` of the way from one input sample to the
    /// next, scaled so they add up to exactly one (a steady level passes unchanged).
    fn taps(&self, frac: f64) -> Vec<f32> {
        let taps = 2 * self.half;
        let i0b = bessel_i0(self.beta);
        let mut row: Vec<f64> = (0..taps)
            .map(|j| {
                // distance from the output sample's place to input sample j of the window
                let d = (self.half as f64 - 1.0 - j as f64) + frac;
                let x = d / self.half as f64;
                if x.abs() >= 1.0 {
                    return 0.0;
                }
                let w = bessel_i0(self.beta * (1.0 - x * x).sqrt()) / i0b;
                let a = 2.0 * self.fc * d;
                let sinc = if a.abs() < 1e-12 { 1.0 } else { (std::f64::consts::PI * a).sin() / (std::f64::consts::PI * a) };
                2.0 * self.fc * sinc * w
            })
            .collect();
        let sum: f64 = row.iter().sum();
        if sum.abs() > 1e-12 {
            for v in &mut row {
                *v /= sum;
            }
        }
        row.into_iter().map(|v| v as f32).collect()
    }

    /// How many output samples a stream of `input` samples makes.
    pub fn out_len(&self, input: u64) -> u64 {
        (input * self.l).div_ceil(self.m)
    }

    /// More input: one slice per channel, all the same length.
    pub fn push(&mut self, input: &[&[f32]]) {
        let Some(n) = input.first().map(|c| c.len()) else { return };
        for (c, b) in self.buf.iter_mut().enumerate() {
            b.extend_from_slice(&input[c.min(input.len() - 1)][..n]);
        }
        self.pushed += n as u64;
    }

    /// Every output sample that can be made from the input so far (with `finished`, every one
    /// that is left, the end of the input counting as silence). Appended to `out`, per channel.
    pub fn pull(&mut self, out: &mut [Vec<f32>], finished: bool) {
        if self.passthrough() {
            for (c, b) in self.buf.iter_mut().enumerate() {
                out[c].extend_from_slice(b);
                b.clear();
            }
            self.base = self.pushed;
            self.next = self.pushed;
            return;
        }
        let total = self.out_len(self.pushed);
        let taps = 2 * self.half;
        loop {
            if finished && self.next >= total {
                break;
            }
            let pos = self.next * self.m;
            let mut i0 = pos / self.l;
            // the nearest row of taps (exactly this output sample's place when there is a row
            // for every place); rounding up to the next input sample's own place moves on to it
            let mut row_at = ((pos % self.l) * self.phases * 2 + self.l) / (2 * self.l);
            if row_at == self.phases {
                row_at = 0;
                i0 += 1;
            }
            // the last input sample this output sample needs
            let last = i0 + self.half as u64;
            if !finished && last >= self.pushed {
                break;
            }
            let first = i0 as i64 - self.half as i64 + 1;
            let row: &[f32] = &self.table[row_at as usize * taps..(row_at as usize + 1) * taps];
            for (c, b) in self.buf.iter().enumerate() {
                let mut acc = 0.0f64;
                for (j, &h) in row.iter().enumerate() {
                    let k = first + j as i64;
                    if k < self.base as i64 {
                        continue;
                    }
                    let idx = (k as u64 - self.base) as usize;
                    if let Some(&x) = b.get(idx) {
                        acc += h as f64 * x as f64;
                    }
                }
                out[c].push(acc as f32);
            }
            self.next += 1;
        }
        // input no later output sample can reach is let go
        let need = (self.next * self.m / self.l) as i64 - self.half as i64 + 1;
        if need > self.base as i64 {
            let drop = ((need as u64 - self.base) as usize).min(self.buf[0].len());
            for b in &mut self.buf {
                b.drain(..drop);
            }
            self.base += drop as u64;
        }
    }
}

// ── reading the song ──

/// A song file being read, a packet at a time, as left and right. Mono is heard on both
/// sides; of a file with more channels, the first two (front left and right) are used.
pub struct Source {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track: u32,
    pub rate: u32,
    /// how long the file says it is (frames), when it says
    pub frames: Option<u64>,
    sb: Option<SampleBuffer<f32>>,
}

impl Source {
    pub fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("The song could not be opened ({e})"))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        // encoder delay and padding are trimmed (as the browser does), so the stems line up with
        // the song as the page plays it
        let fo = FormatOptions { enable_gapless: true, ..Default::default() };
        let probed = symphonia::default::get_probe().format(&hint, mss, &fo, &MetadataOptions::default()).map_err(|e| format!("This kind of file cannot be split here ({e})"))?;
        let format = probed.format;
        let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("The file holds no sound")?;
        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("The sound in this file is in a form that cannot be split here ({e})"))?;
        let rate = track.codec_params.sample_rate.ok_or("The file does not say its sample rate")?;
        if !(4_000..=768_000).contains(&rate) {
            return Err(format!("The file says its sample rate is {rate} Hz, which cannot be split here"));
        }
        let frames = track.codec_params.n_frames;
        if frames.is_some_and(|f| f > max_frames()) {
            return Err(too_long(rate));
        }
        let id = track.id;
        Ok(Source { format, decoder, track: id, rate, frames, sb: None })
    }

    /// The next stretch of the song, appended to `l` and `r`. False at the end.
    pub fn read(&mut self, l: &mut Vec<f32>, r: &mut Vec<f32>) -> Result<bool, String> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(false),
                // a stream that changes shape mid-way (rare) is taken as ending there
                Err(SymError::ResetRequired) => return Ok(false),
                Err(e) => return Err(format!("The song could not be read to the end ({e})")),
            };
            if packet.track_id() != self.track {
                continue;
            }
            let decoded = match self.decoder.decode(&packet) {
                Ok(d) => d,
                // one damaged packet is skipped, as players do
                Err(SymError::DecodeError(_)) => continue,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(false),
                Err(e) => return Err(format!("The song could not be read to the end ({e})")),
            };
            let spec = *decoded.spec();
            let frames = decoded.frames();
            if frames == 0 {
                continue;
            }
            // a file whose sound decodes at another rate than it says (an AAC file with a part
            // this decoder cannot read, the part that doubles its rate) would give stems that do
            // not line up with the song as the page plays it: refused plainly instead
            if spec.rate != self.rate {
                return Err(format!("The sound in this file is in a form that cannot be split here (it says {} Hz but decodes at {} Hz)", self.rate, spec.rate));
            }
            let need = decoded.capacity() as u64;
            if self.sb.as_ref().map(|s| s.capacity() < need as usize * spec.channels.count()).unwrap_or(true) {
                self.sb = Some(SampleBuffer::new(need, spec));
            }
            let sb = self.sb.as_mut().expect("made above");
            sb.copy_interleaved_ref(decoded);
            let ch = spec.channels.count().max(1);
            let s = sb.samples();
            for f in 0..frames {
                let a = s[f * ch];
                l.push(a);
                r.push(if ch > 1 { s[f * ch + 1] } else { a });
            }
            return Ok(true);
        }
    }
}

/// The longest song that can be split (frames): a stem is a WAV file, whose sizes are counted
/// in 32 bits, so it holds at most 4 GB, about three hours of stereo 32-bit sound at 48 kHz.
pub fn max_frames() -> u64 {
    (u32::MAX as u64 - (1 << 16)) / 8
}

fn too_long(rate: u32) -> String {
    format!("The song is too long to split: at most about {} minutes at its sample rate", max_frames() / rate.max(1) as u64 / 60)
}

// ── stretches and cross-fades ──

/// How a song is cut into stretches for the network: `seg` samples each, `overlap` of them
/// shared with the next stretch.
#[derive(Clone, Copy, Debug)]
pub struct Plan {
    pub seg: usize,
    pub overlap: usize,
}

impl Plan {
    /// A quarter of each stretch overlaps the next, as Demucs does by default.
    pub fn quarter(seg: usize) -> Self {
        Plan { seg, overlap: seg / 4 }
    }
    pub fn stride(&self) -> usize {
        (self.seg - self.overlap).max(1)
    }
    /// How much a stretch's result counts at sample `i` of it: rising over the shared part at the
    /// start, falling over the one at the end, never quite zero. Where two stretches overlap,
    /// one fades out as the other fades in; what comes out is divided by the weights that went
    /// in, so a part with only one stretch (the very start and end of the song) is just that one.
    pub fn weight(&self, i: usize) -> f32 {
        let ramp = (self.overlap + 1) as f32;
        let up = (i + 1) as f32 / ramp;
        let down = (self.seg - i) as f32 / ramp;
        up.min(down).min(1.0)
    }
    /// How many stretches a song of `total` samples (at the network's rate) needs.
    pub fn count(&self, total: u64) -> u64 {
        if total <= self.seg as u64 {
            1
        } else {
            1 + (total - self.seg as u64).div_ceil(self.stride() as u64)
        }
    }
}

/// Adds up the stretches' results with their weights, and hands back each part once no later
/// stretch can add to it.
pub struct OverlapAdd {
    base: u64,
    acc: Vec<Vec<f32>>,
    wsum: Vec<f32>,
}

impl OverlapAdd {
    /// `lanes`: stems × channels.
    pub fn new(lanes: usize) -> Self {
        OverlapAdd { base: 0, acc: vec![Vec::new(); lanes], wsum: Vec::new() }
    }

    /// One stretch's result (`out`: lane after lane, `plan.seg` samples each), starting at sample
    /// `start` of the song; only its first `valid` samples are in the song.
    pub fn add(&mut self, plan: &Plan, start: u64, out: &[f32], valid: usize) {
        let off = (start - self.base) as usize;
        let end = off + valid;
        if self.wsum.len() < end {
            self.wsum.resize(end, 0.0);
            for a in &mut self.acc {
                a.resize(end, 0.0);
            }
        }
        for i in 0..valid {
            self.wsum[off + i] += plan.weight(i);
        }
        for (lane, a) in self.acc.iter_mut().enumerate() {
            let src = &out[lane * plan.seg..lane * plan.seg + valid];
            for (i, &x) in src.iter().enumerate() {
                a[off + i] += x * plan.weight(i);
            }
        }
    }

    /// The finished samples from where the last call left off up to (not including) `upto`,
    /// appended to `dst`, one Vec per lane.
    pub fn take(&mut self, upto: u64, dst: &mut [Vec<f32>]) {
        let n = ((upto.saturating_sub(self.base)) as usize).min(self.wsum.len());
        for (d, a) in dst.iter_mut().zip(self.acc.iter_mut()) {
            d.extend(a[..n].iter().zip(&self.wsum[..n]).map(|(&a, &w)| if w > 0.0 { a / w } else { 0.0 }));
            a.drain(..n);
        }
        self.wsum.drain(..n);
        self.base += n as u64;
    }
}

// ── the network, as the pipeline sees it ──

pub enum RunError {
    /// stopped from outside (cancelled, or the engine started recording): nothing is wrong
    Interrupted,
    Failed(String),
}

/// Whatever separates one stretch: the real network, or a stand-in in the tests.
pub trait Separator {
    /// how many stems it makes
    fn stems(&self) -> usize;
    /// how many samples (per channel, at 44.1 kHz) one stretch must have
    fn segment(&self) -> usize;
    /// `mix`: left then right, `segment()` samples each. `out` is filled with every stem's left
    /// then right, stem after stem.
    fn run(&mut self, mix: &[f32], out: &mut Vec<f32>) -> Result<(), RunError>;
}

/// The network's sample rate (Demucs was trained at 44.1 kHz).
pub const MODEL_RATE: u32 = 44100;

/// What the pipeline reports as it goes.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// stretch `done` of about `total` is finished; every stem holds its first `ready` frames
    Progress { done: u64, total: u64, ready: u64 },
    /// waiting for the engine to finish recording
    Paused,
    Resumed,
}

pub struct Controls<'a> {
    pub cancel: &'a AtomicBool,
    /// true while splitting must wait (the engine is recording a take)
    pub busy: &'a dyn Fn() -> bool,
    /// how often to look again while waiting
    pub poll: Duration,
}

#[derive(Debug, PartialEq)]
pub enum Stop {
    Cancelled,
    Failed(String),
}

impl From<String> for Stop {
    fn from(s: String) -> Self {
        Stop::Failed(s)
    }
}

pub struct Done {
    /// the song's sample rate (the stems are written at it)
    pub rate: u32,
    /// frames in each stem (the same as in the song)
    pub frames: u64,
    /// how many stretches the network ran (the tests check it)
    #[allow(dead_code)]
    pub segments: u64,
}

type Wav = hound::WavWriter<BufWriter<File>>;

fn wait_while_busy(ctl: &Controls, on: &mut dyn FnMut(Event)) -> Result<(), Stop> {
    if !(ctl.busy)() {
        return Ok(());
    }
    on(Event::Paused);
    while (ctl.busy)() {
        if ctl.cancel.load(Ordering::Relaxed) {
            return Err(Stop::Cancelled);
        }
        std::thread::sleep(ctl.poll);
    }
    on(Event::Resumed);
    Ok(())
}

/// `split_source` from a file. (The app opens the song itself first, to know its rate and length
/// before the work starts.)
#[cfg(test)]
pub fn split(input: &Path, outputs: &[PathBuf], sep: &mut dyn Separator, ctl: &Controls, on: &mut dyn FnMut(Event)) -> Result<Done, Stop> {
    let mut src = Source::open(input)?;
    split_source(&mut src, outputs, sep, ctl, on)
}

/// Split the song being read by `src` into one float WAV per stem (`outputs`, in the separator's stem
/// order), at the song's own sample rate and length. Each file is brought up to date after every
/// stretch, so it can be read while the rest is being made, up to the `ready` frames last reported.
pub fn split_source(src: &mut Source, outputs: &[PathBuf], sep: &mut dyn Separator, ctl: &Controls, on: &mut dyn FnMut(Event)) -> Result<Done, Stop> {
    let stems = sep.stems();
    if outputs.len() != stems {
        return Err(Stop::Failed(format!("{} stem files for a model that makes {stems}", outputs.len())));
    }
    let plan = Plan::quarter(sep.segment());
    let rate = src.rate;
    let mut up = Resampler::new(rate, MODEL_RATE, 2);
    let mut downs: Vec<Resampler> = (0..stems).map(|_| Resampler::new(MODEL_RATE, rate, 2)).collect();
    let spec = hound::WavSpec { channels: 2, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let mut wavs: Vec<Wav> = outputs
        .iter()
        .map(|p| File::create(p).map_err(|e| e.to_string()).and_then(|f| hound::WavWriter::new(BufWriter::with_capacity(1 << 18, f), spec).map_err(|e| e.to_string())))
        .collect::<Result<_, _>>()
        .map_err(|e| format!("A stem file could not be made ({e})"))?;

    // the song at the network's rate: what is still needed, from sample `mix_base` on
    let mut mix: [Vec<f32>; 2] = [Vec::new(), Vec::new()];
    let mut mix_base = 0u64;
    let mut have = 0u64;
    let mut src_frames = 0u64;
    let mut finished = false;
    let (mut l, mut r) = (Vec::new(), Vec::new());
    let mut conv = vec![Vec::new(), Vec::new()];

    let est_total = src.frames.map(|f| up.out_len(f)).unwrap_or(0);
    let mut total_est = plan.count(est_total.max(1));
    let mut ola = OverlapAdd::new(stems * 2);
    let mut lanes: Vec<Vec<f32>> = vec![Vec::new(); stems * 2];
    let mut back: Vec<Vec<f32>> = vec![Vec::new(), Vec::new()];
    let mut written = 0u64;
    let mut seg_in = vec![0.0f32; 2 * plan.seg];
    let mut seg_out = Vec::new();
    let mut start = 0u64;
    let mut done = 0u64;
    // where the last stretch run ends
    let mut covered = 0u64;

    loop {
        if ctl.cancel.load(Ordering::Relaxed) {
            return Err(Stop::Cancelled);
        }
        // read until a whole stretch from `start` is here, or the song ends
        while !finished && have < start + plan.seg as u64 {
            l.clear();
            r.clear();
            if !src.read(&mut l, &mut r)? {
                finished = true;
            }
            src_frames += l.len() as u64;
            if src_frames > max_frames() {
                return Err(Stop::Failed(too_long(rate)));
            }
            up.push(&[&l, &r]);
            conv[0].clear();
            conv[1].clear();
            up.pull(&mut conv, finished);
            mix[0].extend_from_slice(&conv[0]);
            mix[1].extend_from_slice(&conv[1]);
            have += conv[0].len() as u64;
        }
        if finished && have == 0 {
            return Err(Stop::Failed("The file holds no sound".into()));
        }
        if finished {
            total_est = plan.count(have);
        }
        // the song can end inside the last stretch run: then there is nothing left to separate,
        // only the rest of that stretch to hand over
        let last = if done > 0 && finished && covered >= have {
            true
        } else {
            // the stretch, with silence after the end of the song
            let off = (start - mix_base) as usize;
            let valid = ((have - start) as usize).min(plan.seg);
            for c in 0..2 {
                let dst = &mut seg_in[c * plan.seg..(c + 1) * plan.seg];
                dst[..valid].copy_from_slice(&mix[c][off..off + valid]);
                dst[valid..].fill(0.0);
            }
            loop {
                wait_while_busy(ctl, on)?;
                match sep.run(&seg_in, &mut seg_out) {
                    Ok(()) => break,
                    Err(RunError::Interrupted) => {
                        if ctl.cancel.load(Ordering::Relaxed) {
                            return Err(Stop::Cancelled);
                        }
                        // stopped because a take began: the same stretch again once it is over
                        if !(ctl.busy)() {
                            std::thread::sleep(ctl.poll);
                        }
                    }
                    Err(RunError::Failed(e)) => return Err(Stop::Failed(e)),
                }
            }
            if seg_out.len() != stems * 2 * plan.seg {
                return Err(Stop::Failed(format!("The model gave {} values for a stretch, not {}", seg_out.len(), stems * 2 * plan.seg)));
            }
            ola.add(&plan, start, &seg_out, valid);
            done += 1;
            covered = start + plan.seg as u64;
            finished && covered >= have
        };
        let upto = if last { have } else { start + plan.stride() as u64 };
        for v in &mut lanes {
            v.clear();
        }
        ola.take(upto, &mut lanes);
        // back to the song's own rate, and onto the disk; the conversions round, so the very end
        // is trimmed or padded to make each stem exactly as long as the song
        let mut made = 0u64;
        for (s, w) in wavs.iter_mut().enumerate() {
            downs[s].push(&[&lanes[2 * s], &lanes[2 * s + 1]]);
            back[0].clear();
            back[1].clear();
            downs[s].pull(&mut back, last);
            let room = src_frames.saturating_sub(written);
            let n = (back[0].len() as u64).min(room);
            let fill = if last { room } else { n };
            let frames = back[0].iter().zip(&back[1]).take(n as usize).map(|(&a, &b)| (a, b));
            for (a, b) in frames.chain(std::iter::repeat((0.0, 0.0))).take(fill as usize) {
                w.write_sample(a).map_err(|e| format!("A stem could not be written ({e})"))?;
                w.write_sample(b).map_err(|e| format!("A stem could not be written ({e})"))?;
            }
            // the header is brought up to date, so the part written so far can be read
            w.flush().map_err(|e| format!("A stem could not be written ({e})"))?;
            made = fill;
        }
        written += made;
        on(Event::Progress { done, total: total_est.max(done), ready: written });
        if last {
            break;
        }
        // what the next stretch no longer needs is let go
        let next = start + plan.stride() as u64;
        let drop = (next - mix_base) as usize;
        for c in &mut mix {
            c.drain(..drop.min(c.len()));
        }
        mix_base = next;
        start = next;
    }
    for w in wavs {
        w.finalize().map_err(|e| format!("A stem could not be closed ({e})"))?;
    }
    Ok(Done { rate, frames: src_frames, segments: done })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A stand-in network that splits the mix into fixed shares (they add up to the mix).
    pub struct Shares {
        pub seg: usize,
        pub shares: Vec<f32>,
        pub runs: usize,
        /// on this run (counting from 1), say "interrupted" once, as a recording would make it
        pub interrupt_on: Option<usize>,
        pub cancel_on: Option<(usize, std::sync::Arc<AtomicBool>)>,
    }
    impl Separator for Shares {
        fn stems(&self) -> usize {
            self.shares.len()
        }
        fn segment(&self) -> usize {
            self.seg
        }
        fn run(&mut self, mix: &[f32], out: &mut Vec<f32>) -> Result<(), RunError> {
            self.runs += 1;
            if self.interrupt_on == Some(self.runs) {
                self.interrupt_on = None;
                return Err(RunError::Interrupted);
            }
            if let Some((n, flag)) = &self.cancel_on {
                if *n == self.runs {
                    flag.store(true, Ordering::Relaxed);
                    return Err(RunError::Interrupted);
                }
            }
            out.clear();
            for &k in &self.shares {
                out.extend(mix.iter().map(|x| x * k));
            }
            Ok(())
        }
    }

    pub fn write_wav(path: &Path, rate: u32, channels: u16, frames: &[[f32; 2]]) {
        let spec = hound::WavSpec { channels, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for f in frames {
            w.write_sample(f[0]).unwrap();
            if channels > 1 {
                w.write_sample(f[1]).unwrap();
            }
        }
        w.finalize().unwrap();
    }

    pub fn read_wav(path: &Path) -> (u32, Vec<[f32; 2]>) {
        let mut r = hound::WavReader::open(path).unwrap();
        let rate = r.spec().sample_rate;
        let s: Vec<f32> = r.samples::<f32>().map(|x| x.unwrap()).collect();
        (rate, s.chunks(2).map(|c| [c[0], c[1]]).collect())
    }

    fn ctl(cancel: &AtomicBool) -> Controls<'_> {
        static NEVER: fn() -> bool = || false;
        Controls { cancel, busy: &NEVER, poll: Duration::from_millis(1) }
    }

    fn tone(rate: u32, n: usize, f: f64) -> Vec<[f32; 2]> {
        (0..n)
            .map(|i| {
                let t = i as f64 / rate as f64;
                [(0.5 * (2.0 * std::f64::consts::PI * f * t).sin()) as f32, (0.3 * (2.0 * std::f64::consts::PI * f * 1.5 * t).cos()) as f32]
            })
            .collect()
    }

    #[test]
    fn stretches_overlap_by_a_quarter_and_cover_the_song_once() {
        let p = Plan::quarter(343_980);
        assert_eq!(p.overlap, 85_995);
        assert_eq!(p.stride(), 257_985);
        assert_eq!(p.count(1000), 1);
        assert_eq!(p.count(343_980), 1);
        assert_eq!(p.count(343_981), 2);
        // a 3-minute song at 44.1 kHz
        let n = p.count(180 * 44_100);
        assert_eq!(n, 31);
        let last_start = (n - 1) * p.stride() as u64;
        assert!(last_start + p.seg as u64 >= 180 * 44_100 && last_start < 180 * 44_100);
        // the weights never reach zero, and fade in and out over the shared part
        assert!(p.weight(0) > 0.0 && p.weight(p.seg - 1) > 0.0);
        assert_eq!(p.weight(p.seg / 2), 1.0);
        assert!(p.weight(p.overlap / 2) < 0.6);
        // where two stretches overlap, the fades add up to one
        for i in 0..p.overlap {
            let sum = p.weight(p.stride() + i) + p.weight(i);
            assert!((sum - 1.0).abs() < 1e-5, "{i}: {sum}");
        }
    }

    #[test]
    fn with_the_identity_as_the_model_the_stretches_give_back_the_signal_exactly() {
        // odd lengths, so stretches end in odd places, and a song shorter than one stretch
        for (len, seg) in [(10_000usize, 1000usize), (9_999, 1000), (777, 1000), (1000, 1000), (12_345, 997)] {
            let plan = Plan::quarter(seg);
            let x: Vec<f32> = (0..len).map(|i| ((i * 7919) % 1000) as f32 / 500.0 - 1.0).collect();
            let mut ola = OverlapAdd::new(1);
            let mut got = vec![Vec::new()];
            let mut start = 0u64;
            loop {
                let valid = (len - start as usize).min(seg);
                let mut stretch = vec![0.0; seg];
                stretch[..valid].copy_from_slice(&x[start as usize..start as usize + valid]);
                ola.add(&plan, start, &stretch, valid);
                let last = start as usize + seg >= len;
                ola.take(if last { len as u64 } else { start + plan.stride() as u64 }, &mut got);
                if last {
                    break;
                }
                start += plan.stride() as u64;
            }
            assert_eq!(got[0].len(), len);
            for (i, (a, b)) in got[0].iter().zip(&x).enumerate() {
                assert!((a - b).abs() <= 1e-6 * b.abs().max(1.0), "len {len}, sample {i}: {a} vs {b}");
            }
        }
    }

    #[test]
    fn the_rate_is_changed_cleanly_and_back_again() {
        // the last pairs are odd ones, with thousands of places an output sample can fall
        for (from, to) in [(48_000u32, 44_100u32), (44_100, 48_000), (22_050, 44_100), (96_000, 44_100), (44_100, 44_100), (44_056, 44_100), (44_100, 44_056), (44_101, 44_100)] {
            let n = from as usize; // one second
            let f = 1000.0;
            let x: Vec<f32> = (0..n).map(|i| (2.0 * std::f64::consts::PI * f * i as f64 / from as f64).sin() as f32).collect();
            let mut a = Resampler::new(from, to, 1);
            let mut mid = vec![Vec::new()];
            // in uneven blocks, as a decoder hands them over
            let mut i = 0;
            let mut k = 0;
            while i < n {
                let len = [1152usize, 17, 4096, 333][k % 4].min(n - i);
                a.push(&[&x[i..i + len]]);
                a.pull(&mut mid, false);
                i += len;
                k += 1;
            }
            a.pull(&mut mid, true);
            assert_eq!(mid[0].len() as u64, a.out_len(n as u64), "{from}->{to}");
            // the tone is still the tone, at its place in time
            let err = mid[0]
                .iter()
                .enumerate()
                .skip(200)
                .take(mid[0].len() - 400)
                .map(|(j, &y)| (y as f64 - (2.0 * std::f64::consts::PI * f * j as f64 / to as f64).sin()).abs())
                .fold(0.0, f64::max);
            assert!(err < 1e-3, "{from}->{to}: {err}");
            // and back
            let mut b = Resampler::new(to, from, 1);
            let mut back = vec![Vec::new()];
            b.push(&[&mid[0]]);
            b.pull(&mut back, true);
            let err = back[0].iter().zip(&x).skip(200).take(n - 400).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
            assert!(err < 2e-3, "{from}->{to}->{from}: {err}");
        }
    }

    #[test]
    fn an_odd_pair_of_rates_keeps_a_small_table_and_stays_quick() {
        let r = Resampler::new(44_056, 44_100, 2);
        assert_eq!(r.l, 11_025);
        assert_eq!(r.phases, MAX_PHASES);
        assert_eq!(r.table.len(), MAX_PHASES as usize * 2 * r.half);
        // ordinary pairs have a row for every place, so nothing is rounded
        let r = Resampler::new(48_000, 44_100, 2);
        assert_eq!((r.l, r.phases), (147, 147));
        // ten seconds of stereo through an odd pair, as fast as through an ordinary one would be
        let x: Vec<f32> = (0..441_000).map(|i| (i as f32 * 0.01).sin()).collect();
        let t = std::time::Instant::now();
        let mut a = Resampler::new(44_101, 44_100, 2);
        let mut out = vec![Vec::new(), Vec::new()];
        a.push(&[&x, &x]);
        a.pull(&mut out, true);
        assert_eq!(out[0].len() as u64, a.out_len(441_000));
        assert!(t.elapsed() < Duration::from_secs(20), "{:?}", t.elapsed());
    }

    #[test]
    fn a_stem_never_outgrows_what_a_wav_file_can_hold() {
        // stereo 32-bit: 8 bytes a frame, plus the header, within the file's 32-bit sizes
        assert!(max_frames() * 8 + 4096 < u32::MAX as u64);
        assert!(max_frames() / 48_000 / 60 >= 180, "at least three hours at 48 kHz");
        assert!(too_long(96_000).contains("93 minutes"), "{}", too_long(96_000));
    }

    #[test]
    fn what_would_fold_back_is_removed_when_going_down() {
        // 23 kHz at 48 kHz has no place at 44.1 kHz (it would fold to 21.1 kHz)
        let n = 48_000;
        let x: Vec<f32> = (0..n).map(|i| (2.0 * std::f64::consts::PI * 23_000.0 * i as f64 / 48_000.0).sin() as f32).collect();
        let mut a = Resampler::new(48_000, 44_100, 1);
        let mut out = vec![Vec::new()];
        a.push(&[&x]);
        a.pull(&mut out, true);
        let y: Vec<f64> = out[0][1000..out[0].len() - 1000].iter().map(|&v| v as f64).collect();
        let level = crate::testutil::level_at(44_100.0, 21_100.0, &y);
        assert!(crate::testutil::db(level) < -70.0, "{} dB", crate::testutil::db(level));
    }

    #[test]
    fn the_band_stays_flat_where_it_matters() {
        for (from, to) in [(48_000u32, 44_100u32), (44_100, 48_000)] {
            for f in [100.0, 5_000.0, 15_000.0, 18_000.0] {
                let n = from as usize;
                let x: Vec<f32> = (0..n).map(|i| (2.0 * std::f64::consts::PI * f * i as f64 / from as f64).sin() as f32).collect();
                let mut a = Resampler::new(from, to, 1);
                let mut out = vec![Vec::new()];
                a.push(&[&x]);
                a.pull(&mut out, true);
                // a whole number of cycles from the middle
                let per = to as f64 / f;
                let len = ((out[0].len() - 2000) as f64 / per).floor() * per;
                let y: Vec<f64> = out[0][1000..1000 + len as usize].iter().map(|&v| v as f64).collect();
                let g = crate::testutil::db(crate::testutil::level_at(to as f64, f, &y));
                assert!(g.abs() < 0.1, "{from}->{to} at {f} Hz: {g} dB");
            }
        }
    }

    #[test]
    fn a_whole_song_goes_in_and_its_stems_come_out_lined_up_and_adding_up_to_it() {
        let dir = crate::recfile::scratch("stems-pipeline");
        let song = dir.with_file_name("pipeline-song.wav");
        let rate = 48_000;
        let x = tone(rate, 50_000, 440.0);
        write_wav(&song, rate, 2, &x);
        let outs: Vec<PathBuf> = (0..3).map(|i| dir.with_file_name(format!("pipeline-stem-{i}.wav"))).collect();
        let mut sep = Shares { seg: 8_000, shares: vec![0.5, 0.3, 0.2], runs: 0, interrupt_on: None, cancel_on: None };
        let cancel = AtomicBool::new(false);
        let mut events = vec![];
        let done = split(&song, &outs, &mut sep, &ctl(&cancel), &mut |e| events.push(e)).map_err(|e| format!("{e:?}")).unwrap();
        assert_eq!(done.rate, rate);
        assert_eq!(done.frames, x.len() as u64);
        // 50 000 frames at 48 kHz are 45 938 at 44.1 kHz: 8 stretches of 8000 with a stride of 6000
        assert_eq!(done.segments, Plan::quarter(8_000).count(45_938));
        assert_eq!(sep.runs as u64, done.segments);
        // the stems are ready a stretch at a time, never going back, ending at the whole song
        let ready: Vec<u64> = events.iter().filter_map(|e| if let Event::Progress { ready, .. } = e { Some(*ready) } else { None }).collect();
        assert_eq!(ready.len() as u64, done.segments);
        assert!(ready.windows(2).all(|w| w[0] < w[1]), "{ready:?}");
        assert!(ready[0] > 0 && ready[0] < 8_000, "the first part is ready after the first stretch: {}", ready[0]);
        assert_eq!(*ready.last().unwrap(), x.len() as u64);
        let stems: Vec<Vec<[f32; 2]>> = outs.iter().map(|p| read_wav(p).1).collect();
        for s in &stems {
            assert_eq!(s.len(), x.len());
        }
        // each stem is its share of the song, at the song's rate and in its place (apart from
        // the very ends, where the rate conversion has no neighbours to work from)
        for (k, s) in stems.iter().enumerate() {
            let share = sep.shares[k];
            let err = s.iter().zip(&x).skip(100).take(x.len() - 200).map(|(a, b)| (a[0] - share * b[0]).abs().max((a[1] - share * b[1]).abs())).fold(0.0f32, f32::max);
            assert!(err < 2e-3 * share.max(0.1) * 4.0, "stem {k}: {err}");
        }
        let sum_err = (100..x.len() - 100).map(|i| (stems.iter().map(|s| s[i][0]).sum::<f32>() - x[i][0]).abs()).fold(0.0f32, f32::max);
        assert!(sum_err < 3e-3, "the stems add up to the song: {sum_err}");
        for p in outs.iter().chain([&song]) {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn a_song_ending_anywhere_in_a_stretch_comes_back_whole_and_unchanged() {
        // lengths around the stretches' edges (4000 long, starting every 3000), including songs
        // whose end is only found after the stretch that covers it has run
        let dir = crate::recfile::scratch("stems-edges");
        for len in [1usize, 2, 2999, 3000, 3999, 4000, 4001, 6999, 7000, 7001, 9000, 10_001] {
            let song = dir.with_file_name(format!("edges-{len}.wav"));
            let x: Vec<[f32; 2]> = (0..len).map(|i| [((i * 7919) % 1000) as f32 / 1000.0 - 0.5, ((i * 104_729) % 997) as f32 / 997.0 - 0.5]).collect();
            write_wav(&song, MODEL_RATE, 2, &x);
            let out = [dir.with_file_name(format!("edges-{len}-stem.wav"))];
            let mut sep = Shares { seg: 4_000, shares: vec![1.0], runs: 0, interrupt_on: None, cancel_on: None };
            let cancel = AtomicBool::new(false);
            let mut ready = vec![];
            let done = split(&song, &out, &mut sep, &ctl(&cancel), &mut |e| {
                if let Event::Progress { ready: r, .. } = e {
                    ready.push(r)
                }
            })
            .map_err(|e| format!("{e:?}"))
            .unwrap();
            assert_eq!(done.frames, len as u64);
            assert_eq!(done.segments, Plan::quarter(4_000).count(len as u64), "{len}: every stretch run once");
            assert!(ready.windows(2).all(|w| w[0] <= w[1]) && *ready.last().unwrap() == len as u64, "{len}: {ready:?}");
            let (_, y) = read_wav(&out[0]);
            assert_eq!(y.len(), len);
            for (i, (a, b)) in y.iter().zip(&x).enumerate() {
                assert!((a[0] - b[0]).abs() < 1e-6 && (a[1] - b[1]).abs() < 1e-6, "{len}, frame {i}: {a:?} vs {b:?}");
            }
            for p in out.iter().chain([&song]) {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    #[test]
    fn a_mono_song_at_the_models_rate_is_split_sample_for_sample() {
        let dir = crate::recfile::scratch("stems-mono");
        let song = dir.with_file_name("mono-song.wav");
        let x = tone(44_100, 20_000, 220.0);
        write_wav(&song, 44_100, 1, &x);
        let outs: Vec<PathBuf> = (0..2).map(|i| dir.with_file_name(format!("mono-stem-{i}.wav"))).collect();
        let mut sep = Shares { seg: 3_000, shares: vec![1.0, 0.0], runs: 0, interrupt_on: None, cancel_on: None };
        let cancel = AtomicBool::new(false);
        split(&song, &outs, &mut sep, &ctl(&cancel), &mut |_| {}).map_err(|e| format!("{e:?}")).unwrap();
        let (rate, a) = read_wav(&outs[0]);
        assert_eq!(rate, 44_100);
        assert_eq!(a.len(), x.len());
        for (i, (s, m)) in a.iter().zip(&x).enumerate() {
            assert!((s[0] - m[0]).abs() < 1e-6 && (s[1] - m[0]).abs() < 1e-6, "{i}: mono is heard on both sides");
        }
        for p in outs.iter().chain([&song]) {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn cancelling_stops_between_stretches_and_a_recording_pauses_the_work() {
        let dir = crate::recfile::scratch("stems-cancel");
        let song = dir.with_file_name("cancel-song.wav");
        write_wav(&song, 44_100, 2, &tone(44_100, 40_000, 330.0));
        let outs: Vec<PathBuf> = (0..2).map(|i| dir.with_file_name(format!("cancel-stem-{i}.wav"))).collect();

        // cancelled while the third stretch is being worked on
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let mut sep = Shares { seg: 4_000, shares: vec![0.5, 0.5], runs: 0, interrupt_on: None, cancel_on: Some((3, cancel.clone())) };
        let r = split(&song, &outs, &mut sep, &ctl(&cancel), &mut |_| {});
        assert!(matches!(r, Err(Stop::Cancelled)));
        assert_eq!(sep.runs, 3);

        // a take is being recorded for a while: the work waits, then goes on where it was;
        // a stretch stopped in the middle by it is done again
        let calls = std::cell::Cell::new(0);
        let busy = || {
            calls.set(calls.get() + 1);
            (3..8).contains(&calls.get())
        };
        let cancel = AtomicBool::new(false);
        let c = Controls { cancel: &cancel, busy: &busy, poll: Duration::from_millis(1) };
        let mut sep = Shares { seg: 4_000, shares: vec![0.5, 0.5], runs: 0, interrupt_on: Some(4), cancel_on: None };
        let mut events = vec![];
        let done = split(&song, &outs, &mut sep, &c, &mut |e| events.push(e)).map_err(|e| format!("{e:?}")).unwrap();
        assert!(events.contains(&Event::Paused) && events.contains(&Event::Resumed));
        assert_eq!(sep.runs as u64, done.segments + 1, "the interrupted stretch was done again");
        assert_eq!(read_wav(&outs[0]).1.len(), 40_000);
        for p in outs.iter().chain([&song]) {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn a_file_that_is_not_sound_is_refused_plainly() {
        let dir = crate::recfile::scratch("stems-bad");
        let bad = dir.with_file_name("not-a-song.mp3");
        std::fs::write(&bad, b"this is not a song at all, just some words").unwrap();
        let mut sep = Shares { seg: 1000, shares: vec![1.0], runs: 0, interrupt_on: None, cancel_on: None };
        let cancel = AtomicBool::new(false);
        let r = split(&bad, &[dir.with_file_name("bad-0.wav")], &mut sep, &ctl(&cancel), &mut |_| {});
        assert!(matches!(r, Err(Stop::Failed(_))));
        let _ = std::fs::remove_file(bad);
    }

    /// The kinds of file the Canvas opens. No encoder is built in, so the files are made outside
    /// (three seconds of two tones, 48 kHz stereo, e.g. with ffmpeg: song.wav, .mp3, .flac, .ogg
    /// (Vorbis), .m4a (AAC), mono22k.wav, and optionally song.opus) and their folder given in
    /// MT_FORMATS_DIR.
    #[test]
    #[ignore = "needs sample files in MT_FORMATS_DIR"]
    fn the_kinds_of_file_the_app_opens_are_read() {
        let dir = PathBuf::from(std::env::var("MT_FORMATS_DIR").expect("MT_FORMATS_DIR"));
        for (name, rate) in [("song.wav", 48_000u32), ("song.mp3", 48_000), ("song.flac", 48_000), ("song.ogg", 48_000), ("song.m4a", 48_000), ("mono22k.wav", 22_050)] {
            let mut src = Source::open(&dir.join(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(src.rate, rate, "{name}");
            let (mut l, mut r) = (vec![], vec![]);
            while src.read(&mut l, &mut r).unwrap() {}
            let secs = l.len() as f64 / rate as f64;
            // lossy formats may keep a few milliseconds of their encoder's padding
            assert!((secs - 3.0).abs() < 0.06, "{name}: {secs} s");
            let rms = |v: &[f32]| (v.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / v.len() as f64).sqrt();
            assert!(rms(&l) > 0.02 && rms(&r) > 0.02, "{name}: there is sound on both sides");
        }
        // Opus is not among the decoders: it is refused with a plain answer, not a crash
        if dir.join("song.opus").exists() {
            assert!(Source::open(&dir.join("song.opus")).is_err());
        }
    }
}

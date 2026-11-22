//! The recording engine. It opens the interface's input and output together (on Windows
//! through its ASIO driver) and, on the interface's own clock:
//! - plays the backing track (the song, rendered by the page) round and round,
//! - plays a click for the count-in (and, if wanted, while recording),
//! - sends the singer's voice through the vocal chain to the headphones ("hear my effects"),
//! - records the voice, dry, to a WAV file from the first click until Stop.
//! The take is lined up with the song from the driver's own timestamps: the moment the first
//! frame of the song is heard, and the moment each recorded sample was captured.
//!
//! A flow session can go round the loop for an hour or more. So the file is kept in step with
//! the song sample for sample: wherever voice is lost (the recorder could not keep up, a block
//! never arrived), silence takes its place and every later pass stays exactly where it was
//! sung. If the driver resets in the middle, the recording is closed and handed back, not lost.
//!
//! One input is a voice: a mono file, and the vocal chain in the headphones. A pair of inputs
//! is recorded as a stereo file and heard as it is, left and right, with no chain. And the song
//! can be played once instead of round and round, for a recording from the cursor: after its
//! last frame the recording goes on in silence until Stop.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamInstant};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request, Response};

use crate::dsp::OutSafety;
use crate::fx::{Chain, VocalFx};
use crate::meter::Shared;
use crate::recfile::{self, Writing, MAX_FRAMES, RENDER};
use crate::through::{self, AppFeed, AppIn};

/// What the audio thread reports. Only the audio thread writes it, and nobody ever has to lock
/// anything the audio thread needs, so the screen can never make the sound drop out.
#[derive(Default)]
pub struct Stats {
    pub pos: AtomicU64,
    pub count_in: AtomicU64,
    pub length: AtomicU64,
    pub running: AtomicBool,
    /// dB of compression, as f32 bits
    pub reduction: AtomicU32,
    /// dB the limiter at the end of the vocal chain is holding back, as f32 bits
    pub limit: AtomicU32,
    /// counts every stop, so a waiting command knows its stop has happened
    pub stops: AtomicU64,
    /// samples of voice that never reached the file
    pub dropped: AtomicU64,
    /// samples of silence the file holds in their place, so later passes keep their time
    pub padded: AtomicU64,
    /// the driver said the computer could not keep up (each one is a little dropout you may hear)
    pub xruns: AtomicU64,
    /// frames in each block the driver asks for (the buffer size actually in use)
    pub block: AtomicU64,
    /// the driver asked to be reset (its buffer size or sample rate was changed)
    pub invalid: AtomicBool,
    /// how late you hear yourself, measured: from the moment the voice reaches the interface to
    /// the moment it comes out of the headphones (ms, as f32 bits; 0 until known)
    pub latency: AtomicU32,
    /// when the first frame of the count-in was heard and the first recorded sample captured
    /// (seconds on the driver's clock, as f64 bits; NaN until known). They are kept the moment
    /// they happen, so a stop the audio thread never answers (the device is gone) knows them too.
    pub play0: AtomicU64,
    pub cap0: AtomicU64,
    /// the file being written
    pub writing: Writing,
    /// times the app's own sound, coming through the engine, ran dry (the page was held up) (see through.rs)
    pub app_gaps: AtomicU64,
}

/// A moment kept as f64 bits, if it is known.
fn moment(a: &AtomicU64) -> Option<f64> {
    let v = f64::from_bits(a.load(Ordering::Relaxed));
    v.is_finite().then_some(v)
}

/// What the singer hears and how (see `engine_set`).
#[derive(Clone)]
pub struct Settings {
    pub monitor: bool,
    pub input: usize,
    /// the second input of a pair (none: one input)
    pub input_b: Option<usize>,
    pub fx: VocalFx,
    pub backing_gain: f32,
    pub click_gain: f32,
    pub click_on: bool,
}

/// Messages to the audio thread. It picks them up at the start of a block, if it can do so
/// without waiting; otherwise at the next one.
pub enum Cmd {
    Set(Box<Settings>),
    Backing(Vec<f32>),
    /// `downbeats`: one entry per beat of the loop, true where a bar begins (see `downbeats`).
    /// `once`: the song is played once, then silence (not round and round). `stereo`: the
    /// recorder takes two samples a frame, left then right (its file is a pair's).
    Start { bpm: f64, count_in_beats: u32, per_bar: u32, downbeats: Vec<bool>, rec: Option<rtrb::Producer<f32>>, once: bool, stereo: bool },
    Stop,
    /// the app's own sound comes through the engine from now on (its end of the queue), or no longer (see through.rs)
    App(Option<Box<AppIn>>),
}

/// What a message leaves behind once the audio thread has taken it in. It is handed back to
/// be freed elsewhere: giving memory back can be slow, and the audio thread never waits.
pub enum Trash {
    Backing(#[allow(dead_code)] Vec<f32>),
    Settings(#[allow(dead_code)] Box<Settings>),
    Downbeats(#[allow(dead_code)] Vec<bool>),
    App(#[allow(dead_code)] Box<AppIn>),
}

/// The most beats a loop's accents are kept for (a loop longer than this clicks on, unaccented
/// past it: far more bars than a song has).
const MAX_BEATS: usize = 1 << 16;

/// Which beats of a loop begin a bar, from how many beats each of its bars has. A loop that
/// runs from a 4/4 section into a 3/4 one accents beat 1 of every bar as it is, not every
/// fourth beat. Built off the audio thread, so the audio thread only looks it up.
pub fn downbeats(bars: &[u32]) -> Vec<bool> {
    let mut out = Vec::with_capacity(bars.iter().map(|b| (*b).max(1) as usize).sum::<usize>().min(MAX_BEATS));
    for b in bars {
        for i in 0..(*b).max(1) {
            if out.len() >= MAX_BEATS {
                return out;
            }
            out.push(i == 0);
        }
    }
    out
}

/// The part of the engine that runs on the audio thread. It knows nothing of the driver, so it
/// can be tested without an interface.
pub struct Core {
    sr: f32,
    in_ch: usize,
    out_ch: usize,
    /// which input is recorded and monitored (0 = Input 1)
    pub input: usize,
    /// the second input of a pair: `input` is then the left side and this the right, recorded
    /// in stereo and heard as they are (no chain). None: one input, a voice.
    pub input_b: Option<usize>,
    /// send the voice through the chain to the headphones
    pub monitor: bool,
    pub fx: VocalFx,
    chain: Chain,
    /// what a pair is turned up or down by on its way to the headphones (see recfile::pair_gain)
    pair_gain: f32,
    backing: Vec<f32>,
    pub backing_gain: f32,
    pub click_gain: f32,
    /// a click while recording too, not only during the count-in
    pub click_on: bool,
    running: bool,
    pending: bool,
    /// frames since the first click
    pos: u64,
    count_in: u64,
    beat: f64,
    /// beats to a bar in the count-in (the meter of the loop's first bar)
    per_bar: u32,
    /// the loop's beats, true where a bar begins; empty: every `per_bar` beats, as in the count-in
    downbeats: Vec<bool>,
    /// the song is played once, then silence, while the recording goes on (see `engine_start`)
    once: bool,
    /// beats in the last bar of `downbeats`: how the click goes on once a once-through has passed them
    last_bar: u32,
    mon: VecDeque<f32>,
    /// the right side of a pair waiting for the headphones: as long as `mon`, frame for frame (empty for one input)
    mon_b: VecDeque<f32>,
    rec: Option<rtrb::Producer<f32>>,
    /// the recorder takes two samples a frame (a pair's file); fixed from start to stop
    rec_pair: bool,
    armed: bool,
    recording: bool,
    /// when the first frame of the count-in is heard, and when the first recorded sample was captured (seconds, driver clock)
    play0: Option<f64>,
    cap0: Option<f64>,
    /// samples of voice that never reached the file, and samples of silence written for them
    /// (frames, in a pair's file: left and right are lost or filled together)
    pub dropped: u64,
    pub padded: u64,
    /// the song's position (output frames) when recording began, and the frames the file holds
    /// since: the two are kept equal, so the file never runs early or late against the song
    rec_pos0: u64,
    kept: u64,
    /// silence still to be written for voice that was lost while the recorder was full
    owed: u64,
    /// voice still to be left out because the file had run ahead of the song
    trim: u64,
    /// the biggest blocks seen coming in and going out (frames): how far the two sides may
    /// wander apart from one block to the next without anything being lost
    block_in: usize,
    block_out: usize,
    /// when the newest block of voice was captured (seconds, driver clock)
    last_cap: Option<f64>,
    /// blocks in a row with more voice waiting than one block: extra delay to be taken out
    over: u32,
    levels: Arc<Shared>,
    pub stats: Arc<Stats>,
    /// the last stage before the interface: nothing the engine plays reaches full scale (see dsp::OutSafety)
    safe: OutSafety,
    /// the app's own sound, while it comes through the engine (see through.rs)
    app: Option<Box<AppIn>>,
}

impl Core {
    pub fn new(sr: f32, in_ch: usize, out_ch: usize, levels: Arc<Shared>) -> Self {
        let fx = VocalFx::default();
        Core {
            sr,
            in_ch: in_ch.max(1),
            out_ch: out_ch.max(1),
            input: 0,
            input_b: None,
            monitor: false,
            chain: Chain::new(sr, &fx),
            pair_gain: recfile::pair_gain(&fx),
            fx,
            backing: vec![],
            backing_gain: 1.0,
            click_gain: 0.5,
            click_on: false,
            running: false,
            pending: false,
            pos: 0,
            count_in: 0,
            beat: sr as f64 * 0.5,
            per_bar: 4,
            downbeats: Vec::new(),
            once: false,
            last_bar: 4,
            mon: VecDeque::with_capacity(16384),
            mon_b: VecDeque::with_capacity(16384),
            rec: None,
            rec_pair: false,
            armed: false,
            recording: false,
            play0: None,
            cap0: None,
            dropped: 0,
            padded: 0,
            rec_pos0: 0,
            kept: 0,
            owed: 0,
            trim: 0,
            block_in: 0,
            block_out: 0,
            last_cap: None,
            over: 0,
            levels,
            stats: Arc::new(Stats::default()),
            safe: OutSafety::new(sr),
            app: None,
        }
    }
    /// A message from the app. What it leaves behind comes back, to be freed off the audio thread.
    pub fn apply(&mut self, cmd: Cmd) -> Option<Trash> {
        match cmd {
            Cmd::Set(s) => {
                self.monitor = s.monitor;
                self.input = s.input;
                if self.input_b.is_some() != s.input_b.is_some() {
                    // one input becomes a pair, or a pair one input: what was waiting for the
                    // headphones was the other kind, so none of it is kept
                    self.mon.clear();
                    self.mon_b.clear();
                    self.over = 0;
                }
                self.input_b = s.input_b;
                if self.fx != s.fx {
                    self.set_fx(&s.fx);
                }
                self.backing_gain = s.backing_gain;
                self.click_gain = s.click_gain;
                self.click_on = s.click_on;
                Some(Trash::Settings(s))
            }
            Cmd::Backing(b) => Some(Trash::Backing(std::mem::replace(&mut self.backing, b))),
            Cmd::Start { bpm, count_in_beats, per_bar, downbeats, rec, once, stereo } => {
                let old = self.start(bpm, count_in_beats, per_bar, downbeats, rec);
                // (nothing has played or been recorded yet: the next block is the first)
                self.once = once;
                self.rec_pair = stereo;
                Some(Trash::Downbeats(old))
            }
            Cmd::Stop => {
                self.stop();
                None
            }
            Cmd::App(Some(a)) => self.app.replace(a).map(Trash::App),
            Cmd::App(None) => {
                // faded out, not cut off: it stays (silent) until the next one takes its place
                if let Some(a) = self.app.as_mut() {
                    a.stop();
                }
                None
            }
        }
    }
    pub fn set_fx(&mut self, fx: &VocalFx) {
        self.fx = fx.clone();
        self.chain.set(fx);
        self.pair_gain = recfile::pair_gain(fx);
    }
    /// The song to play under the singer: stereo, interleaved, at the engine's rate.
    #[cfg(test)]
    pub fn set_backing(&mut self, stereo: Vec<f32>) {
        self.backing = stereo;
    }
    pub fn backing_frames(&self) -> u64 {
        (self.backing.len() / 2) as u64
    }
    /// Start: the count-in, then the song round and round. With a recorder, everything sung is kept.
    /// The accents of the loop before are handed back, to be freed off the audio thread.
    /// (This is the plain start: one input into a mono file, the song going round. A pair's
    /// recorder and a once-through are set by `Cmd::Start`, right after it.)
    pub fn start(&mut self, bpm: f64, count_in_beats: u32, per_bar: u32, downbeats: Vec<bool>, rec: Option<rtrb::Producer<f32>>) -> Vec<bool> {
        self.beat = self.sr as f64 * 60.0 / bpm.max(20.0);
        self.count_in = (self.beat * count_in_beats as f64).round() as u64;
        self.per_bar = per_bar.max(1);
        let old = std::mem::replace(&mut self.downbeats, downbeats);
        self.once = false;
        // the last bar's beats: from its first beat to the end (a handful of steps, no more)
        self.last_bar = self.downbeats.iter().rev().position(|d| *d).map_or(self.per_bar, |i| i as u32 + 1);
        self.rec = rec;
        self.rec_pair = false;
        self.recording = false;
        self.armed = false;
        self.play0 = None;
        self.cap0 = None;
        self.stats.play0.store(f64::NAN.to_bits(), Ordering::Relaxed);
        self.stats.cap0.store(f64::NAN.to_bits(), Ordering::Relaxed);
        self.dropped = 0;
        self.padded = 0;
        self.kept = 0;
        self.owed = 0;
        self.trim = 0;
        self.pending = true;
        old
    }
    /// Stop playing and recording. Returns (heard-at, captured-at) of the first frames, if recorded.
    pub fn stop(&mut self) -> (Option<f64>, Option<f64>) {
        // the silence still owed goes in now, if there is room; what cannot is not in the file
        self.pay_silence();
        self.padded -= self.owed.min(self.padded);
        self.owed = 0;
        self.trim = 0;
        self.running = false;
        self.pending = false;
        self.armed = false;
        self.recording = false;
        self.rec = None;
        self.stats.dropped.store(self.dropped, Ordering::Relaxed);
        self.stats.padded.store(self.padded, Ordering::Relaxed);
        self.stats.running.store(false, Ordering::Relaxed);
        self.stats.stops.fetch_add(1, Ordering::Release);
        (self.play0, self.cap0)
    }
    /// A block from the interface's inputs (interleaved).
    pub fn on_input(&mut self, data: &[f32], captured: f64) {
        self.levels.feed(data);
        let ch = self.in_ch;
        let input = self.input.min(ch - 1);
        // the right side of a pair (one input: none)
        let input_b = self.input_b.map(|b| b.min(ch - 1));
        self.block_in = self.block_in.max(data.len() / ch);
        if self.armed && !self.recording {
            self.recording = true;
            self.cap0 = Some(captured);
            self.stats.cap0.store(captured.to_bits(), Ordering::Relaxed);
            self.rec_pos0 = self.pos;
            self.kept = 0;
        }
        self.last_cap = Some(captured);
        let rec = self.recording && self.rec.is_some();
        if rec {
            self.keep_time();
            self.pay_silence();
        }
        for frame in data.chunks(ch) {
            let v = frame[input];
            if self.monitor {
                if self.mon.len() >= 16384 {
                    self.mon.pop_front();
                }
                self.mon.push_back(v);
                if let Some(b) = input_b {
                    if self.mon_b.len() >= 16384 {
                        self.mon_b.pop_front();
                    }
                    self.mon_b.push_back(frame[b]);
                }
            }
            if rec {
                if self.rec_pair {
                    // (should the pair have been given up for one input meanwhile, the file
                    // stays stereo: that input on both sides)
                    self.keep_pair(v, input_b.map_or(v, |b| frame[b]));
                } else {
                    self.keep(v);
                }
            }
        }
    }

    /// Voice the engine never got to see: a block from the driver that came while the other
    /// callback had the engine, or that the driver lost. `frames` of silence stand in for it,
    /// so what follows stays at its place in time.
    pub fn missed(&mut self, frames: u64) {
        if !(self.recording && self.rec.is_some()) || frames == 0 {
            return;
        }
        self.kept += frames;
        self.owed += frames;
        self.padded += frames;
        self.dropped += frames;
    }

    /// One frame of a pair into the file, left then right: both or neither, so the two sides
    /// can never change places. Otherwise as `keep`.
    fn keep_pair(&mut self, l: f32, r: f32) {
        if self.trim > 0 {
            self.trim -= 1;
            self.dropped += 1;
            return;
        }
        self.kept += 1;
        if self.owed == 0 {
            if let Some(p) = self.rec.as_mut() {
                if let Ok(chunk) = p.write_chunk_uninit(2) {
                    chunk.fill_from_iter([l, r]);
                    return;
                }
            }
        }
        self.owed += 1;
        self.padded += 1;
        self.dropped += 1;
    }

    /// One sample of voice into the file. While silence is still owed (the recorder was full),
    /// voice cannot go in ahead of it: it is lost, and silence stands in for it too.
    fn keep(&mut self, v: f32) {
        if self.trim > 0 {
            self.trim -= 1;
            self.dropped += 1;
            return;
        }
        self.kept += 1;
        if self.owed == 0 {
            if let Some(p) = self.rec.as_mut() {
                if p.push(v).is_ok() {
                    return;
                }
            }
        }
        self.owed += 1;
        self.padded += 1;
        self.dropped += 1;
    }

    /// Write the silence that is owed, as far as the recorder has room: at most 64k samples a
    /// block, in one go, so the audio thread is never kept long. (`owed` counts frames: in a
    /// pair's file each is two samples, written together.)
    fn pay_silence(&mut self) {
        if self.owed == 0 {
            return;
        }
        let Some(p) = self.rec.as_mut() else { return };
        let w = if self.rec_pair { 2 } else { 1 };
        let n = (self.owed as usize).min(p.slots() / w).min((1 << 16) / w);
        if n == 0 {
            return;
        }
        if let Ok(chunk) = p.write_chunk_uninit(n * w) {
            self.owed -= (chunk.fill_from_iter(std::iter::repeat(0.0f32)) / w) as u64;
        }
    }

    /// The file must hold one frame for every frame of song played since recording began:
    /// that is what lets the takes be cut at whole passes, however long the session. On an
    /// ASIO driver the voice and the song come and go together, block for block, so the two
    /// never differ. Should whole blocks of voice go missing while the song plays on (another
    /// kind of driver, a dropout), the gap is filled with silence; should the song stall while
    /// the voice goes on, the extra voice is left out. Only a difference of more than a block
    /// and a half counts, so the ordinary to and fro of two separate callbacks never touches a note.
    fn keep_time(&mut self) {
        if self.trim > 0 {
            return;
        }
        let song = self.pos.saturating_sub(self.rec_pos0) as i64;
        let ahead = song - self.kept as i64;
        let slack = (self.block_in.max(self.block_out) * 3 / 2 + 32) as i64;
        if ahead > slack {
            self.missed(ahead as u64);
        } else if -ahead > slack {
            self.trim = (-ahead) as u64;
        }
    }

    fn click(&self, pos: u64) -> f32 {
        let counting = pos < self.count_in;
        let since = if counting { pos } else if self.click_on { pos - self.count_in } else { return 0.0 };
        // After the count-in the click is counted from the top of the loop on every pass, so it
        // stays on the song's beats however long the session runs, and each bar is accented
        // where it begins in its own section's meter.
        let len = self.backing_frames();
        let looped = !counting && !self.downbeats.is_empty();
        // (a song played once is not gone round: its beats are counted straight on)
        let since = if looped && len > 0 && !self.once { since % len } else { since };
        let beat = (since as f64 / self.beat).floor();
        let into = since as f64 - beat * self.beat;
        let t = into / self.sr as f64;
        if t > 0.06 {
            return 0.0;
        }
        let first = if looped {
            let n = beat as usize;
            match self.downbeats.get(n) {
                Some(d) => *d,
                // once through, past the bars it was given: it clicks on in the last bar's meter
                None if self.once => ((n - self.downbeats.len()) as u64).is_multiple_of(self.last_bar.max(1) as u64),
                // only rounding at the loop's very end: the next pass's first beat is a frame away
                None if len > 0 => return 0.0,
                None => self.downbeats[n % self.downbeats.len()],
            }
        } else {
            (beat as u64) % self.per_bar as u64 == 0
        };
        let f = if first { 1760.0 } else { 1175.0 };
        let env = (-t * 70.0).exp() as f32;
        (2.0 * std::f64::consts::PI * f * t).sin() as f32 * env * self.click_gain * if first { 1.0 } else { 0.7 }
    }

    /// A block for the interface's outputs (interleaved).
    pub fn on_output(&mut self, out: &mut [f32], heard: f64) {
        if self.pending {
            self.pending = false;
            self.running = true;
            self.pos = 0;
            self.play0 = Some(heard);
            self.stats.play0.store(heard.to_bits(), Ordering::Relaxed);
            self.armed = self.rec.is_some();
        }
        let ch = self.out_ch;
        let len = self.backing_frames();
        let frames = out.len() / ch;
        self.block_out = self.block_out.max(frames);
        self.stats.block.store(frames as u64, Ordering::Relaxed);
        // a pair of inputs: its right side waits in `mon_b`, in step with the left in `mon`
        let pair = self.input_b.is_some();
        if pair && self.mon_b.len() != self.mon.len() {
            // (never expected: the two are filled and emptied together. Rather a moment of
            // silence than left and right out of step.)
            self.mon.clear();
            self.mon_b.clear();
        }
        if self.monitor {
            // Never let the voice run dry in the middle of a block: if it has not arrived yet, it
            // is held back by what is missing (a cushion of at most one block) instead of a gap
            // that pops. And never let delay build up: more than a block waiting, for a while,
            // is taken out at once with a short crossfade (no click); far too much is dropped.
            if self.mon.len() > frames * 3 + 64 {
                while self.mon.len() > frames {
                    self.mon.pop_front();
                }
                while self.mon_b.len() > frames {
                    self.mon_b.pop_front();
                }
            }
            self.over = if self.mon.len() > frames { self.over + 1 } else { 0 };
            if self.over >= 16 {
                self.catch_up(frames);
                self.over = 0;
            }
            if self.mon.len() < frames {
                for _ in self.mon.len()..frames {
                    self.mon.push_front(0.0);
                }
            }
            if pair && self.mon_b.len() < frames {
                for _ in self.mon_b.len()..frames {
                    self.mon_b.push_front(0.0);
                }
            }
        } else if !self.mon.is_empty() {
            // nothing old is kept for when monitoring comes back on
            self.mon.clear();
            self.mon_b.clear();
            self.over = 0;
        }
        // how late the singer hears themselves: the driver's own in and out delays (from its
        // timestamps), plus any voice still waiting here
        if let Some(cap) = self.last_cap {
            let waiting = if self.monitor { self.mon.len().saturating_sub(frames) } else { 0 };
            let rtl = heard - cap + waiting as f64 / self.sr as f64;
            if rtl > 0.0 && rtl < 1.0 {
                self.stats.latency.store(((rtl * 1000.0) as f32).to_bits(), Ordering::Relaxed);
            }
        }
        if let Some(a) = self.app.as_mut() {
            a.block(frames, self.sr);
        }
        for frame in out.chunks_mut(ch) {
            let (mut l, mut r) = (0.0f32, 0.0f32);
            // the app's own sound, while it comes through here (see through.rs)
            if let Some(a) = self.app.as_mut() {
                let (x, y) = a.next();
                l += x;
                r += y;
            }
            if self.running {
                // the song: round and round, or once and then silence
                if self.pos >= self.count_in && len > 0 && !(self.once && self.pos - self.count_in >= len) {
                    let i = ((self.pos - self.count_in) % len) as usize * 2;
                    l += self.backing[i] * self.backing_gain;
                    r += self.backing[i + 1] * self.backing_gain;
                }
                let c = self.click(self.pos);
                l += c;
                r += c;
                self.pos += 1;
            }
            if self.monitor {
                let v = self.mon.pop_front().unwrap_or(0.0);
                if pair {
                    // a pair is heard as it is, left and right, at the Output level: no chain
                    l += v * self.pair_gain;
                    r += self.mon_b.pop_front().unwrap_or(0.0) * self.pair_gain;
                } else {
                    let (a, b) = self.chain.run(v);
                    l += a;
                    r += b;
                }
            }
            // the song (turned up by the Song slider), the click and the voice together could go over
            // full scale, which the interface would flatten into a crackle: made safe instead (see dsp::OutSafety)
            let (l, r) = self.safe.run(l, r);
            frame[0] = l;
            if ch > 1 {
                frame[1] = r;
            }
            for x in frame.iter_mut().skip(2) {
                *x = 0.0;
            }
        }
        self.publish();
    }

    /// Take out the voice that is waiting beyond one block, crossfading over the jump.
    fn catch_up(&mut self, frames: usize) {
        let extra = self.mon.len().saturating_sub(frames);
        if extra == 0 {
            return;
        }
        let fade = frames.min(32);
        for i in 0..fade {
            let a = (i + 1) as f32 / (fade + 1) as f32;
            self.mon[i] = self.mon[i] * (1.0 - a) + self.mon[i + extra] * a;
        }
        self.mon.drain(fade..fade + extra);
        // the right side of a pair, the very same way (it is as long as the left)
        if self.mon_b.len() >= fade + extra {
            for i in 0..fade {
                let a = (i + 1) as f32 / (fade + 1) as f32;
                self.mon_b[i] = self.mon_b[i] * (1.0 - a) + self.mon_b[i + extra] * a;
            }
            self.mon_b.drain(fade..fade + extra);
        }
    }

    fn publish(&self) {
        let st = &self.stats;
        st.pos.store(self.pos, Ordering::Relaxed);
        st.count_in.store(self.count_in, Ordering::Relaxed);
        // (a song played once has no loop: its length is reported as 0)
        st.length.store(if self.once { 0 } else { self.backing_frames() }, Ordering::Relaxed);
        st.running.store(self.running || self.pending, Ordering::Relaxed);
        // (a pair does not go through the chain: its two meters rest)
        let (reduction, limit) = if self.input_b.is_none() { (self.chain.reduction(), self.chain.limiting()) } else { (0.0, 0.0) };
        st.reduction.store(reduction.to_bits(), Ordering::Relaxed);
        st.limit.store(limit.to_bits(), Ordering::Relaxed);
        st.dropped.store(self.dropped, Ordering::Relaxed);
        st.padded.store(self.padded, Ordering::Relaxed);
        if let Some(a) = self.app.as_ref() {
            st.app_gaps.store(a.gaps, Ordering::Relaxed);
        }
    }
}

// ── The engine as the app uses it ──────────────────────────────

/// What the app and the audio thread share: messages in, reports out. The audio thread never
/// waits on either.
pub struct Link {
    cmds: Mutex<VecDeque<Cmd>>,
    stats: Arc<Stats>,
    base: OnceLock<StreamInstant>,
    /// the page's end of the queue for the app's own sound, while it comes through (see through.rs)
    feed: Mutex<Option<AppFeed>>,
    /// the settings sent last chose a pair of inputs: the next recording's file is stereo
    pair: AtomicBool,
}
impl Link {
    fn send(&self, c: Cmd) {
        if let Ok(mut q) = self.cmds.lock() {
            q.push_back(c);
        }
    }
}

struct Live {
    link: Arc<Link>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    rate: u32,
}
struct Recording {
    dry: PathBuf,
    stop: Arc<AtomicBool>,
    /// the frames written, and why the writer stopped early, if it did
    thread: Option<JoinHandle<(u64, Option<String>)>>,
    rate: u32,
    /// samples a frame in its file: 1 (one input) or 2 (a pair)
    channels: u16,
    /// the song was played once under it, not round and round
    once: bool,
    /// the reports of the engine it was recorded on (kept here, so it can be closed even after
    /// that engine is gone)
    stats: Arc<Stats>,
}
static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static REC: Mutex<Option<Recording>> = Mutex::new(None);
/// A recording that was closed without anyone to hand it to (the interface was opened again
/// over it): the next close hands it back, so a session is never left behind. Only a close:
/// a stop belongs to whatever was started last (a rehearsal's stop must never find an old
/// recording and spend minutes putting the vocal sound on it), and the page checks that a
/// recording handed back is the one it started before it keeps it.
static LAST: Mutex<Option<Recorded>> = Mutex::new(None);

/// Is a take being recorded right now (from the count-in until Stop)? Heavy work elsewhere in
/// the app (splitting a song into stems) waits while it is, so nothing can disturb a take.
pub fn recording() -> bool {
    REC.lock().map(|g| g.is_some()).unwrap_or(false)
}

fn stash(r: Recorded) {
    if let Ok(mut g) = LAST.lock() {
        *g = Some(r);
    }
}
fn unstash() -> Option<Recorded> {
    LAST.lock().ok().and_then(|mut g| g.take())
}

#[derive(Serialize, Clone)]
pub struct Opened {
    pub host: String,
    pub device: String,
    pub rate: u32,
    pub inputs: u16,
    pub outputs: u16,
    pub format: String,
    /// the buffer sizes the driver allows (frames), when it says
    pub min_buffer: Option<u32>,
    pub max_buffer: Option<u32>,
}

/// About thirty times a second: the input levels, where the music is, and the compression.
#[derive(Serialize, Clone)]
pub struct Status {
    pub peak: Vec<f32>,
    pub rms: Vec<f32>,
    /// frames since the first click; the count-in's length; the loop's length (frames; 0 while
    /// a song is played once: it has no loop)
    pub pos: u64,
    pub count_in: u64,
    pub length: u64,
    pub running: bool,
    /// dB the compressors are turning the voice down
    pub reduction: f32,
    /// dB the limiter is holding back (it should rest at 0: if not, the level going in is too high)
    pub limit: f32,
    /// the driver was reset (its buffer size or rate changed): the interface must be opened again
    pub invalid: bool,
    /// dropouts since the interface was opened (the computer could not keep up at this buffer size)
    pub xruns: u64,
    /// the buffer size in use (frames per block)
    pub block: u64,
    /// how late you hear yourself, measured (ms; 0 until known)
    pub latency: f32,
    /// frames in the recording's file so far
    pub recorded: u64,
    /// frames the recording can still take before its file is as big as a WAV can be
    pub room: u64,
    /// bytes free on the disk the recording is going to (null until known)
    pub free: Option<u64>,
    /// the recording has stopped taking sound (the file is full, or the disk is): stop and save
    pub full: bool,
    /// how far the version through the vocal chain has got (0..1; 0 when none is being made)
    pub render: f32,
    /// times the app's own sound, coming through the engine, ran dry since it started coming through
    pub app_gaps: u64,
}

/// Seconds on the driver's clock, from a fixed starting point.
fn secs(t: StreamInstant, base: &OnceLock<StreamInstant>) -> f64 {
    let b0 = *base.get_or_init(|| t);
    match t.checked_duration_since(b0) {
        Some(d) => d.as_secs_f64(),
        None => -b0.duration_since(t).as_secs_f64(),
    }
}

fn input_stream<T>(d: &cpal::Device, cfg: cpal::StreamConfig, core: Arc<Mutex<Core>>, link: Arc<Link>) -> Result<cpal::Stream, String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let mut buf: Vec<f32> = Vec::with_capacity(16384);
    let bad = link.clone();
    let channels = (cfg.channels as usize).max(1);
    // frames of voice that came while the core was busy, and so never reached it
    let mut missed = 0u64;
    d.build_input_stream::<T, _, _>(
        cfg,
        move |data: &[T], info| {
            crate::rt::audio_thread();
            let _nd = crate::rt::NoDenormals::new();
            buf.clear();
            buf.extend(data.iter().map(|s| f32::from_sample(*s)));
            let at = secs(info.timestamp().capture, &link.base);
            // only the two audio callbacks ever touch the core, one after the other: this never
            // waits. A block that finds the other callback in there is lost, but its length is
            // counted, so the recording keeps its place in time.
            if let Ok(mut c) = core.try_lock() {
                c.missed(std::mem::take(&mut missed));
                c.on_input(&buf, at);
            } else {
                missed += (data.len() / channels) as u64;
            }
        },
        move |e| report(&bad, e),
        None,
    )
    .map_err(|e| e.to_string())
}

fn output_stream<T>(d: &cpal::Device, cfg: cpal::StreamConfig, core: Arc<Mutex<Core>>, link: Arc<Link>, mut trash: rtrb::Producer<Trash>) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let mut buf: Vec<f32> = Vec::with_capacity(16384);
    let bad = link.clone();
    d.build_output_stream::<T, _, _>(
        cfg,
        move |data: &mut [T], info| {
            crate::rt::audio_thread();
            let _nd = crate::rt::NoDenormals::new();
            buf.clear();
            buf.resize(data.len(), 0.0);
            let at = secs(info.timestamp().playback, &link.base);
            if let Ok(mut c) = core.try_lock() {
                // messages from the app, if they can be had without waiting
                if let Ok(mut q) = link.cmds.try_lock() {
                    while let Some(cmd) = q.pop_front() {
                        if let Some(t) = c.apply(cmd) {
                            let _ = trash.push(t);
                        }
                    }
                }
                c.on_output(&mut buf, at);
            }
            for (o, v) in data.iter_mut().zip(buf.iter()) {
                *o = T::from_sample(*v);
            }
        },
        move |e| report(&bad, e),
        None,
    )
    .map_err(|e| e.to_string())
}

/// What the driver reports. A dropout (the computer did not keep up) is only counted: the
/// stream carries on. Only a reset or a lost device means the interface must be opened again.
fn report(link: &Link, e: cpal::Error) {
    match e.kind() {
        cpal::ErrorKind::Xrun => {
            link.stats.xruns.fetch_add(1, Ordering::Relaxed);
        }
        cpal::ErrorKind::StreamInvalidated | cpal::ErrorKind::DeviceNotAvailable => link.stats.invalid.store(true, Ordering::Relaxed),
        _ => eprintln!("audio: {e}"),
    }
}

fn device(host: &str, name: &str) -> Result<(cpal::Host, cpal::Device), String> {
    let id = cpal::available_hosts().into_iter().find(|h| h.name().eq_ignore_ascii_case(host)).ok_or_else(|| format!("No {host} audio on this computer"))?;
    let h = cpal::host_from_id(id).map_err(|e| e.to_string())?;
    let d = h.devices().map_err(|e| e.to_string())?.find(|d| d.to_string() == name).ok_or_else(|| format!("{name} is not connected"))?;
    Ok((h, d))
}

fn close_engine() {
    let live = LIVE.lock().ok().and_then(|mut g| g.take());
    if let Some(mut l) = live {
        l.stop.store(true, Ordering::Relaxed);
        if let Some(t) = l.thread.take() {
            let _ = t.join();
        }
    }
}

fn link() -> Result<(Arc<Link>, u32), String> {
    let g = LIVE.lock().map_err(|_| "engine busy")?;
    let l = g.as_ref().ok_or("The interface is not open")?;
    Ok((l.link.clone(), l.rate))
}

/// Only one thing talks to the audio drivers at a time: listing them, opening, closing. (Two at
/// once, say a list while the interface is being opened, can upset an ASIO driver.)
pub static DRIVER: Mutex<()> = Mutex::new(());
pub fn driver_lock() -> std::sync::MutexGuard<'static, ()> {
    DRIVER.lock().unwrap_or_else(|e| e.into_inner())
}

/// Open the interface (input and output together) and start reporting levels. It runs off the
/// app's main thread, so a slow driver can never freeze the window.
#[tauri::command]
pub async fn engine_open(host: String, device_name: String, buffer: Option<u32>, status: Channel<Status>) -> Result<Opened, String> {
    tauri::async_runtime::spawn_blocking(move || open(host, device_name, buffer, status)).await.map_err(|e| e.to_string())?
}

fn open(host: String, device_name: String, buffer: Option<u32>, status: Channel<Status>) -> Result<Opened, String> {
    let _driver = driver_lock();
    crate::meter::stop();
    // a recording still going is closed properly first, and kept for whoever closes next
    if REC.lock().map(|g| g.is_some()).unwrap_or(false) {
        if let Ok(Some(r)) = engine_stop_inner() {
            stash(r);
        }
    }
    close_engine();
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<Result<(Opened, Arc<Link>), String>>();
    let flag = stop.clone();
    let thread = std::thread::spawn(move || {
        let made = (|| -> Result<(Vec<cpal::Stream>, Arc<Link>, Arc<Shared>, Opened, rtrb::Consumer<Trash>), String> {
            let (h, d) = device(&host, &device_name)?;
            let oc = d.default_output_config().map_err(|e| format!("No outputs: {e}"))?;
            let ic = d.default_input_config().map_err(|e| format!("No inputs: {e}"))?;
            let rate = oc.sample_rate();
            let mut icfg = ic.config();
            icfg.sample_rate = rate;
            let mut ocfg = oc.config();
            // the buffer size: the app asks the driver for one (within what it allows), or leaves the driver's own
            let (min_buffer, max_buffer) = match oc.buffer_size() {
                cpal::SupportedBufferSize::Range { min, max } => (Some(*min), Some(*max)),
                _ => (None, None),
            };
            if let Some(n) = buffer {
                let n = n.clamp(min_buffer.unwrap_or(16), max_buffer.unwrap_or(4096));
                icfg.buffer_size = cpal::BufferSize::Fixed(n);
                ocfg.buffer_size = cpal::BufferSize::Fixed(n);
            }
            let shared = Arc::new(Shared::new(icfg.channels as usize));
            let c = Core::new(rate as f32, icfg.channels as usize, ocfg.channels as usize, shared.clone());
            let link = Arc::new(Link { cmds: Mutex::new(VecDeque::new()), stats: c.stats.clone(), base: OnceLock::new(), feed: Mutex::new(None), pair: AtomicBool::new(false) });
            let core = Arc::new(Mutex::new(c));
            let (trash_in, trash_out) = rtrb::RingBuffer::<Trash>::new(64);
            let input = match ic.sample_format() {
                SampleFormat::F32 => input_stream::<f32>(&d, icfg.clone(), core.clone(), link.clone()),
                SampleFormat::I32 => input_stream::<i32>(&d, icfg.clone(), core.clone(), link.clone()),
                SampleFormat::I16 => input_stream::<i16>(&d, icfg.clone(), core.clone(), link.clone()),
                other => Err(format!("Inputs send {other} samples, which the engine cannot read yet")),
            }?;
            let output = match oc.sample_format() {
                SampleFormat::F32 => output_stream::<f32>(&d, ocfg.clone(), core.clone(), link.clone(), trash_in),
                SampleFormat::I32 => output_stream::<i32>(&d, ocfg.clone(), core.clone(), link.clone(), trash_in),
                SampleFormat::I16 => output_stream::<i16>(&d, ocfg.clone(), core.clone(), link.clone(), trash_in),
                other => Err(format!("Outputs take {other} samples, which the engine cannot write yet")),
            }?;
            // input first, so each block of voice is in hand before the block of sound that follows it
            input.play().map_err(|e| e.to_string())?;
            output.play().map_err(|e| e.to_string())?;
            let opened = Opened { host: h.id().name().to_string(), device: d.to_string(), rate, inputs: icfg.channels, outputs: ocfg.channels, format: oc.sample_format().to_string(), min_buffer, max_buffer };
            Ok((vec![input, output], link, shared, opened, trash_out))
        })();
        match made {
            Err(e) => {
                let _ = tx.send(Err(e));
            }
            Ok((streams, link, shared, opened, mut trash_out)) => {
                // full speed and no sleep while the interface is open
                let _session = crate::rt::Session::begin();
                let _ = tx.send(Ok((opened, link.clone())));
                let st = &link.stats;
                while !flag.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(33));
                    // reports are read from atomics: the audio thread is never kept waiting
                    let l = shared.take();
                    let recorded = st.writing.written.load(Ordering::Relaxed);
                    let free = st.writing.free.load(Ordering::Relaxed);
                    let msg = Status {
                        peak: l.peak,
                        rms: l.rms,
                        pos: st.pos.load(Ordering::Relaxed),
                        count_in: st.count_in.load(Ordering::Relaxed),
                        length: st.length.load(Ordering::Relaxed),
                        running: st.running.load(Ordering::Relaxed),
                        reduction: f32::from_bits(st.reduction.load(Ordering::Relaxed)),
                        limit: f32::from_bits(st.limit.load(Ordering::Relaxed)),
                        invalid: st.invalid.load(Ordering::Relaxed),
                        xruns: st.xruns.load(Ordering::Relaxed),
                        block: st.block.load(Ordering::Relaxed),
                        latency: f32::from_bits(st.latency.load(Ordering::Relaxed)),
                        recorded,
                        room: MAX_FRAMES.saturating_sub(recorded),
                        free: (free > 0).then_some(free),
                        full: st.writing.full.load(Ordering::Relaxed),
                        render: f32::from_bits(RENDER.load(Ordering::Relaxed)),
                        app_gaps: st.app_gaps.load(Ordering::Relaxed),
                    };
                    // what the audio thread has finished with is freed here
                    while trash_out.pop().is_ok() {}
                    if status.send(msg).is_err() {
                        break;
                    }
                }
                drop(streams);
            }
        }
    });
    match rx.recv_timeout(Duration::from_secs(10)).unwrap_or_else(|_| Err("The audio driver did not answer".into())) {
        Err(e) => {
            stop.store(true, Ordering::Relaxed);
            Err(e)
        }
        Ok((opened, link)) => {
            if let Ok(mut g) = LIVE.lock() {
                *g = Some(Live { link, stop, thread: Some(thread), rate: opened.rate });
            }
            Ok(opened)
        }
    }
}

/// Close the interface. A recording still going (the driver was reset in the middle of a
/// session) is closed properly and handed back, dry: the page cuts its takes and has the vocal
/// sound put on separately, so the interface can be opened again straight away.
#[tauri::command]
pub async fn engine_close() -> Option<Recorded> {
    tauri::async_runtime::spawn_blocking(|| {
        let _driver = driver_lock();
        let r = close_inner();
        close_engine();
        r
    })
    .await
    .ok()
    .flatten()
}

/// The recording to hand back on a close: the one still going, else one closed earlier with
/// nobody to hand it to.
fn close_inner() -> Option<Recorded> {
    engine_stop_inner().ok().flatten().or_else(unstash)
}

/// What the singer hears and how: monitoring through the chain, which input, the chain's settings, levels.
/// `input_b` (left out for a voice): the second input of a pair. `input` is then the left side
/// and `input_b` the right; the pair is heard as it is, left and right, at the chain's Output
/// level and with nothing else of the chain, and the next recording started is a stereo file.
#[tauri::command]
pub fn engine_set(monitor: bool, input: usize, input_b: Option<usize>, fx: VocalFx, backing_gain: f32, click_gain: f32, click_on: bool) -> Result<(), String> {
    let (l, _) = link()?;
    l.pair.store(input_b.is_some(), Ordering::Relaxed);
    l.send(Cmd::Set(Box::new(Settings { monitor, input, input_b, fx, backing_gain: backing_gain.clamp(0.0, 2.0), click_gain: click_gain.clamp(0.0, 1.5), click_on })));
    Ok(())
}

/// The song to sing over, as raw little-endian 32-bit floats, stereo, at the engine's rate.
#[tauri::command]
pub fn engine_backing(request: Request) -> Result<u64, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw audio".into()) };
    let samples: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let frames = (samples.len() / 2) as u64;
    let (l, _) = link()?;
    l.send(Cmd::Backing(samples));
    Ok(frames)
}

/// The app's own sound comes through the engine from now on, at the page's `rate` (so it never
/// plays through the computer's sound at the same time as the engine plays through the
/// interface), or no longer (`None`: what is queued fades out). See through.rs.
#[tauri::command]
pub fn engine_app(rate: Option<u32>) -> Result<(), String> {
    let (l, engine_rate) = link()?;
    match rate {
        Some(r) if (8000..=384_000).contains(&r) => {
            let (feed, app) = through::queue(r, engine_rate as f32);
            if let Ok(mut f) = l.feed.lock() {
                *f = Some(feed);
            }
            l.send(Cmd::App(Some(Box::new(app))));
        }
        Some(r) => return Err(format!("{r} Hz is not a sample rate")),
        None => {
            if let Ok(mut f) = l.feed.lock() {
                *f = None;
            }
            l.send(Cmd::App(None));
        }
    }
    Ok(())
}

/// A block of the app's own sound: raw little-endian 32-bit floats, stereo, at the rate given to
/// `engine_app`. Returns the frames queued now.
#[tauri::command]
pub fn engine_feed(request: Request) -> Result<u32, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw audio".into()) };
    let (l, _) = link()?;
    let mut g = l.feed.lock().map_err(|_| "engine busy")?;
    let f = g.as_mut().ok_or("the app's sound is not coming through the engine")?;
    Ok(f.push_bytes(bytes) as u32)
}

/// The folder takes are written to: Music\M-Theory\Recordings.
fn recordings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let base = app.path().audio_dir().or_else(|_| app.path().app_data_dir()).map_err(|e| e.to_string())?;
    let dir = base.join("M-Theory").join("Recordings");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Start: the count-in, then the song round and round; with `record`, everything sung is written to a new file.
/// `bars`: how many beats each bar of the loop has, in order (sections can differ); without it,
/// every bar has `beats_per_bar`.
/// `once` (left out: no): the song is played once, then silence, and the recording goes on
/// until Stop (a recording from the cursor). There is then no loop: the status reports a
/// length of 0 and `Recorded.loop_frames` is 0. The click, if it is on while recording, goes on
/// past the song's end (in the last bar's meter).
/// The file is stereo when the settings sent last chose a pair of inputs (`engine_set`).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn engine_start(app: tauri::AppHandle, bpm: f64, count_in_beats: u32, beats_per_bar: u32, bars: Option<Vec<u32>>, record: bool, name: String, once: Option<bool>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || start(app, bpm, count_in_beats, beats_per_bar, bars.unwrap_or_default(), record, name, once.unwrap_or(false))).await.map_err(|e| e.to_string())?
}

#[allow(clippy::too_many_arguments)]
fn start(app: tauri::AppHandle, bpm: f64, count_in_beats: u32, beats_per_bar: u32, bars: Vec<u32>, record: bool, name: String, once: bool) -> Result<Option<String>, String> {
    // a recording still going is closed and kept, never thrown away
    if let Ok(Some(r)) = engine_stop_inner() {
        stash(r);
    }
    let (l, rate) = link()?;
    let mut producer = None;
    let mut path = None;
    let mut stereo = false;
    if record {
        let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' }).collect();
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let dry = recordings_dir(&app)?.join(format!("{safe}-{stamp}.wav"));
        // one input: a mono file. A pair (as the settings sent last say): a stereo one
        let channels: u16 = if l.pair.load(Ordering::Relaxed) { 2 } else { 1 };
        stereo = channels == 2;
        let (p, rec) = recorder(dry, rate, channels, once, &l.stats)?;
        producer = Some(p);
        path = Some(rec.dry.to_string_lossy().to_string());
        if let Ok(mut g) = REC.lock() {
            *g = Some(rec);
        }
    }
    l.send(Cmd::Start { bpm, count_in_beats, per_bar: beats_per_bar, downbeats: downbeats(&bars), rec: producer, once, stereo });
    Ok(path)
}

/// A new file for a recording, and the thread that writes into it what the audio thread sends:
/// `channels` samples a frame (1: one input; 2: a pair, left then right). Returns the audio
/// thread's end of the queue between the two, and the recording to keep until it is closed.
fn recorder(dry: PathBuf, rate: u32, channels: u16, once: bool, stats: &Arc<Stats>) -> Result<(rtrb::Producer<f32>, Recording), String> {
    // twenty seconds of voice can wait here while the disk is busy
    let (p, cons) = rtrb::RingBuffer::<f32>::new(rate as usize * 20 * channels as usize);
    let spec = hound::WavSpec { channels, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let w = hound::WavWriter::create(&dry, spec).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let st = stats.clone();
    st.writing.written.store(0, Ordering::Relaxed);
    st.writing.free.store(0, Ordering::Relaxed);
    st.writing.full.store(false, Ordering::Relaxed);
    st.play0.store(f64::NAN.to_bits(), Ordering::Relaxed);
    st.cap0.store(f64::NAN.to_bits(), Ordering::Relaxed);
    let dir = dry.parent().map(Path::to_path_buf);
    let thread = std::thread::spawn(move || recfile::write_voice(cons, w, &flag, &st.writing, rate, MAX_FRAMES, || dir.as_deref().and_then(recfile::free_space)));
    Ok((p, Recording { dry, stop, thread: Some(thread), rate, channels, once, stats: stats.clone() }))
}

#[derive(Serialize, Clone)]
pub struct Recorded {
    pub dry: String,
    pub wet: String,
    pub rate: u32,
    /// samples a frame in the file: 1 (one input, a mono file) or 2 (a pair: left, right)
    pub channels: u16,
    /// frames in the file
    pub frames: u64,
    /// where the first frame of the count-in lies in the file (the driver's round trip), in frames
    pub offset: i64,
    pub count_in: u64,
    /// the loop's length in frames; 0 when the song was played once (there are no passes to cut)
    pub loop_frames: u64,
    /// frames of voice that never reached the file
    pub dropped: u64,
    /// frames of silence the file holds in their place (so every later pass keeps its time)
    pub padded: u64,
    /// why the recording stopped taking sound early, or why it has no vocal sound on it, if so
    pub note: Option<String>,
}

/// Stop the music and close the recording, if there is one. The music is stopped on the
/// interface if it is still there; the recording is closed whether or not it is, from what was
/// kept as it happened.
fn engine_stop_inner() -> Result<Option<Recorded>, String> {
    if let Ok((l, _)) = link() {
        let st = &l.stats;
        let before = st.stops.load(Ordering::Acquire);
        l.send(Cmd::Stop);
        // the audio thread stops at its next block; wait for it (a second at most, in case the device is gone)
        for _ in 0..500 {
            if st.stops.load(Ordering::Acquire) != before {
                break;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    let rec = REC.lock().ok().and_then(|mut g| g.take());
    Ok(rec.map(finish))
}

/// Close a recording's file (what is still on its way is written first) and say what it holds.
fn finish(mut rec: Recording) -> Recorded {
    let st = rec.stats.clone();
    let rate = rec.rate;
    rec.stop.store(true, Ordering::Relaxed);
    let (frames, note) = rec.thread.take().map(|t| t.join().unwrap_or((0, Some("the writer stopped".into())))).unwrap_or((0, None));
    let offset = match (moment(&st.play0), moment(&st.cap0)) {
        (Some(heard), Some(captured)) => ((heard - captured) * rate as f64).round() as i64,
        _ => 0,
    };
    Recorded {
        dry: rec.dry.to_string_lossy().to_string(),
        wet: String::new(),
        rate,
        channels: rec.channels,
        frames,
        offset,
        count_in: st.count_in.load(Ordering::Relaxed),
        loop_frames: if rec.once { 0 } else { st.length.load(Ordering::Relaxed) },
        dropped: st.dropped.load(Ordering::Relaxed),
        padded: st.padded.load(Ordering::Relaxed),
        note,
    }
}

/// Stop playing; if recording, close the file and make the version with the vocal chain on it.
/// If that version cannot be made (no room left on the disk), the takes are kept dry: they
/// play as sung, and the vocal sound can be put on later. (A pair's second file is the pair at
/// the chain's Output level and nothing else: see recfile::stream_pair.)
#[tauri::command]
pub async fn engine_stop(fx: VocalFx) -> Result<Option<Recorded>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<Recorded>, String> {
        let Some(mut r) = engine_stop_inner()? else { return Ok(None) };
        match recfile::render_wet(Path::new(&r.dry), &fx) {
            Ok(w) => r.wet = w,
            Err(e) => {
                r.wet = r.dry.clone();
                r.note = Some(match r.note.take() {
                    Some(n) => format!("{n}; no vocal sound ({e})"),
                    None => format!("no vocal sound ({e})"),
                });
            }
        }
        Ok(Some(r))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Make the version with the vocal chain again, after its settings were changed (or for a
/// recording handed back without it). For a stereo file (a pair): the pair at the Output level.
#[tauri::command]
pub async fn fx_render(dry: String, fx: VocalFx) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || recfile::render_wet(Path::new(&dry), &fx)).await.map_err(|e| e.to_string())?
}

/// A whole recording, as bytes. (Takes are read with `read_take_range`; this stays for
/// anything that wants a whole file.)
#[tauri::command]
pub async fn read_take(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !recfile::is_recording(&p) {
        return Err("only recordings can be read".into());
    }
    tauri::async_runtime::spawn_blocking(move || std::fs::read(p)).await.map_err(|e| e.to_string())?.map(Response::new).map_err(|e| e.to_string())
}

/// One take of a recording, as a small WAV of its own: `frames` frames from `start`, with as
/// many channels as the file has (one for a voice, both of a pair). Only
/// that part of the file is read, so a take from an hour-long session costs no more than any
/// other. A first take can begin a moment before the file does (a timing nudge earlier than the
/// driver's round trip, with no count-in): that moment comes back as silence.
#[tauri::command]
pub async fn read_take_range(path: String, start: i64, frames: u64) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !recfile::is_recording(&p) {
        return Err("only recordings can be read".into());
    }
    tauri::async_runtime::spawn_blocking(move || recfile::read_range(&p, start, frames)).await.map_err(|e| e.to_string())?.map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    fn core() -> Core {
        Core::new(SR, 2, 2, Arc::new(Shared::new(2)))
    }

    #[test]
    fn the_apps_own_sound_comes_through_alongside_the_voice_and_fades_out_when_it_stops() {
        let mut c = core();
        c.monitor = true;
        let (mut feed, app) = crate::through::queue(48000, SR);
        assert!(c.apply(Cmd::App(Some(Box::new(app)))).is_none());
        // the page sends half a second of a tone, as raw bytes
        let tone: Vec<u8> = (0..24000).flat_map(|i| { let v = 0.3 * (i as f32 * 0.05).sin(); [v, v] }).flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(feed.push_bytes(&tone), 24000);
        let mut out = vec![0.0f32; 1024];
        let mut peak = 0.0f32;
        for _ in 0..30 {
            let voice: Vec<f32> = vec![0.0; 1024];
            c.on_input(&voice, 0.0);
            c.on_output(&mut out, 0.0);
            peak = out.iter().fold(peak, |m, v| m.max(v.abs()));
        }
        assert!(peak > 0.29 && peak < 0.31, "the tone, at its own level: {peak}");
        // stopped: it fades out (no step bigger than the tone's own), then is silent
        c.apply(Cmd::App(None));
        let mut all = vec![];
        for _ in 0..5 {
            c.on_output(&mut out, 0.0);
            all.extend(out.chunks(2).map(|f| f[0]));
        }
        assert!(all.windows(2).all(|w| (w[1] - w[0]).abs() < 0.02));
        assert!(all[all.len() - 1000..].iter().all(|v| *v == 0.0));
        // a new one takes its place, and the old one comes back to be freed off the audio thread
        let (_feed2, app2) = crate::through::queue(44100, SR);
        assert!(matches!(c.apply(Cmd::App(Some(Box::new(app2)))), Some(Trash::App(_))));
    }

    #[test]
    fn the_count_in_clicks_then_the_song_plays_round_and_round() {
        let mut c = core();
        // a "song" of one bar at 120 bpm: 2 s of a steady level on the left
        c.set_backing((0..96000).flat_map(|_| [0.25f32, 0.0]).collect());
        c.start(120.0, 4, 4, vec![], None);
        let mut out = vec![0.0f32; 1024];
        let mut heard = vec![];
        for b in 0..450 {
            c.on_output(&mut out, b as f64 * 512.0 / SR as f64);
            heard.extend(out.chunks(2).map(|f| f[0]));
        }
        // count-in: 4 beats of 0.5 s = 96000 frames; a click at each beat, silence between
        assert!(heard[100].abs() > 0.01, "a click at the first beat");
        assert!(heard[20000].abs() < 1e-6, "silence between clicks");
        assert!(heard[24000 + 100].abs() > 0.01, "the second beat");
        // then the song, and round again after 96000 frames
        assert!((heard[96000 + 10000] - 0.25).abs() < 1e-6);
        assert!((heard[96000 + 96000 + 10000] - 0.25).abs() < 1e-6);
    }

    #[test]
    fn a_loop_across_meters_knows_where_each_bar_begins() {
        assert_eq!(downbeats(&[4, 3]), vec![true, false, false, false, true, false, false]);
        assert_eq!(downbeats(&[2, 0]), vec![true, false, true], "a bar has at least one beat");
        assert!(downbeats(&[]).is_empty());
        assert_eq!(downbeats(&[u32::MAX]).len(), MAX_BEATS, "never more than the cap");
    }

    #[test]
    fn the_click_accents_each_bar_in_its_own_meter_on_every_pass() {
        let mut c = core();
        // a loop of a 4/4 bar then a 3/4 bar at 120 bpm: 7 beats of 24000 frames
        c.set_backing(vec![0.0; 7 * 24000 * 2]);
        c.click_on = true;
        c.click_gain = 1.0;
        c.start(120.0, 4, 4, downbeats(&[4, 3]), None);
        let mut out = vec![0.0f32; 1024];
        let mut heard = vec![];
        while heard.len() < 96000 + 2 * 7 * 24000 {
            c.on_output(&mut out, 0.0);
            heard.extend(out.chunks(2).map(|f| f[0]));
        }
        // the loudest moment just after a beat: 1.0 where a bar begins (its tip rounded off by the
        // output's safety stage), 0.7 on the other beats
        let peak = |at: usize| heard[at..at + 1500].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        let beat = |k: usize| 96000 + k * 24000;
        assert!(peak(0) > 0.85 && peak(24000) < 0.8, "the count-in: four beats, the first accented");
        for (k, down) in [(0, true), (1, false), (4, true), (5, false), (7, true), (8, false), (11, true), (12, false)] {
            assert_eq!(peak(beat(k)) > 0.85, down, "beat {k} of the loop (from the first pass)");
            assert!(peak(beat(k)) > 0.5, "every beat clicks");
        }
    }

    #[test]
    fn the_voice_is_recorded_from_the_first_click_with_both_moments_known() {
        let mut c = core();
        c.set_backing(vec![0.0; 2000]);
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(100000);
        c.start(120.0, 4, 4, vec![], Some(p));
        let mut out = vec![0.0f32; 512];
        // before the output starts the count-in, nothing is kept
        c.on_input(&[0.5, 0.0, 0.5, 0.0], 0.0);
        assert_eq!(cons.slots(), 0);
        c.on_output(&mut out, 1.010);
        // input 1 is kept, input 2 is not
        let block: Vec<f32> = (0..512).flat_map(|i| [i as f32 / 512.0, 9.0]).collect();
        c.on_input(&block, 1.004);
        assert_eq!(cons.slots(), 512);
        assert!(cons.pop().unwrap() == 0.0 && cons.pop().unwrap() > 0.0);
        let (heard, captured) = c.stop();
        // the singer hears frame 0 at 1.010 s; the first sample kept was captured at 1.004 s:
        // the take must be moved 6 ms (288 frames) earlier
        assert!(((heard.unwrap() - captured.unwrap()) * SR as f64 - 288.0).abs() < 1e-6);
    }

    #[test]
    fn the_engine_never_plays_at_full_scale_and_leaves_a_quiet_sum_untouched() {
        // the loudest it can be asked for: a backing at full scale under the Song slider at 1.5,
        // the click at full, and a voice monitored through the chain at its own limit
        let mut c = core();
        c.set_backing((0..48000).flat_map(|i| { let v = (i as f32 * 0.05).sin(); [v, -v] }).collect());
        c.backing_gain = 1.5;
        c.click_gain = 1.0;
        c.click_on = true;
        c.monitor = true;
        c.start(120.0, 1, 4, vec![], None);
        let mut out = vec![0.0f32; 1024];
        let mut peak = 0.0f32;
        for _ in 0..300 {
            let voice: Vec<f32> = (0..512).flat_map(|i| { let v = 0.9 * (i as f32 * 0.2).sin(); [v, v] }).collect();
            c.on_input(&voice, 0.0);
            c.on_output(&mut out, 0.0);
            peak = out.iter().fold(peak, |m, v| m.max(v.abs()));
        }
        assert!(peak < crate::dsp::OUT_CEILING, "peak {peak}");
        assert!(peak > 0.85, "it is held near the ceiling, not squashed far under it: {peak}");

        // a quiet song with the click: the limiter never moves, so it passes bit for bit (OutSafety
        // hands back exactly what it was given while its gain is 1)
        let mut q = core();
        q.set_backing((0..48000).flat_map(|i| { let v = 0.3 * (i as f32 * 0.01).sin(); [v, 0.5 * v] }).collect());
        q.click_gain = 0.4;
        q.start(120.0, 1, 4, vec![], None);
        let mut a = vec![0.0f32; 1024];
        for _ in 0..200 {
            q.on_output(&mut a, 0.0);
            assert_eq!(q.safe.gain(), 1.0);
        }
    }

    #[test]
    fn monitoring_sends_the_chosen_input_through_the_chain() {
        let mut c = core();
        c.monitor = true;
        c.input = 1;
        c.set_fx(&VocalFx { on: false, ..VocalFx::default() });
        let block: Vec<f32> = (0..256).flat_map(|_| [0.9, 0.3]).collect();
        c.on_input(&block, 0.0);
        let mut out = vec![0.0f32; 512];
        c.on_output(&mut out, 0.0);
        assert!(out.iter().all(|v| (*v - 0.3).abs() < 1e-6), "input 2, untouched with the chain off");
        c.monitor = false;
        c.on_input(&block, 0.0);
        c.on_output(&mut out, 0.0);
        assert!(out.iter().all(|v| *v == 0.0), "no monitoring: silence");
    }

    #[test]
    fn messages_reach_the_audio_thread_and_stops_are_reported() {
        let mut c = core();
        c.apply(Cmd::Set(Box::new(Settings { monitor: true, input: 1, input_b: None, fx: VocalFx::default(), backing_gain: 0.5, click_gain: 0.2, click_on: true })));
        assert!(c.monitor && c.input == 1 && c.backing_gain == 0.5 && c.click_on);
        c.apply(Cmd::Backing(vec![0.1; 400]));
        assert_eq!(c.backing_frames(), 200);
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 4, per_bar: 4, downbeats: vec![], rec: None, once: false, stereo: false });
        let mut out = vec![0.0f32; 512];
        c.on_output(&mut out, 0.0);
        assert!(c.stats.running.load(Ordering::Relaxed));
        assert_eq!(c.stats.pos.load(Ordering::Relaxed), 256);
        c.apply(Cmd::Stop);
        assert_eq!(c.stats.stops.load(Ordering::Relaxed), 1);
        assert!(!c.stats.running.load(Ordering::Relaxed));
    }

    #[test]
    fn a_late_voice_is_held_back_a_little_instead_of_breaking_up() {
        let mut c = core();
        c.monitor = true;
        c.set_fx(&VocalFx { on: false, ..VocalFx::default() });
        let block: Vec<f32> = (0..256).flat_map(|_| [0.5, 0.0]).collect();
        // the output asks before the input has arrived: silence, then the voice, without a gap after
        let mut out = vec![0.0f32; 512];
        c.on_output(&mut out, 0.0);
        for _ in 0..20 {
            c.on_input(&block, 0.0);
            c.on_output(&mut out, 0.0);
            assert!(out.chunks(2).all(|f| (f[0] - 0.5).abs() < 1e-6), "a steady voice, no dropouts");
        }
    }

    #[test]
    fn a_dropout_is_counted_and_the_stream_carries_on_a_reset_reopens() {
        let link = Link { cmds: Mutex::new(VecDeque::new()), stats: Arc::new(Stats::default()), base: OnceLock::new(), feed: Mutex::new(None), pair: AtomicBool::new(false) };
        report(&link, cpal::Error::new(cpal::ErrorKind::Xrun));
        report(&link, cpal::Error::new(cpal::ErrorKind::Xrun));
        assert_eq!(link.stats.xruns.load(Ordering::Relaxed), 2);
        assert!(!link.stats.invalid.load(Ordering::Relaxed), "a dropout never closes the interface");
        report(&link, cpal::Error::new(cpal::ErrorKind::StreamInvalidated));
        assert!(link.stats.invalid.load(Ordering::Relaxed));
    }

    #[test]
    fn monitoring_never_builds_up_delay() {
        let mut c = core();
        c.monitor = true;
        // the input runs ahead by ten blocks; the output catches up at once
        for _ in 0..10 {
            c.on_input(&vec![0.1; 512], 0.0);
        }
        let mut out = vec![0.0f32; 512];
        c.on_output(&mut out, 0.0);
        assert!(c.mon.len() <= 256 * 3 + 64);
    }

    #[test]
    fn extra_delay_is_taken_out_smoothly_and_the_delay_heard_is_measured() {
        let mut c = core();
        c.monitor = true;
        c.set_fx(&VocalFx { on: false, ..VocalFx::default() });
        // a rising ramp, so any jump shows; one extra block of voice is left waiting
        let mut t = 0.0f32;
        let mut next = |n: usize| -> Vec<f32> {
            (0..n).flat_map(|_| {
                t += 1e-5;
                [t, 0.0]
            })
            .collect()
        };
        c.on_input(&next(64), 1.0);
        let mut out = vec![0.0f32; 128];
        let mut heard = vec![];
        for b in 0..40 {
            let at = 1.0 + b as f64 * 64.0 / SR as f64;
            c.on_input(&next(64), at);
            c.on_output(&mut out, at + 0.0079);
            heard.extend(out.chunks(2).map(|f| f[0]));
        }
        assert!(c.mon.len() <= 64, "the extra block is gone");
        // no jump anywhere: the ramp only ever moves a little from sample to sample
        let worst = heard.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(worst < 64.0 * 1e-5 / 16.0, "smooth, not a click: {worst}");
        // the driver's delays: 7.9 ms
        let ms = f32::from_bits(c.stats.latency.load(Ordering::Relaxed));
        assert!((ms - 7.9).abs() < 0.05, "{ms}");
    }

    #[test]
    fn old_voice_is_not_kept_while_monitoring_is_off() {
        let mut c = core();
        c.on_input(&vec![0.3; 256], 0.0);
        let mut out = vec![0.0f32; 256];
        c.on_output(&mut out, 0.0);
        c.monitor = true;
        c.set_fx(&VocalFx { on: false, ..VocalFx::default() });
        c.on_output(&mut out, 0.0);
        assert!(out.iter().all(|v| *v == 0.0), "nothing from before monitoring came on");
    }

    // ── keeping time over a long session ──

    const B: usize = 64;

    /// A recording made block by block, as an ASIO driver calls the engine: each period, a
    /// block of voice in, then a block of song out. The voice counts up (its value is the
    /// sample's place in time), so wherever it lands in the file shows whether it kept its time.
    /// `period` says, for each period, whether the input and the output happen, and whether
    /// the writer reads what has arrived (it does not while the disk is busy).
    fn session(periods: usize, ring: usize, mut period: impl FnMut(usize, &mut Core) -> (bool, bool, bool)) -> (Core, Vec<f32>) {
        let mut c = core();
        c.set_backing(vec![0.0; 2 * 4000]);
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(ring);
        c.start(120.0, 0, 4, vec![], Some(p));
        let mut out = vec![0.0f32; B * 2];
        let mut file = vec![];
        for k in 0..periods {
            let (inp, outp, read) = period(k, &mut c);
            if inp {
                let block: Vec<f32> = (0..B).flat_map(|i| [(k * B + i) as f32, -1.0]).collect();
                c.on_input(&block, k as f64 * B as f64 / SR as f64);
            }
            if outp {
                c.on_output(&mut out, k as f64 * B as f64 / SR as f64 + 0.005);
            }
            if read {
                while let Ok(v) = cons.pop() {
                    file.push(v);
                }
            }
        }
        c.stop();
        while let Ok(v) = cons.pop() {
            file.push(v);
        }
        (c, file)
    }
    /// Recording begins with the second block of voice (the first output block starts the
    /// count-in), so file index `j` is the voice captured at moment `B + j`.
    fn in_time(file: &[f32], from: usize) -> bool {
        file.iter().enumerate().skip(from).all(|(j, v)| *v == (B + j) as f32)
    }

    #[test]
    fn voice_the_driver_lost_is_filled_with_silence_so_every_later_pass_keeps_its_time() {
        // three blocks of voice never arrive (a dropout) while the song plays on
        let (c, file) = session(60, 1 << 16, |k, _| (!(10..13).contains(&k), true, true));
        assert_eq!(file.len(), 59 * B, "one sample for every frame of song since recording began");
        assert!(file[9 * B..12 * B].iter().all(|v| *v == 0.0), "silence where the voice was lost");
        assert!(in_time(&file[..9 * B], 0) && in_time(&file, 12 * B), "everything after it is where it was sung");
        assert_eq!((c.padded, c.dropped), (3 * B as u64, 3 * B as u64));
        assert_eq!(c.stats.padded.load(Ordering::Relaxed), 3 * B as u64, "and it is reported");
    }

    #[test]
    fn a_block_that_found_the_engine_busy_is_counted_and_filled() {
        // the input callback could not get in once (the output callback had the engine): it says so
        let (c, file) = session(40, 1 << 16, |k, c| {
            if k == 20 {
                c.missed(B as u64);
            }
            (k != 20, true, true)
        });
        assert_eq!(file.len(), 39 * B);
        assert!(file[19 * B..20 * B].iter().all(|v| *v == 0.0));
        assert!(in_time(&file, 20 * B));
        assert_eq!(c.padded, B as u64);
    }

    #[test]
    fn when_the_disk_falls_behind_the_lost_voice_becomes_silence_in_its_place() {
        // a recorder with room for eight blocks, and a disk that is busy through block 13: the
        // first eight wait, the next five are lost, and silence is written for them once there is room
        let (c, file) = session(40, 8 * B, |k, _| (true, true, !(1..13).contains(&k)));
        assert_eq!((c.dropped, c.padded), (5 * B as u64, 5 * B as u64), "the lost voice is all filled");
        assert_eq!(file.len(), 39 * B, "the file still has one sample per frame of song");
        assert!(in_time(&file[..8 * B], 0), "what waited went in, in order");
        assert!(file[8 * B..13 * B].iter().all(|v| *v == 0.0), "silence in place of what was lost");
        assert!(in_time(&file, 13 * B), "and after it, every sample is where it was sung");
    }

    #[test]
    fn when_the_song_stalls_the_extra_voice_is_left_out_so_the_passes_stay_in_time() {
        // three blocks of song are never asked for while the voice keeps coming
        let (c, file) = session(60, 1 << 16, |k, _| (true, !(10..13).contains(&k), true));
        assert_eq!(c.padded, 0);
        assert_eq!(c.dropped, 3 * B as u64);
        // the song is three blocks behind the clock from then on; so is the file
        assert!(file.iter().enumerate().skip(12 * B).all(|(j, v)| *v == (j + 4 * B) as f32));
        assert_eq!(file.len(), (60 - 3 - 1) * B);
    }

    #[test]
    fn the_ordinary_to_and_fro_of_two_callbacks_is_never_mistaken_for_a_loss() {
        // another kind of driver: input and output on their own threads, sometimes two in a row
        let mut c = core();
        c.set_backing(vec![0.0; 2 * 4000]);
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(1 << 16);
        c.start(120.0, 0, 4, vec![], Some(p));
        let mut out = vec![0.0f32; B * 2];
        let block = vec![0.5f32; B * 2];
        // each period has one block each way, in either order, as two threads would have it
        let mut seed = 7u32;
        for _ in 0..500 {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            if seed >> 16 & 1 == 0 {
                c.on_input(&block, 0.0);
                c.on_output(&mut out, 0.0);
            } else {
                c.on_output(&mut out, 0.0);
                c.on_input(&block, 0.0);
            }
        }
        c.stop();
        let mut n = 0;
        while cons.pop().is_ok() {
            n += 1;
        }
        assert_eq!((c.padded, c.dropped), (0, 0), "nothing filled or left out");
        assert!(n >= 498 * B);
    }

    #[test]
    fn the_moments_a_take_is_lined_up_by_are_kept_as_they_happen() {
        // if the device is gone, the stop never reaches the audio thread: the moments must already be known
        let mut c = core();
        c.set_backing(vec![0.0; 2000]);
        let (p, _cons) = rtrb::RingBuffer::<f32>::new(10000);
        c.start(120.0, 4, 4, vec![], Some(p));
        assert!(moment(&c.stats.play0).is_none() && moment(&c.stats.cap0).is_none());
        let mut out = vec![0.0f32; 512];
        c.on_output(&mut out, 2.5);
        c.on_input(&[0.1; 512], 2.49);
        assert_eq!(moment(&c.stats.play0), Some(2.5));
        assert_eq!(moment(&c.stats.cap0), Some(2.49));
    }

    #[test]
    fn a_recording_closed_with_nobody_to_take_it_comes_back_on_a_close_never_on_a_stop() {
        // (the only test that touches the engine's recording slots)
        let r = Recorded { dry: "old.wav".into(), wet: String::new(), rate: 48000, channels: 1, frames: 9, offset: 0, count_in: 0, loop_frames: 4, dropped: 0, padded: 0, note: None };
        stash(r);
        // a rehearsal's stop finds nothing: it must not be handed an old recording to render
        assert!(engine_stop_inner().unwrap().is_none());
        assert_eq!(close_inner().map(|r| r.dry), Some("old.wav".to_string()));
        assert!(close_inner().is_none(), "handed back once");
    }

    #[test]
    fn memory_from_messages_is_handed_back_not_freed_on_the_audio_thread() {
        let mut c = core();
        assert!(matches!(c.apply(Cmd::Backing(vec![0.1; 400])), Some(Trash::Backing(old)) if old.is_empty()));
        assert!(matches!(c.apply(Cmd::Backing(vec![0.2; 200])), Some(Trash::Backing(old)) if old.len() == 400));
        assert!(matches!(c.apply(Cmd::Set(Box::new(Settings { monitor: true, input: 0, input_b: None, fx: VocalFx::default(), backing_gain: 1.0, click_gain: 0.5, click_on: false }))), Some(Trash::Settings(_))));
    }

    // ── a pair of inputs ──

    /// An interface with four inputs whose pair is inputs 3 and 4: the left side counts up (its
    /// value is the frame's place in time), the right is the same below zero, and inputs 1 and
    /// 2 carry something else that must never be recorded or heard.
    fn pair_core(monitor: bool) -> Core {
        let mut c = Core::new(SR, 4, 2, Arc::new(Shared::new(4)));
        c.set_backing(vec![0.0; 2 * 4000]);
        c.apply(Cmd::Set(Box::new(Settings { monitor, input: 2, input_b: Some(3), fx: VocalFx::default(), backing_gain: 1.0, click_gain: 0.5, click_on: false })));
        c
    }
    fn pair_block(k: usize) -> Vec<f32> {
        (0..B).map(|i| (k * B + i) as f32).flat_map(|t| [9.0, -9.0, t, -t]).collect()
    }
    /// `session`, for a pair: the same periods, the recorder taking two samples a frame.
    fn pair_session(periods: usize, ring: usize, mut period: impl FnMut(usize, &mut Core) -> (bool, bool, bool)) -> (Core, Vec<f32>) {
        let mut c = pair_core(false);
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(ring);
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 0, per_bar: 4, downbeats: vec![], rec: Some(p), once: false, stereo: true });
        let mut out = vec![0.0f32; B * 2];
        let mut file = vec![];
        for k in 0..periods {
            let (inp, outp, read) = period(k, &mut c);
            if inp {
                c.on_input(&pair_block(k), k as f64 * B as f64 / SR as f64);
            }
            if outp {
                c.on_output(&mut out, k as f64 * B as f64 / SR as f64 + 0.005);
            }
            if read {
                while let Ok(v) = cons.pop() {
                    file.push(v);
                }
            }
        }
        c.stop();
        while let Ok(v) = cons.pop() {
            file.push(v);
        }
        (c, file)
    }
    /// Every frame of a pair's file from `from` on is the frame sung at that moment (left: its
    /// place in time, right: the same below zero), as `in_time` for one input.
    fn pair_in_time(file: &[f32], from: usize) -> bool {
        file.chunks(2).enumerate().skip(from).all(|(j, f)| f[0] == (B + j) as f32 && f[1] == -((B + j) as f32))
    }
    /// Left and right are never apart: every frame is a frame as sung, or silence on both sides.
    fn sides_together(file: &[f32]) -> bool {
        file.len().is_multiple_of(2) && file.chunks(2).all(|f| f[1] == -f[0])
    }

    #[test]
    fn a_pair_of_inputs_is_recorded_left_and_right_into_a_stereo_file() {
        let mut c = pair_core(false);
        let dry = recfile::scratch("pair.wav");
        let (p, rec) = recorder(dry.clone(), SR as u32, 2, false, &c.stats).unwrap();
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 0, per_bar: 4, downbeats: vec![], rec: Some(p), once: false, stereo: true });
        let mut out = vec![0.0f32; B * 2];
        for k in 0..50 {
            c.on_input(&pair_block(k), k as f64 * B as f64 / SR as f64);
            c.on_output(&mut out, k as f64 * B as f64 / SR as f64 + 0.005);
        }
        c.apply(Cmd::Stop);
        let r = finish(rec);
        // recording begins with the second block (the first output block starts the song): 49 blocks of frames
        assert_eq!((r.channels, r.frames, r.rate), (2, 49 * B as u64, 48000), "a stereo file, counted in frames");
        assert_eq!((r.count_in, r.loop_frames, r.dropped, r.padded), (0, 4000, 0, 0));
        assert_eq!(r.offset, 240 - B as i64, "heard 5 ms after the song's first frame, captured one block in");
        assert_eq!(c.stats.writing.written.load(Ordering::Relaxed), 49 * B as u64, "the status counts frames too");
        let mut rd = hound::WavReader::open(&dry).unwrap();
        assert_eq!((rd.spec().channels, rd.spec().sample_rate, rd.duration()), (2, 48000, 49 * B as u32));
        let file: Vec<f32> = rd.samples::<f32>().map(|v| v.unwrap()).collect();
        assert!(pair_in_time(&file, 0), "input 3 on the left, input 4 on the right, every frame where it was played");
        // a take of it comes back with both sides
        let mut part = hound::WavReader::new(std::io::Cursor::new(recfile::read_range(&dry, 100, 50).unwrap())).unwrap();
        assert_eq!((part.spec().channels, part.duration()), (2, 50));
        let got: Vec<f32> = part.samples::<f32>().map(|v| v.unwrap()).collect();
        assert_eq!((got[0], got[1], got[98], got[99]), ((B + 100) as f32, -((B + 100) as f32), (B + 149) as f32, -((B + 149) as f32)));
        // its second file is the pair again (no chain), at the Output level: here 0 dB, so the same
        let wet = recfile::render_wet(&dry, &VocalFx::default()).unwrap();
        let mut wr = hound::WavReader::open(&wet).unwrap();
        assert_eq!((wr.spec().channels, wr.duration()), (2, 49 * B as u32));
        assert!(wr.samples::<f32>().map(|v| v.unwrap()).zip(&file).all(|(a, b)| a.to_bits() == b.to_bits()), "sample for sample");
        let _ = std::fs::remove_file(wet);
        let _ = std::fs::remove_file(dry);
    }

    #[test]
    fn one_input_goes_through_the_same_recorder_into_a_mono_file() {
        // the commands as they were always sent: no second input, no once-through
        let mut c = core();
        c.set_backing(vec![0.0; 2 * 4000]);
        c.apply(Cmd::Set(Box::new(Settings { monitor: false, input: 1, input_b: None, fx: VocalFx::default(), backing_gain: 1.0, click_gain: 0.5, click_on: false })));
        let dry = recfile::scratch("voice.wav");
        let (p, rec) = recorder(dry.clone(), SR as u32, 1, false, &c.stats).unwrap();
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 0, per_bar: 4, downbeats: vec![], rec: Some(p), once: false, stereo: false });
        let mut out = vec![0.0f32; B * 2];
        for k in 0..50 {
            let block: Vec<f32> = (0..B).flat_map(|i| [-1.0, (k * B + i) as f32]).collect();
            c.on_input(&block, k as f64 * B as f64 / SR as f64);
            c.on_output(&mut out, k as f64 * B as f64 / SR as f64 + 0.005);
        }
        c.apply(Cmd::Stop);
        let r = finish(rec);
        assert_eq!((r.channels, r.frames, r.loop_frames, r.offset), (1, 49 * B as u64, 4000, 240 - B as i64));
        let mut rd = hound::WavReader::open(&dry).unwrap();
        assert_eq!((rd.spec().channels, rd.duration()), (1, 49 * B as u32));
        let file: Vec<f32> = rd.samples::<f32>().map(|v| v.unwrap()).collect();
        assert!(in_time(&file, 0), "input 2, one sample a frame");
        let mut part = hound::WavReader::new(std::io::Cursor::new(recfile::read_range(&dry, 100, 50).unwrap())).unwrap();
        assert_eq!((part.spec().channels, part.duration()), (1, 50));
        assert_eq!(part.samples::<f32>().next().unwrap().unwrap(), (B + 100) as f32);
        let _ = std::fs::remove_file(dry);
    }

    #[test]
    fn the_commands_with_their_old_arguments_take_the_old_path() {
        // one engine is driven as the tests always drove it; the other gets the messages the
        // app sends, with no second input and no once-through: the same sound and the same file
        let fx = VocalFx::default();
        let backing: Vec<f32> = (0..5000).flat_map(|i| { let v = 0.2 * (i as f32 * 0.01).sin(); [v, 0.5 * v] }).collect();
        let mut a = core();
        a.monitor = true;
        a.input = 1;
        a.backing_gain = 0.8;
        a.click_gain = 0.3;
        a.click_on = true;
        a.set_backing(backing.clone());
        let (pa, mut ca) = rtrb::RingBuffer::<f32>::new(1 << 16);
        a.start(100.0, 2, 3, downbeats(&[3, 4]), Some(pa));
        let mut b = core();
        b.apply(Cmd::Set(Box::new(Settings { monitor: true, input: 1, input_b: None, fx, backing_gain: 0.8, click_gain: 0.3, click_on: true })));
        b.apply(Cmd::Backing(backing));
        let (pb, mut cb) = rtrb::RingBuffer::<f32>::new(1 << 16);
        b.apply(Cmd::Start { bpm: 100.0, count_in_beats: 2, per_bar: 3, downbeats: downbeats(&[3, 4]), rec: Some(pb), once: false, stereo: false });
        let (mut oa, mut ob) = (vec![0.0f32; B * 2], vec![0.0f32; B * 2]);
        let mut turned_down = 0.0f32;
        for k in 0..1500usize {
            let block: Vec<f32> = (0..B).map(|i| 0.5 * ((k * B + i) as f32 * 0.02).sin()).flat_map(|v| [-v, v]).collect();
            a.on_input(&block, 0.0);
            b.on_input(&block, 0.0);
            if k % 100 == 50 {
                // a knob and a slider are moved while a block of voice is waiting for the
                // headphones: it is still heard, and nothing clicks
                let moved = VocalFx { level: -3.0 + (k / 100) as f32 * 0.5, ..VocalFx::default() };
                a.set_fx(&moved);
                a.backing_gain = 0.6;
                b.apply(Cmd::Set(Box::new(Settings { monitor: true, input: 1, input_b: None, fx: moved, backing_gain: 0.6, click_gain: 0.3, click_on: true })));
                assert_eq!((a.mon.len(), b.mon.len(), b.mon_b.len()), (B, B, 0));
            }
            a.on_output(&mut oa, 0.0);
            b.on_output(&mut ob, 0.0);
            assert!(oa.iter().zip(&ob).all(|(x, y)| x.to_bits() == y.to_bits()), "block {k}: the headphones");
            // the chain's two meters are reported for a voice, as ever
            let meters = |c: &Core| (c.stats.reduction.load(Ordering::Relaxed), c.stats.limit.load(Ordering::Relaxed));
            assert_eq!(meters(&a), meters(&b));
            turned_down = turned_down.max(f32::from_bits(meters(&b).0));
            loop {
                match (ca.pop(), cb.pop()) {
                    (Ok(x), Ok(y)) => assert_eq!(x.to_bits(), y.to_bits(), "block {k}: the file"),
                    (Err(_), Err(_)) => break,
                    _ => panic!("block {k}: one file is longer"),
                }
            }
        }
        assert!(turned_down > 1.0, "the compressors worked, and their meter showed it: {turned_down} dB");
        assert_eq!(a.stats.length.load(Ordering::Relaxed), 5000);
        assert_eq!(b.stats.length.load(Ordering::Relaxed), 5000);
    }

    #[test]
    fn lost_voice_of_a_pair_is_silence_on_both_sides_and_the_sides_never_change_places() {
        // the same three mishaps as for one input, each with the same count (in frames)
        let (c, file) = pair_session(60, 1 << 16, |k, _| (!(10..13).contains(&k), true, true));
        assert_eq!(file.len(), 2 * 59 * B, "two samples for every frame of song since recording began");
        assert!(file[2 * 9 * B..2 * 12 * B].iter().all(|v| *v == 0.0), "silence where the pair was lost");
        assert!(pair_in_time(&file[..2 * 9 * B], 0) && pair_in_time(&file, 12 * B));
        assert_eq!((c.padded, c.dropped), (3 * B as u64, 3 * B as u64));

        // the disk falls behind, with a recorder that holds an odd number of samples: a frame
        // goes in whole or not at all
        let (c, file) = pair_session(40, 2 * 8 * B + 1, |k, _| (true, true, !(1..13).contains(&k)));
        assert_eq!((c.dropped, c.padded), (5 * B as u64, 5 * B as u64));
        assert_eq!(file.len(), 2 * 39 * B);
        assert!(sides_together(&file));
        assert!(pair_in_time(&file[..2 * 8 * B], 0), "what waited went in, in order");
        assert!(file[2 * 8 * B..2 * 13 * B].iter().all(|v| *v == 0.0), "silence in place of what was lost");
        assert!(pair_in_time(&file, 13 * B), "and after it, every frame is where it was played");

        // the song stalls: the extra frames are left out, whole
        let (c, file) = pair_session(60, 1 << 16, |k, _| (true, !(10..13).contains(&k), true));
        assert_eq!((c.padded, c.dropped), (0, 3 * B as u64));
        assert_eq!(file.len(), 2 * (60 - 3 - 1) * B);
        assert!(sides_together(&file));
        assert!(file.chunks(2).enumerate().skip(12 * B).all(|(j, f)| f[0] == (j + 4 * B) as f32));

        // a block that found the engine busy
        let (c, file) = pair_session(40, 1 << 16, |k, c| {
            if k == 20 {
                c.missed(B as u64);
            }
            (k != 20, true, true)
        });
        assert_eq!((file.len(), c.padded), (2 * 39 * B, B as u64));
        assert!(file[2 * 19 * B..2 * 20 * B].iter().all(|v| *v == 0.0) && pair_in_time(&file, 20 * B));
    }

    #[test]
    fn a_pair_given_up_for_one_input_in_mid_recording_leaves_a_whole_stereo_file() {
        // the file was begun as a pair's: one input from then on is written on both sides
        let mut c = pair_core(false);
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(1 << 16);
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 0, per_bar: 4, downbeats: vec![], rec: Some(p), once: false, stereo: true });
        let mut out = vec![0.0f32; B * 2];
        for k in 0..20 {
            if k == 10 {
                c.apply(Cmd::Set(Box::new(Settings { monitor: false, input: 3, input_b: None, fx: VocalFx::default(), backing_gain: 1.0, click_gain: 0.5, click_on: false })));
            }
            c.on_input(&pair_block(k), 0.0);
            c.on_output(&mut out, 0.0);
        }
        c.stop();
        let mut file = vec![];
        while let Ok(v) = cons.pop() {
            file.push(v);
        }
        assert_eq!(file.len(), 2 * 19 * B);
        assert!(pair_in_time(&file[..2 * 9 * B], 0), "the pair, until then");
        assert!(file.chunks(2).enumerate().skip(9 * B).all(|(j, f)| f[0] == -((B + j) as f32) && f[1] == f[0]), "then input 4 on both sides");
    }

    #[test]
    fn a_pair_is_heard_dry_in_stereo_left_and_right() {
        // the default vocal sound is on, and would change a voice: a pair does not go through it
        let mut c = pair_core(true);
        let mut out = vec![0.0f32; B * 2];
        for k in 0..30 {
            let block: Vec<f32> = (0..B).map(|i| (k * B + i) as f32 / 65536.0).flat_map(|t| [0.9, -0.9, t, 0.25 - t]).collect();
            c.on_input(&block, 0.0);
            c.on_output(&mut out, 0.0);
            assert!(out.chunks(2).zip(block.chunks(4)).all(|(o, i)| o[0] == i[2] && o[1] == i[3]), "block {k}: input 3 on the left, input 4 on the right, untouched");
        }
        assert_eq!((f32::from_bits(c.stats.reduction.load(Ordering::Relaxed)), f32::from_bits(c.stats.limit.load(Ordering::Relaxed))), (0.0, 0.0), "the chain's meters rest");
        // the Output level is all of the vocal sound a pair has: 6 dB down is about half, on both sides
        c.apply(Cmd::Set(Box::new(Settings { monitor: true, input: 2, input_b: Some(3), fx: VocalFx { level: -6.0, on: false, ..VocalFx::default() }, backing_gain: 1.0, click_gain: 0.5, click_on: false })));
        let g = recfile::pair_gain(&VocalFx { level: -6.0, ..VocalFx::default() });
        assert!((g - 0.5012).abs() < 1e-4);
        let block: Vec<f32> = (0..B).flat_map(|_| [0.9, -0.9, 0.5, -0.25]).collect();
        c.on_input(&block, 0.0);
        c.on_output(&mut out, 0.0);
        assert!(out.chunks(2).all(|o| o[0] == 0.5 * g && o[1] == -0.25 * g));
        // monitoring off: silence, and nothing old is kept for when it comes back
        c.apply(Cmd::Set(Box::new(Settings { monitor: false, input: 2, input_b: Some(3), fx: VocalFx::default(), backing_gain: 1.0, click_gain: 0.5, click_on: false })));
        c.on_input(&block, 0.0);
        c.on_output(&mut out, 0.0);
        assert!(out.iter().all(|v| *v == 0.0));
        assert!(c.mon.is_empty() && c.mon_b.is_empty());
    }

    #[test]
    fn a_pair_in_the_headphones_keeps_its_sides_in_step_whatever_the_blocks_do() {
        // the left counts up and the right is the same below zero: any frame whose sides did
        // not come in together would show
        let mut c = pair_core(true);
        let mut t = 0.0f32;
        let mut next = |n: usize| -> Vec<f32> {
            (0..n).flat_map(|_| {
                t += 1e-5;
                [0.7, 0.7, t, -t]
            })
            .collect()
        };
        let together = |out: &[f32]| out.chunks(2).all(|f| f[1] == -f[0]);
        let mut out = vec![0.0f32; B * 2];
        // the output asks before the input has arrived: silence, then the pair with no gap
        c.on_output(&mut out, 0.0);
        assert!(out.iter().all(|v| *v == 0.0));
        // one extra block is left waiting: it is taken out smoothly, on both sides alike
        c.on_input(&next(B), 0.0);
        let mut heard = vec![];
        for _ in 0..40 {
            c.on_input(&next(B), 0.0);
            c.on_output(&mut out, 0.0);
            assert!(together(&out));
            heard.extend(out.chunks(2).map(|f| f[0]));
        }
        assert!(c.mon.len() <= B && c.mon_b.len() == c.mon.len(), "the extra block is gone from both");
        let worst = heard.windows(2).skip(B).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(worst < B as f32 * 1e-5 / 16.0, "smooth, not a click: {worst}");
        // the input runs far ahead: the output catches up at once, both sides by the same amount
        for _ in 0..10 {
            c.on_input(&next(B), 0.0);
        }
        c.on_output(&mut out, 0.0);
        assert!(together(&out) && c.mon_b.len() == c.mon.len() && c.mon.len() <= B * 3 + 64);
        // far more than the queue holds: the oldest goes, from both
        for _ in 0..300 {
            c.on_input(&next(B), 0.0);
        }
        assert_eq!((c.mon.len(), c.mon_b.len()), (16384, 16384));
        c.on_output(&mut out, 0.0);
        assert!(together(&out) && out[0] != 0.0);
    }

    #[test]
    fn going_between_one_input_and_a_pair_keeps_nothing_of_the_other_kind() {
        let voice = VocalFx { on: false, ..VocalFx::default() };
        let set = |c: &mut Core, input_b: Option<usize>| c.apply(Cmd::Set(Box::new(Settings { monitor: true, input: 2, input_b, fx: voice.clone(), backing_gain: 1.0, click_gain: 0.5, click_on: false })));
        let mut c = Core::new(SR, 4, 2, Arc::new(Shared::new(4)));
        set(&mut c, None);
        let block: Vec<f32> = (0..B).flat_map(|_| [0.9, -0.9, 0.5, -0.25]).collect();
        let mut out = vec![0.0f32; B * 2];
        // one input: the voice on both sides (the chain is off: straight through)
        c.on_input(&block, 0.0);
        c.on_input(&block, 0.0);
        c.on_output(&mut out, 0.0);
        assert!(out.chunks(2).all(|f| f[0] == 0.5 && f[1] == 0.5));
        // a pair from here: the block of voice still waiting is let go, and the pair starts clean
        set(&mut c, Some(3));
        assert!(c.mon.is_empty() && c.mon_b.is_empty());
        c.on_input(&block, 0.0);
        c.on_output(&mut out, 0.0);
        assert!(out.chunks(2).all(|f| f[0] == 0.5 && f[1] == -0.25));
        // and back: one input again, on both sides, with nothing left of the right side
        c.on_input(&block, 0.0);
        set(&mut c, None);
        assert!(c.mon.is_empty() && c.mon_b.is_empty());
        c.on_input(&block, 0.0);
        c.on_output(&mut out, 0.0);
        assert!(out.chunks(2).all(|f| f[0] == 0.5 && f[1] == 0.5));
        // a pair on an interface with one input: that input on both sides, never out of range
        let mut one = Core::new(SR, 1, 2, Arc::new(Shared::new(1)));
        one.apply(Cmd::Set(Box::new(Settings { monitor: true, input: 0, input_b: Some(1), fx: voice.clone(), backing_gain: 1.0, click_gain: 0.5, click_on: false })));
        one.on_input(&vec![0.25; B], 0.0);
        one.on_output(&mut out, 0.0);
        assert!(out.iter().all(|v| *v == 0.25));
    }

    // ── once through ──

    #[test]
    fn a_song_played_once_goes_silent_after_its_last_frame_and_the_recording_goes_on_until_stop() {
        let mut c = core();
        // a "song" of 6000 frames at a steady level
        c.set_backing((0..6000).flat_map(|_| [0.25f32, -0.125]).collect());
        let dry = recfile::scratch("once.wav");
        let (p, rec) = recorder(dry.clone(), SR as u32, 1, true, &c.stats).unwrap();
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 1, per_bar: 4, downbeats: vec![], rec: Some(p), once: true, stereo: false });
        let mut out = vec![0.0f32; B * 2];
        let mut heard = vec![];
        for k in 0..600 {
            let block: Vec<f32> = (0..B).flat_map(|i| [(k * B + i) as f32, -1.0]).collect();
            c.on_input(&block, k as f64 * B as f64 / SR as f64);
            c.on_output(&mut out, k as f64 * B as f64 / SR as f64 + 0.005);
            heard.extend_from_slice(&out);
        }
        // the count-in (one beat: 24000 frames), the song once, then nothing at all
        let (l, r) = (|i: usize| heard[2 * i], |i: usize| heard[2 * i + 1]);
        assert!(l(100).abs() > 0.01 && l(20000) == 0.0, "the count-in's click, then quiet");
        assert!((24000..30000).all(|i| l(i) == 0.25 && r(i) == -0.125), "the song, every frame of it");
        assert!((30000..600 * B).all(|i| l(i) == 0.0 && r(i) == 0.0), "silence after its last frame, not the song again");
        // it has no loop: the status says so while it runs, and the place in the song counts on
        assert!(c.stats.running.load(Ordering::Relaxed));
        assert_eq!((c.stats.pos.load(Ordering::Relaxed), c.stats.count_in.load(Ordering::Relaxed), c.stats.length.load(Ordering::Relaxed)), (600 * B as u64, 24000, 0));
        c.apply(Cmd::Stop);
        let rd = finish(rec);
        assert_eq!((rd.channels, rd.frames, rd.count_in, rd.loop_frames), (1, 599 * B as u64, 24000, 0), "everything until Stop, and no loop to cut it by");
        assert_eq!((rd.dropped, rd.padded, rd.offset), (0, 0, 240 - B as i64));
        let file: Vec<f32> = hound::WavReader::open(&dry).unwrap().samples::<f32>().map(|v| v.unwrap()).collect();
        assert_eq!(file.len(), 599 * B);
        assert!(in_time(&file, 0), "one sample for every frame, in place, long past the song's end");
        let _ = std::fs::remove_file(dry);

        // the next plain start goes round and round again, and says how long its loop is
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 0, per_bar: 4, downbeats: vec![], rec: None, once: false, stereo: false });
        heard.clear();
        for _ in 0..300 {
            c.on_output(&mut out, 0.0);
            heard.extend_from_slice(&out);
        }
        assert!(heard.chunks(2).all(|f| f[0] == 0.25 && f[1] == -0.125), "three passes and more, without a gap");
        assert_eq!(c.stats.length.load(Ordering::Relaxed), 6000);
    }

    #[test]
    fn a_pair_is_recorded_once_through_too() {
        let mut c = pair_core(false);
        let dry = recfile::scratch("pair-once.wav");
        let (p, rec) = recorder(dry.clone(), SR as u32, 2, true, &c.stats).unwrap();
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 0, per_bar: 4, downbeats: vec![], rec: Some(p), once: true, stereo: true });
        let mut out = vec![0.0f32; B * 2];
        for k in 0..200 {
            c.on_input(&pair_block(k), 0.0);
            c.on_output(&mut out, 0.0);
        }
        c.apply(Cmd::Stop);
        let r = finish(rec);
        // the song is 4000 frames; the recording is three times that
        assert_eq!((r.channels, r.frames, r.loop_frames), (2, 199 * B as u64, 0));
        let file: Vec<f32> = hound::WavReader::open(&dry).unwrap().samples::<f32>().map(|v| v.unwrap()).collect();
        assert!(file.len() == 2 * 199 * B && pair_in_time(&file, 0));
        let _ = std::fs::remove_file(dry);
    }

    #[test]
    fn the_click_of_a_song_played_once_counts_straight_on_past_its_end() {
        // a 4/4 bar then a 3/4 bar at 120 bpm, played once with the click on: after its seven
        // beats the click goes on in bars of three (the last bar's meter), not round to the top
        let heard = |once: bool| -> Vec<f32> {
            let mut c = core();
            c.set_backing(vec![0.0; 7 * 24000 * 2]);
            c.click_on = true;
            c.click_gain = 1.0;
            c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 4, per_bar: 4, downbeats: downbeats(&[4, 3]), rec: None, once, stereo: false });
            let mut out = vec![0.0f32; 1024];
            let mut heard = vec![];
            while heard.len() < 96000 + 17 * 24000 {
                c.on_output(&mut out, 0.0);
                heard.extend(out.chunks(2).map(|f| f[0]));
            }
            heard
        };
        let accents = |heard: &[f32]| -> Vec<usize> {
            let peak = |at: usize| heard[at..at + 1500].iter().fold(0.0f32, |m, v| m.max(v.abs()));
            assert!((0..16).all(|k| peak(96000 + k * 24000) > 0.5), "every beat clicks");
            (0..16).filter(|k| peak(96000 + k * 24000) > 0.85).collect()
        };
        assert_eq!(accents(&heard(true)), vec![0, 4, 7, 10, 13], "once: 4, 3, then threes");
        assert_eq!(accents(&heard(false)), vec![0, 4, 7, 11, 14], "round and round: 4, 3, 4, 3 (as ever)");
        // with no bars given it counts on in the count-in's meter, as a loop without bars does
        let mut c = core();
        c.set_backing(vec![0.0; 7 * 24000 * 2]);
        c.click_on = true;
        c.click_gain = 1.0;
        c.apply(Cmd::Start { bpm: 120.0, count_in_beats: 0, per_bar: 4, downbeats: vec![], rec: None, once: true, stereo: false });
        let mut out = vec![0.0f32; 1024];
        let mut plain = vec![];
        while plain.len() < 13 * 24000 {
            c.on_output(&mut out, 0.0);
            plain.extend(out.chunks(2).map(|f| f[0]));
        }
        let peak = |at: usize| plain[at..at + 1500].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert_eq!((0..12).filter(|k| peak(k * 24000) > 0.85).collect::<Vec<_>>(), vec![0, 4, 8]);
    }

    // ── one input, as it was before a pair of inputs and a once-through start were added ──
    //
    // The numbers in the three tests below were read off the engine as it was before those two
    // were added, and the tests have not been changed since: a vocal recorded from one input
    // must go on giving the very same file and the very same sound in the headphones.

    /// A running sum of bytes (FNV-1a, 64 bits): two recordings with the same sum are the same.
    fn sum(bytes: impl IntoIterator<Item = u8>) -> u64 {
        bytes.into_iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3))
    }
    /// The same of samples, bit for bit (a zero counts as one zero, whatever its sign).
    fn sum_of(samples: &[f32]) -> u64 {
        sum(samples.iter().flat_map(|v| (*v + 0.0).to_bits().to_le_bytes()))
    }

    /// A vocal session as it is recorded today, block by block as an ASIO driver calls the
    /// engine: Input 2 of a two-input interface, a count-in of two beats, a song of 6000 frames
    /// going round, the voice in the headphones with the chain off. On the way three blocks of
    /// voice never arrive, one finds the engine busy, the disk falls behind for twenty blocks,
    /// the song stalls for three, the Song slider is moved and the input is changed. Every
    /// sample is a number a float holds exactly, so the result is the same on any computer.
    /// Returns the engine, what went into the file, what went to the headphones, and the two
    /// moments the take is lined up by.
    fn vocal_session() -> (Core, Vec<f32>, Vec<f32>, (Option<f64>, Option<f64>)) {
        let mut c = core();
        c.input = 1;
        c.monitor = true;
        c.set_fx(&VocalFx { on: false, ..VocalFx::default() });
        c.backing_gain = 0.75;
        c.click_gain = 0.0;
        c.click_on = true;
        c.set_backing((0..6000u32).flat_map(|i| [((i * 7) % 201) as f32 / 512.0 - 0.125, ((i * 13) % 157) as f32 / 1024.0]).collect());
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(8 * B);
        c.start(96.0, 2, 4, downbeats(&[4, 3]), Some(p));
        let mut out = vec![0.0f32; B * 2];
        let (mut file, mut heard) = (vec![], vec![]);
        for k in 0..1600usize {
            let at = k as f64 * B as f64 / SR as f64;
            if k == 500 {
                c.missed(B as u64);
            }
            if k == 1200 {
                c.backing_gain = 0.5;
            }
            if k == 1400 {
                c.input = 0;
            }
            if !(300..303).contains(&k) && k != 500 {
                let block: Vec<f32> = (0..B).map(|i| (k * B + i) as u32).flat_map(|n| [((n * 17) % 613) as f32 / 4096.0 - 0.07, ((n * 31) % 1021) as f32 / 4096.0 - 0.12]).collect();
                c.on_input(&block, at - 0.004);
            }
            if !(1100..1103).contains(&k) {
                c.on_output(&mut out, at + 0.006);
                heard.extend_from_slice(&out);
            }
            if !(700..720).contains(&k) {
                while let Ok(v) = cons.pop() {
                    file.push(v);
                }
            }
        }
        let moments = c.stop();
        while let Ok(v) = cons.pop() {
            file.push(v);
        }
        (c, file, heard, moments)
    }

    #[test]
    fn one_input_is_recorded_into_the_very_same_file_as_before() {
        let (c, file, _, (heard, captured)) = vocal_session();
        assert_eq!(file.len(), GOLD_FILE.0, "samples in the file");
        assert_eq!(sum_of(&file), GOLD_FILE.1, "and every one of them");
        assert_eq!((c.padded, c.dropped), GOLD_FILE.2, "silence written for lost voice, and voice lost");
        assert_eq!((c.stats.padded.load(Ordering::Relaxed), c.stats.dropped.load(Ordering::Relaxed)), GOLD_FILE.2, "as reported");
        assert_eq!((c.stats.pos.load(Ordering::Relaxed), c.stats.count_in.load(Ordering::Relaxed), c.stats.length.load(Ordering::Relaxed)), GOLD_FILE.3, "where the song is, the count-in, the loop");
        // the take is lined up by the driver's two moments, as `Recorded.offset`
        assert_eq!(((heard.unwrap() - captured.unwrap()) * SR as f64).round() as i64, GOLD_FILE.4, "the round trip, in frames");
        assert_eq!(c.stats.latency.load(Ordering::Relaxed), GOLD_FILE.5, "the delay heard, as measured");
        // and the file itself, byte for byte, as the writer makes it
        let (mut p, cons) = rtrb::RingBuffer::<f32>::new(file.len());
        for v in &file {
            p.push(*v).unwrap();
        }
        drop(p);
        let mut bytes = std::io::Cursor::new(vec![]);
        let spec = hound::WavSpec { channels: 1, sample_rate: SR as u32, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
        let st = Writing::default();
        let (n, note) = recfile::write_voice(cons, hound::WavWriter::new(&mut bytes, spec).unwrap(), &AtomicBool::new(true), &st, SR as u32, MAX_FRAMES, || None);
        assert_eq!((n, note), (file.len() as u64, None));
        assert_eq!(st.written.load(Ordering::Relaxed), file.len() as u64);
        let bytes = bytes.into_inner();
        assert_eq!((bytes.len(), sum(bytes)), GOLD_FILE.6, "the WAV, header and all");
    }
    /// samples; their sum; (padded, dropped); (pos, count-in, loop); offset; latency bits; the WAV's (bytes, sum)
    const GOLD_FILE: (usize, u64, (u64, u64), (u64, u64, u64), i64, u32, (usize, u64)) = (102_144, 0x3b28_588e_4a66_a7ed, (1152, 1344), (102_208, 60_000, 6000), 416, 0x4120_0000, (408_644, 0xc9c9_07eb_3fbb_0869));

    #[test]
    fn one_input_is_heard_in_the_headphones_exactly_as_before() {
        let (_, _, heard, _) = vocal_session();
        assert_eq!((heard.len(), sum_of(&heard)), GOLD_HEARD, "the song and the voice, left and right, sample for sample");
        // through the vocal chain: what the chain and the safety stage (neither was touched) make
        // of the same voice, in the same order, is exactly what comes out
        let fx = VocalFx::default();
        let mut c = core();
        c.monitor = true;
        c.click_gain = 0.0;
        c.set_fx(&fx);
        c.set_backing((0..5000u32).flat_map(|i| [((i * 7) % 201) as f32 / 1024.0, 0.0]).collect());
        c.start(120.0, 0, 4, vec![], None);
        let (mut chain, mut safe) = (Chain::new(SR, &fx), OutSafety::new(SR));
        let mut out = vec![0.0f32; B * 2];
        for k in 0..400usize {
            let block: Vec<f32> = (0..B).map(|i| 0.25 * ((k * B + i) as f32 * 0.03).sin()).flat_map(|v| [v, -v]).collect();
            c.on_input(&block, 0.0);
            c.on_output(&mut out, 0.0);
            for (i, f) in out.chunks(2).enumerate() {
                let j = ((k * B + i) % 5000) * 2;
                let (mut l, mut r) = (0.0f32, 0.0f32);
                l += c.backing[j] * c.backing_gain;
                r += c.backing[j + 1] * c.backing_gain;
                l += 0.0;
                r += 0.0;
                let (a, b) = chain.run(block[i * 2]);
                l += a;
                r += b;
                let (l, r) = safe.run(l, r);
                assert!(f[0].to_bits() == l.to_bits() && f[1].to_bits() == r.to_bits(), "block {k}, frame {i}");
            }
        }
    }
    /// samples sent to the headphones (left and right); their sum
    const GOLD_HEARD: (usize, u64) = (204_416, 0xebe6_9d6f_736e_0fd0);

    #[test]
    fn the_click_falls_on_the_same_frames_at_the_same_level_as_before() {
        // the three ways the click is counted: a loop with its bars, a loop without, and no song at all
        let click = |song: usize, bars: &[u32]| -> Vec<f32> {
            let mut c = core();
            c.set_backing(vec![0.0; song * 2]);
            c.click_on = true;
            c.click_gain = 0.5;
            c.start(120.0, 4, 4, downbeats(bars), None);
            let mut out = vec![0.0f32; 1024];
            let mut heard = vec![];
            while heard.len() < 96000 + 2 * 7 * 24000 + 5000 {
                c.on_output(&mut out, 0.0);
                assert!(out.chunks(2).all(|f| f[0] == f[1]), "the same on both sides");
                heard.extend(out.chunks(2).map(|f| f[0]));
            }
            heard
        };
        for (k, heard) in [click(7 * 24000, &[4, 3]), click(7 * 24000, &[]), click(0, &[4, 3])].iter().enumerate() {
            // which frames sound, and which way each swings: the same on any computer
            let frames = sum(heard.iter().enumerate().filter(|(_, v)| **v != 0.0).flat_map(|(i, v)| (if *v > 0.0 { i as u32 } else { !(i as u32) }).to_le_bytes()));
            assert_eq!(frames, GOLD_CLICK[k].0, "way {k}: the frames that sound");
            // how loud: a sine and a fall-off are worked out a hair differently from one computer to the next
            let (level, power) = heard.iter().fold((0.0f64, 0.0f64), |(a, b), v| (a + v.abs() as f64, b + (*v as f64).powi(2)));
            assert!((level / GOLD_CLICK[k].1 - 1.0).abs() < 1e-6 && (power / GOLD_CLICK[k].2 - 1.0).abs() < 1e-6, "way {k}: {level} {power}");
        }
    }
    /// for each way: the sum of the frames that sound; all the samples' sizes added up; their squares added up
    const GOLD_CLICK: [(u64, f64, f64); 3] = [(0xc3d2_312c_31b2_09d7, 3246.3261131862237, 529.9885107886493), (0x0de0_9cff_2dc2_811f, 3181.838358121371, 508.13615976891), (0xc3d2_312c_31b2_09d7, 3246.3261131862237, 529.9885107886493)];
}

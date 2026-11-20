//! The app's own sound (the song, a take heard alone, a chord tapped to be heard), played through
//! the recording engine while it has the interface open for "hear my effects".
//!
//! The app normally plays through the computer's own sound (WASAPI on Windows). Many interfaces'
//! drivers crackle when the app plays through them that way while the engine has them open
//! directly (ASIO) at the same time. So while you hear yourself through the effects, the page
//! stops playing through the computer's sound and hands what it plays to the engine instead, in
//! blocks of about 20 ms (see src/audio/through.ts), and the engine plays it alongside the voice:
//! one program at a time on the interface, never two.
//!
//! The blocks come from the page, so they come unevenly (the page can be busy), on the page's own
//! clock (which drifts a little against the interface's). So they are queued here, a little more
//! than is needed to ride out the page's hiccups, and played at a speed trimmed by a fraction of a
//! percent to keep the queue where it should be (no one hears 0.3%). If the queue runs dry (the
//! page was held up for longer than it covers), the sound fades out over 5 ms rather than stopping
//! dead, waits until the queue is full again, and fades back in, and the queue is made a little
//! longer from then on. If too much piles up (the page sent a backlog all at once), the sound
//! fades out, skips ahead and fades back in. Nothing here waits, allocates or frees memory.

/// What the page sends to: the other end of the queue (one per time the app's sound starts
/// coming through; the page's rate).
pub struct AppFeed {
    pub tx: rtrb::Producer<f32>,
    #[cfg_attr(not(test), allow(dead_code))]
    pub rate: u32,
}

impl AppFeed {
    /// Queue interleaved stereo samples sent as raw little-endian 32-bit floats (what the page
    /// sends): whole frames only, and what does not fit is left out (the engine skips ahead then
    /// anyway). Returns the frames queued now.
    pub fn push_bytes(&mut self, bytes: &[u8]) -> usize {
        let samples = bytes.len() / 4;
        let room = self.tx.slots() & !1;
        let n = samples.min(room) & !1;
        if n > 0 {
            if let Ok(chunk) = self.tx.write_chunk_uninit(n) {
                chunk.fill_from_iter(bytes.chunks_exact(4).take(n).map(|b| {
                    let v = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                    if v.is_finite() { v } else { 0.0 }
                }));
            }
        }
        (self.tx.buffer().capacity() - self.tx.slots()) / 2
    }

    /// Queue interleaved stereo samples. Whole frames only; what does not fit is left out (the
    /// engine skips ahead then anyway). Returns the frames queued now.
    #[cfg(test)]
    pub fn push(&mut self, samples: &[f32]) -> usize {
        let room = self.tx.slots() & !1;
        let n = samples.len().min(room) & !1;
        if n > 0 {
            if let Ok(chunk) = self.tx.write_chunk_uninit(n) {
                chunk.fill_from_iter(samples[..n].iter().copied());
            }
        }
        (self.tx.buffer().capacity() - self.tx.slots()) / 2
    }
}

/// How long the queue may hold (seconds of the page's sound): more than a page catching up can
/// hand over at once (the page keeps no more than three quarters of a second back, and has at
/// most two blocks on the way besides: see src/audio/throughcore.ts Outbox), on top of what is
/// queued, so nothing it sends is ever left out; the backlog is then skipped over, with fades.
pub const QUEUE_SECS: f64 = 4.0;
/// How much is kept queued at first (seconds), the most it grows to after the page has been late, and by how much each time.
/// (A page switch holds the page up for a tenth of a second or so now and then: measured, at most 120 ms on the
/// lighter pages, with the page's blocks coming every 21 ms; a sixth of a second rides that out.)
pub const START_SECS: f64 = 0.16;
pub const MOST_SECS: f64 = 0.4;
pub const GROW_SECS: f64 = 0.04;
/// More than this over what should be queued is skipped (seconds).
pub const SKIP_OVER_SECS: f64 = 0.3;
/// Fades in and out (seconds).
pub const FADE_SECS: f64 = 0.005;

/// A new queue for the app's sound at `rate`, and the engine's end of it at `engine_rate`.
pub fn queue(rate: u32, engine_rate: f32) -> (AppFeed, AppIn) {
    let (tx, rx) = rtrb::RingBuffer::<f32>::new(((rate as f64 * QUEUE_SECS) as usize) * 2);
    (AppFeed { tx, rate }, AppIn::new(rx, rate as f64, engine_rate as f64))
}

/// The engine's end of the queue, on the audio thread.
pub struct AppIn {
    rx: rtrb::Consumer<f32>,
    /// the page's frames per frame of the interface (its rate over the engine's)
    step: f64,
    /// the speed trim that keeps the queue where it should be (about 1)
    trim: f64,
    /// where between the second and third frame of `h` the sound is (0..1)
    frac: f64,
    /// the last four frames taken from the queue, for a smooth curve between the middle two
    h: [(f32, f32); 4],
    /// how many frames are queued, on average lately (the page's frames)
    fill: f64,
    /// how many should be (the page's frames), and the most that may ever be asked for
    target: f64,
    most: f64,
    grow: f64,
    skip_over: f64,
    /// enough left for a fade out (the page's frames)
    low: f64,
    playing: bool,
    /// fading out (to wait for more, to skip ahead, or because it is stopping)
    out: bool,
    gain: f32,
    fade: f32,
    /// frames to drop once faded out (catching up on a backlog)
    skip: usize,
    stopping: bool,
    /// times it ran dry
    pub gaps: u64,
}

impl AppIn {
    pub fn new(rx: rtrb::Consumer<f32>, rate: f64, engine_rate: f64) -> Self {
        AppIn {
            rx,
            step: rate / engine_rate,
            trim: 1.0,
            frac: 0.0,
            h: [(0.0, 0.0); 4],
            fill: 0.0,
            target: START_SECS * rate,
            most: MOST_SECS * rate,
            grow: GROW_SECS * rate,
            skip_over: SKIP_OVER_SECS * rate,
            low: FADE_SECS * rate * 1.05 + 8.0,
            playing: false,
            out: false,
            gain: 0.0,
            fade: (1.0 / (FADE_SECS * engine_rate)) as f32,
            skip: 0,
            stopping: false,
            gaps: 0,
        }
    }

    /// Frames waiting in the queue (the page's frames).
    pub fn queued(&self) -> usize {
        self.rx.slots() / 2
    }

    /// How much is kept queued now (seconds of the page's sound).
    #[cfg(test)]
    pub fn target_secs(&self) -> f64 {
        self.target / (self.step * self.engine_rate())
    }
    #[cfg(test)]
    fn engine_rate(&self) -> f64 {
        (1.0 / self.fade as f64) / FADE_SECS
    }

    /// Fade out and stay silent (the page has stopped sending).
    pub fn stop(&mut self) {
        self.stopping = true;
        if self.playing {
            self.out = true;
        }
    }

    /// Silent for good (stopped, and faded out).
    #[cfg(test)]
    pub fn done(&self) -> bool {
        self.stopping && (!self.playing || self.gain <= 0.0)
    }

    /// Once a block, before its frames: the speed trim, from how full the queue has been lately.
    pub fn block(&mut self, frames: usize, engine_rate: f32) {
        let q = self.queued() as f64;
        // the average over about half a second (a block's worth of it at a time)
        let k = (frames as f64 / (0.5 * engine_rate as f64)).min(1.0);
        self.fill += (q - self.fill) * k;
        if self.playing && !self.out {
            // 100 ms too full plays 0.2% faster; never more than 0.3% either way
            let err = (self.fill - self.target) / (self.step * engine_rate as f64);
            self.trim = 1.0 + (err * 0.02).clamp(-0.003, 0.003);
        }
    }

    fn take(&mut self) -> bool {
        if self.rx.slots() < 2 {
            return false;
        }
        let l = self.rx.pop().unwrap_or(0.0);
        let r = self.rx.pop().unwrap_or(0.0);
        self.h = [self.h[1], self.h[2], self.h[3], (l, r)];
        true
    }

    /// The next frame for the interface.
    #[inline]
    pub fn next(&mut self) -> (f32, f32) {
        if !self.playing {
            if self.stopping || (self.queued() as f64) < self.target {
                return (0.0, 0.0);
            }
            // full enough: start, from silence
            self.playing = true;
            self.out = false;
            self.gain = 0.0;
            self.frac = 0.0;
            self.fill = self.queued() as f64;
            self.trim = 1.0;
            for _ in 0..3 {
                self.take();
            }
        }
        if !self.out {
            let q = self.queued() as f64;
            if q < self.low {
                // running dry: fade out on what is left, and wait for more (a longer wait from now on)
                self.out = true;
                self.gaps += 1;
                self.target = (self.target + self.grow).min(self.most);
            } else if q > self.target + self.skip_over {
                // a backlog: fade out, skip ahead to where it should be, fade back in
                self.out = true;
                self.skip = (q - self.target) as usize;
            }
        }
        self.frac += self.step * self.trim;
        while self.frac >= 1.0 {
            self.frac -= 1.0;
            if !self.take() {
                // (nothing to take: the last frame holds, under a fade that is already going out)
                self.h = [self.h[1], self.h[2], self.h[3], self.h[3]];
            }
        }
        let (l, r) = hermite(&self.h, self.frac as f32);
        if self.out {
            self.gain -= self.fade;
            if self.gain <= 0.0 {
                self.gain = 0.0;
                self.out = false;
                if self.stopping {
                    self.playing = false;
                } else if self.skip > 0 {
                    for _ in 0..self.skip.min(self.queued()) {
                        self.take();
                    }
                    self.skip = 0;
                    self.fill = self.queued() as f64;
                } else {
                    self.playing = false;
                }
            }
        } else if self.gain < 1.0 {
            self.gain = (self.gain + self.fade).min(1.0);
        }
        (l * self.gain, r * self.gain)
    }
}

/// A smooth curve through four frames, between the middle two (`t` from 0 to 1): 4-point,
/// third-order Hermite. Exact on the frames themselves, and much gentler on the highs than a
/// straight line between two.
#[inline]
fn hermite(h: &[(f32, f32); 4], t: f32) -> (f32, f32) {
    let one = |y0: f32, y1: f32, y2: f32, y3: f32| {
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * t + c2) * t + c1) * t + y1
    };
    (one(h[0].0, h[1].0, h[2].0, h[3].0), one(h[0].1, h[1].1, h[2].1, h[3].1))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48000.0;

    /// The page's sound: a 440 Hz tone, left, and its negative, right, `n` frames from frame `from`.
    fn tone(from: usize, n: usize, rate: f64) -> Vec<f32> {
        (from..from + n)
            .flat_map(|i| {
                let v = 0.5 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / rate).sin() as f32;
                [v, -v]
            })
            .collect()
    }

    /// Play `blocks` blocks of 256 frames, with the page sending 1024 frames whenever `send` says.
    fn run(feed: &mut AppFeed, app: &mut AppIn, blocks: usize, sent: &mut usize, send: impl Fn(usize) -> bool) -> Vec<f32> {
        let mut out = vec![];
        for b in 0..blocks {
            if send(b) {
                feed.push(&tone(*sent, 1024, feed.rate as f64));
                *sent += 1024;
            }
            app.block(256, SR);
            for _ in 0..256 {
                out.push(app.next().0);
            }
        }
        out
    }

    /// The largest jump from one sample to the next, beyond what a 440 Hz tone at 0.5 makes.
    fn worst_step(x: &[f32]) -> f32 {
        x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max)
    }

    #[test]
    fn it_waits_until_enough_is_queued_then_fades_in_and_plays_the_sound_as_sent() {
        let (mut feed, mut app) = queue(48000, SR);
        let mut sent = 0;
        // the page sends 1024 frames every 4 blocks of 256: exactly as fast as it plays
        let out = run(&mut feed, &mut app, 2000, &mut sent, |b| b % 4 == 0);
        // silent until START_SECS are queued
        let start = out.iter().position(|v| v.abs() > 1e-6).unwrap();
        assert!(start as f64 >= START_SECS * 48000.0 - 1024.0 && (start as f64) < START_SECS * 48000.0 + 1100.0, "started at {start}");
        // no step bigger than the tone's own (0.5 × 2π × 440 / 48000 ≈ 0.029)
        assert!(worst_step(&out) < 0.035, "{}", worst_step(&out));
        // once in, it is the tone itself: the same level, and never a gap
        let tail = &out[start + 2000..];
        let peak = tail.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((peak - 0.5).abs() < 0.01, "{peak}");
        assert_eq!(app.gaps, 0);
    }

    #[test]
    fn the_page_held_up_fades_out_and_back_in_rather_than_clicking_and_waits_longer_after() {
        let (mut feed, mut app) = queue(48000, SR);
        let mut sent = 0;
        // steady, then nothing for 0.4 s (75 blocks), then steady again, with the backlog it owes sent at once
        let out = run(&mut feed, &mut app, 1200, &mut sent, |b| b % 4 == 0 && !(400..475).contains(&b) || b == 476);
        assert!(app.gaps >= 1);
        assert!(worst_step(&out) < 0.035, "no click: {}", worst_step(&out));
        // there was a gap, and the sound came back after it
        let silent = out[400 * 256..].iter().position(|v| v.abs() < 1e-7).unwrap();
        assert!(out[400 * 256 + silent..].iter().any(|v| v.abs() > 0.4));
        assert!(app.target_secs() > START_SECS);
    }

    #[test]
    fn a_backlog_is_skipped_over_without_a_click() {
        let (mut feed, mut app) = queue(48000, SR);
        let mut sent = 0;
        // steady, then 0.6 s more than it plays arrives at once
        let out = run(&mut feed, &mut app, 800, &mut sent, |b| b % 4 == 0 || (300..328).contains(&b));
        assert!(worst_step(&out) < 0.035, "no click: {}", worst_step(&out));
        assert!((app.queued() as f64) < (app.target + SKIP_OVER_SECS * 48000.0 + 2048.0), "queued {}", app.queued());
    }

    #[test]
    fn a_page_catching_up_hands_over_seconds_at_once_and_none_of_it_is_left_out() {
        // steady, then the page held up: nothing for a second, then 2.5 s at once (what it had kept, and the
        // blocks that were on the way), then steady again. Nothing is left out of the queue (a sound left out
        // part-way would jump: a click), and the backlog is skipped over with fades
        let (mut feed, mut app) = queue(48000, SR);
        let mut sent = 0usize;
        let mut out = vec![];
        for b in 0..1200 {
            if b == 500 {
                let n = 2 * 48000 + 24000;
                let frames = feed.push(&tone(sent, n, 48000.0));
                assert!(frames >= n, "all of it queued: {frames}");
                sent += n;
            } else if b % 4 == 0 && !(312..500).contains(&b) {
                feed.push(&tone(sent, 1024, 48000.0));
                sent += 1024;
            }
            app.block(256, SR);
            for _ in 0..256 {
                out.push(app.next().0);
            }
        }
        assert!(worst_step(&out) < 0.035, "no click: {}", worst_step(&out));
        assert!((app.queued() as f64) < (app.target + SKIP_OVER_SECS * 48000.0 + 2048.0), "caught up: queued {}", app.queued());
    }

    #[test]
    fn a_page_at_another_rate_or_a_drifting_clock_is_followed_without_running_dry_or_piling_up() {
        // the page at 44.1 kHz, the interface at 48 kHz, and the page's clock 0.05% fast
        let (mut feed, mut app) = queue(44100, SR);
        let mut sent = 0usize;
        let mut owed = 0.0f64;
        let mut out = vec![];
        for _ in 0..(48000 * 60 / 256) {
            // the page makes 44100 × 1.0005 frames a second, in blocks of 1024
            owed += 256.0 * 44100.0 * 1.0005 / 48000.0;
            while owed >= 1024.0 {
                feed.push(&tone(sent, 1024, 44100.0));
                sent += 1024;
                owed -= 1024.0;
            }
            app.block(256, SR);
            for _ in 0..256 {
                out.push(app.next().0);
            }
        }
        assert_eq!(app.gaps, 0, "a minute without running dry");
        let q = app.queued() as f64 / 44100.0;
        assert!(q < START_SECS + 0.06, "and without piling up: {q} s queued");
        // still a clean 440 Hz tone at the interface's rate: count its zero crossings over the last second
        let last = &out[out.len() - 48000..];
        let crossings = last.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        assert!((crossings as i64 - 440).abs() <= 2, "{crossings}");
    }

    #[test]
    fn stopping_fades_out_and_stays_silent() {
        let (mut feed, mut app) = queue(48000, SR);
        let mut sent = 0;
        let mut out = run(&mut feed, &mut app, 200, &mut sent, |b| b % 4 == 0);
        app.stop();
        out.extend(run(&mut feed, &mut app, 100, &mut sent, |b| b % 4 == 0));
        assert!(worst_step(&out) < 0.035);
        assert!(app.done());
        assert!(out[out.len() - 10000..].iter().all(|v| *v == 0.0));
    }
}

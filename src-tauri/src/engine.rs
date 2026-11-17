//! The recording engine. It opens the interface's input and output together (on Windows
//! through its ASIO driver) and, on the interface's own clock:
//! - plays the backing track (the song, rendered by the page) round and round,
//! - plays a click for the count-in (and, if wanted, while recording),
//! - sends the singer's voice through the vocal chain to the headphones ("hear my effects"),
//! - records the voice, dry, to a WAV file from the first click until Stop.
//! The take is lined up with the song from the driver's own timestamps: the moment the first
//! frame of the song is heard, and the moment each recorded sample was captured.

use std::collections::VecDeque;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamInstant};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request, Response};

use crate::fx::{Chain, VocalFx};
use crate::meter::Shared;

/// The part of the engine that runs on the audio thread. It knows nothing of the driver, so it
/// can be tested without an interface.
pub struct Core {
    sr: f32,
    in_ch: usize,
    out_ch: usize,
    /// which input is recorded and monitored (0 = Input 1)
    pub input: usize,
    /// send the voice through the chain to the headphones
    pub monitor: bool,
    pub fx: VocalFx,
    chain: Chain,
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
    per_bar: u32,
    mon: VecDeque<f32>,
    rec: Option<rtrb::Producer<f32>>,
    armed: bool,
    recording: bool,
    /// when the first frame of the count-in is heard, and when the first recorded sample was captured (seconds, driver clock)
    play0: Option<f64>,
    cap0: Option<f64>,
    pub dropped: u64,
    levels: Arc<Shared>,
}

impl Core {
    pub fn new(sr: f32, in_ch: usize, out_ch: usize, levels: Arc<Shared>) -> Self {
        let fx = VocalFx::default();
        Core {
            sr,
            in_ch: in_ch.max(1),
            out_ch: out_ch.max(1),
            input: 0,
            monitor: false,
            chain: Chain::new(sr, &fx),
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
            mon: VecDeque::with_capacity(16384),
            rec: None,
            armed: false,
            recording: false,
            play0: None,
            cap0: None,
            dropped: 0,
            levels,
        }
    }
    pub fn set_fx(&mut self, fx: &VocalFx) {
        self.fx = fx.clone();
        self.chain.set(fx);
    }
    /// The song to play under the singer: stereo, interleaved, at the engine's rate.
    pub fn set_backing(&mut self, stereo: Vec<f32>) {
        self.backing = stereo;
    }
    pub fn backing_frames(&self) -> u64 {
        (self.backing.len() / 2) as u64
    }
    /// Start: the count-in, then the song round and round. With a recorder, everything sung is kept.
    pub fn start(&mut self, bpm: f64, count_in_beats: u32, per_bar: u32, rec: Option<rtrb::Producer<f32>>) {
        self.beat = self.sr as f64 * 60.0 / bpm.max(20.0);
        self.count_in = (self.beat * count_in_beats as f64).round() as u64;
        self.per_bar = per_bar.max(1);
        self.rec = rec;
        self.recording = false;
        self.armed = false;
        self.play0 = None;
        self.cap0 = None;
        self.dropped = 0;
        self.pending = true;
    }
    /// Stop playing and recording. Returns (heard-at, captured-at) of the first frames, if recorded.
    pub fn stop(&mut self) -> (Option<f64>, Option<f64>) {
        self.running = false;
        self.pending = false;
        self.armed = false;
        self.recording = false;
        self.rec = None;
        (self.play0, self.cap0)
    }
    pub fn running(&self) -> bool {
        self.running || self.pending
    }
    /// Frames since the first click (for the take counter).
    pub fn position(&self) -> (u64, u64, u64) {
        (self.pos, self.count_in, self.backing_frames())
    }
    pub fn reduction(&self) -> f32 {
        self.chain.reduction()
    }

    /// A block from the interface's inputs (interleaved).
    pub fn on_input(&mut self, data: &[f32], captured: f64) {
        self.levels.feed(data);
        let ch = self.in_ch;
        let input = self.input.min(ch - 1);
        if self.armed && !self.recording {
            self.recording = true;
            self.cap0 = Some(captured);
        }
        for frame in data.chunks(ch) {
            let v = frame[input];
            if self.monitor {
                if self.mon.len() >= 16384 {
                    self.mon.pop_front();
                }
                self.mon.push_back(v);
            }
            if self.recording {
                if let Some(p) = self.rec.as_mut() {
                    if p.push(v).is_err() {
                        self.dropped += 1;
                    }
                }
            }
        }
    }

    fn click(&self, pos: u64) -> f32 {
        let since = if pos < self.count_in { pos } else if self.click_on { pos - self.count_in } else { return 0.0 };
        let beat = (since as f64 / self.beat).floor();
        let into = since as f64 - beat * self.beat;
        let t = into / self.sr as f64;
        if t > 0.06 {
            return 0.0;
        }
        let first = (beat as u64) % self.per_bar as u64 == 0;
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
            self.armed = self.rec.is_some();
        }
        let ch = self.out_ch;
        let len = self.backing_frames();
        // keep the monitor from falling behind (never more than a few blocks of delay)
        let frames = out.len() / ch;
        while self.mon.len() > frames * 3 + 64 {
            self.mon.pop_front();
        }
        for frame in out.chunks_mut(ch) {
            let (mut l, mut r) = (0.0f32, 0.0f32);
            if self.running {
                if self.pos >= self.count_in && len > 0 {
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
                let (a, b) = self.chain.run(v);
                l += a;
                r += b;
            }
            frame[0] = l;
            if ch > 1 {
                frame[1] = r;
            }
            for x in frame.iter_mut().skip(2) {
                *x = 0.0;
            }
        }
    }
}

// ── The engine as the app uses it ──────────────────────────────

struct Live {
    core: Arc<Mutex<Core>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    rate: u32,
}
struct Recording {
    dry: PathBuf,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<Result<u64, String>>>,
}
static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static REC: Mutex<Option<Recording>> = Mutex::new(None);

#[derive(Serialize, Clone)]
pub struct Opened {
    pub host: String,
    pub device: String,
    pub rate: u32,
    pub inputs: u16,
    pub outputs: u16,
    pub format: String,
}

/// About thirty times a second: the input levels, where the music is, and the compression.
#[derive(Serialize, Clone)]
pub struct Status {
    pub peak: Vec<f32>,
    pub rms: Vec<f32>,
    /// frames since the first click; the count-in's length; the loop's length (frames)
    pub pos: u64,
    pub count_in: u64,
    pub length: u64,
    pub running: bool,
    /// dB the compressors are turning the voice down
    pub reduction: f32,
}

/// Seconds on the driver's clock, from a fixed starting point.
fn secs(t: StreamInstant, base: &Mutex<Option<StreamInstant>>) -> f64 {
    let mut b = base.lock().unwrap();
    let b0 = *b.get_or_insert(t);
    match t.checked_duration_since(b0) {
        Some(d) => d.as_secs_f64(),
        None => -b0.duration_since(t).as_secs_f64(),
    }
}

fn input_stream<T>(d: &cpal::Device, cfg: cpal::StreamConfig, core: Arc<Mutex<Core>>, base: Arc<Mutex<Option<StreamInstant>>>) -> Result<cpal::Stream, String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let mut buf: Vec<f32> = Vec::with_capacity(8192);
    d.build_input_stream::<T, _, _>(
        cfg,
        move |data: &[T], info| {
            buf.clear();
            buf.extend(data.iter().map(|s| f32::from_sample(*s)));
            let at = secs(info.timestamp().capture, &base);
            if let Ok(mut c) = core.try_lock() {
                c.on_input(&buf, at);
            }
        },
        |e| eprintln!("input: {e}"),
        None,
    )
    .map_err(|e| e.to_string())
}

fn output_stream<T>(d: &cpal::Device, cfg: cpal::StreamConfig, core: Arc<Mutex<Core>>, base: Arc<Mutex<Option<StreamInstant>>>) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let mut buf: Vec<f32> = Vec::with_capacity(8192);
    d.build_output_stream::<T, _, _>(
        cfg,
        move |data: &mut [T], info| {
            buf.clear();
            buf.resize(data.len(), 0.0);
            let at = secs(info.timestamp().playback, &base);
            if let Ok(mut c) = core.try_lock() {
                c.on_output(&mut buf, at);
            }
            for (o, v) in data.iter_mut().zip(buf.iter()) {
                *o = T::from_sample(*v);
            }
        },
        |e| eprintln!("output: {e}"),
        None,
    )
    .map_err(|e| e.to_string())
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

fn with_core<R>(f: impl FnOnce(&mut Core) -> R) -> Result<R, String> {
    let g = LIVE.lock().map_err(|_| "engine busy")?;
    let l = g.as_ref().ok_or("The interface is not open")?;
    let mut c = l.core.lock().map_err(|_| "engine busy")?;
    Ok(f(&mut c))
}

/// Open the interface (input and output together) and start reporting levels.
#[tauri::command]
pub fn engine_open(host: String, device_name: String, status: Channel<Status>) -> Result<Opened, String> {
    crate::meter::stop();
    close_engine();
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<Result<(Opened, Arc<Mutex<Core>>), String>>();
    let flag = stop.clone();
    let thread = std::thread::spawn(move || {
        let made = (|| -> Result<(Vec<cpal::Stream>, Arc<Mutex<Core>>, Arc<Shared>, Opened), String> {
            let (h, d) = device(&host, &device_name)?;
            let oc = d.default_output_config().map_err(|e| format!("No outputs: {e}"))?;
            let ic = d.default_input_config().map_err(|e| format!("No inputs: {e}"))?;
            let rate = oc.sample_rate();
            let mut icfg = ic.config();
            icfg.sample_rate = rate;
            let ocfg = oc.config();
            let shared = Arc::new(Shared::new(icfg.channels as usize));
            let core = Arc::new(Mutex::new(Core::new(rate as f32, icfg.channels as usize, ocfg.channels as usize, shared.clone())));
            let base = Arc::new(Mutex::new(None));
            let input = match ic.sample_format() {
                SampleFormat::F32 => input_stream::<f32>(&d, icfg.clone(), core.clone(), base.clone()),
                SampleFormat::I32 => input_stream::<i32>(&d, icfg.clone(), core.clone(), base.clone()),
                SampleFormat::I16 => input_stream::<i16>(&d, icfg.clone(), core.clone(), base.clone()),
                other => Err(format!("Inputs send {other} samples, which the engine cannot read yet")),
            }?;
            let output = match oc.sample_format() {
                SampleFormat::F32 => output_stream::<f32>(&d, ocfg.clone(), core.clone(), base.clone()),
                SampleFormat::I32 => output_stream::<i32>(&d, ocfg.clone(), core.clone(), base.clone()),
                SampleFormat::I16 => output_stream::<i16>(&d, ocfg.clone(), core.clone(), base.clone()),
                other => Err(format!("Outputs take {other} samples, which the engine cannot write yet")),
            }?;
            // input first, so each block of voice is in hand before the block of sound that follows it
            input.play().map_err(|e| e.to_string())?;
            output.play().map_err(|e| e.to_string())?;
            let opened = Opened { host: h.id().name().to_string(), device: d.to_string(), rate, inputs: icfg.channels, outputs: ocfg.channels, format: oc.sample_format().to_string() };
            Ok((vec![input, output], core, shared, opened))
        })();
        match made {
            Err(e) => {
                let _ = tx.send(Err(e));
            }
            Ok((streams, core, shared, opened)) => {
                let _ = tx.send(Ok((opened, core.clone())));
                while !flag.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(33));
                    let l = shared.take();
                    let (pos, count_in, length, running, reduction) = match core.lock() {
                        Ok(c) => {
                            let (p, ci, len) = c.position();
                            (p, ci, len, c.running(), c.reduction())
                        }
                        Err(_) => (0, 0, 0, false, 0.0),
                    };
                    if status.send(Status { peak: l.peak, rms: l.rms, pos, count_in, length, running, reduction }).is_err() {
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
        Ok((opened, core)) => {
            if let Ok(mut g) = LIVE.lock() {
                *g = Some(Live { core, stop, thread: Some(thread), rate: opened.rate });
            }
            Ok(opened)
        }
    }
}

#[tauri::command]
pub fn engine_close() {
    let _ = engine_stop_inner();
    close_engine();
}

/// What the singer hears and how: monitoring through the chain, which input, the chain's settings, levels.
#[tauri::command]
pub fn engine_set(monitor: bool, input: usize, fx: VocalFx, backing_gain: f32, click_gain: f32, click_on: bool) -> Result<(), String> {
    with_core(|c| {
        c.monitor = monitor;
        c.input = input;
        if c.fx != fx {
            c.set_fx(&fx);
        }
        c.backing_gain = backing_gain.clamp(0.0, 2.0);
        c.click_gain = click_gain.clamp(0.0, 1.5);
        c.click_on = click_on;
    })
}

/// The song to sing over, as raw little-endian 32-bit floats, stereo, at the engine's rate.
#[tauri::command]
pub fn engine_backing(request: Request) -> Result<u64, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw audio".into()) };
    let samples: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    with_core(|c| {
        c.set_backing(samples);
        c.backing_frames()
    })
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
#[tauri::command]
pub fn engine_start(app: tauri::AppHandle, bpm: f64, count_in_beats: u32, beats_per_bar: u32, record: bool, name: String) -> Result<Option<String>, String> {
    let _ = engine_stop_inner();
    let rate = LIVE.lock().ok().and_then(|g| g.as_ref().map(|l| l.rate)).ok_or("The interface is not open")?;
    let mut producer = None;
    let mut path = None;
    if record {
        let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' }).collect();
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let dry = recordings_dir(&app)?.join(format!("{safe}-{stamp}.wav"));
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(rate as usize * 20);
        let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
        let mut w = hound::WavWriter::create(&dry, spec).map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::spawn(move || -> Result<u64, String> {
            let mut n = 0u64;
            let mut since = 0u64;
            loop {
                let avail = cons.slots();
                if avail == 0 {
                    if flag.load(Ordering::Relaxed) || cons.is_abandoned() {
                        if cons.slots() == 0 {
                            break;
                        }
                        continue;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                }
                let chunk = cons.read_chunk(avail).map_err(|e| e.to_string())?;
                for v in chunk.into_iter() {
                    w.write_sample(v).map_err(|e| e.to_string())?;
                    n += 1;
                }
                since += avail as u64;
                // a crash never loses more than a second or so
                if since > rate as u64 {
                    w.flush().map_err(|e| e.to_string())?;
                    since = 0;
                }
            }
            w.finalize().map_err(|e| e.to_string())?;
            Ok(n)
        });
        producer = Some(p);
        path = Some(dry.to_string_lossy().to_string());
        if let Ok(mut g) = REC.lock() {
            *g = Some(Recording { dry, stop, thread: Some(thread) });
        }
    }
    with_core(|c| c.start(bpm, count_in_beats, beats_per_bar, producer))?;
    Ok(path)
}

#[derive(Serialize, Clone)]
pub struct Recorded {
    pub dry: String,
    pub wet: String,
    pub rate: u32,
    /// samples in the file
    pub frames: u64,
    /// where the first frame of the count-in lies in the file (the driver's round trip), in frames
    pub offset: i64,
    pub count_in: u64,
    pub loop_frames: u64,
    pub dropped: u64,
}

fn engine_stop_inner() -> Result<Option<Recorded>, String> {
    let (times, count_in, loop_frames, dropped, fx, rate) = match with_core(|c| {
        let t = c.stop();
        let (_, ci, len) = c.position();
        (t, ci, len, c.dropped, c.fx.clone(), c.sr as u32)
    }) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let rec = REC.lock().ok().and_then(|mut g| g.take());
    let Some(mut rec) = rec else { return Ok(None) };
    rec.stop.store(true, Ordering::Relaxed);
    let frames = rec.thread.take().map(|t| t.join().map_err(|_| "the writer stopped".to_string()).and_then(|r| r)).unwrap_or(Ok(0))?;
    let offset = match times {
        (Some(heard), Some(captured)) => ((heard - captured) * rate as f64).round() as i64,
        _ => 0,
    };
    let wet = render_wet(&rec.dry, &fx)?;
    Ok(Some(Recorded { dry: rec.dry.to_string_lossy().to_string(), wet, rate, frames, offset, count_in, loop_frames, dropped }))
}

/// Stop playing; if recording, close the file and make the version with the vocal chain on it.
#[tauri::command]
pub fn engine_stop() -> Result<Option<Recorded>, String> {
    engine_stop_inner()
}

/// The take through the vocal chain, written next to it (`…-wet-N.wav`, stereo).
fn render_wet(dry: &PathBuf, fx: &VocalFx) -> Result<String, String> {
    let mut r = hound::WavReader::open(dry).map_err(|e| e.to_string())?;
    let spec = r.spec();
    let samples: Vec<f32> = r.samples::<f32>().filter_map(|s| s.ok()).collect();
    let mut chain = Chain::new(spec.sample_rate as f32, fx);
    let wet = chain.render(&samples);
    let stem = dry.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut n = 1;
    let mut out = dry.with_file_name(format!("{stem}-wet-{n}.wav"));
    while out.exists() {
        n += 1;
        out = dry.with_file_name(format!("{stem}-wet-{n}.wav"));
    }
    let spec2 = hound::WavSpec { channels: 2, sample_rate: spec.sample_rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let mut w = hound::WavWriter::new(BufWriter::new(File::create(&out).map_err(|e| e.to_string())?), spec2).map_err(|e| e.to_string())?;
    for v in wet {
        w.write_sample(v).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().to_string())
}

/// Make the version with the vocal chain again, after its settings were changed.
#[tauri::command]
pub async fn fx_render(dry: String, fx: VocalFx) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || render_wet(&PathBuf::from(dry), &fx)).await.map_err(|e| e.to_string())?
}

/// A recording, as bytes (to be played with the song).
#[tauri::command]
pub async fn read_take(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if p.extension().map(|e| e != "wav").unwrap_or(true) {
        return Err("only recordings can be read".into());
    }
    tauri::async_runtime::spawn_blocking(move || std::fs::read(p)).await.map_err(|e| e.to_string())?.map(Response::new).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48000.0;

    fn core() -> Core {
        Core::new(SR, 2, 2, Arc::new(Shared::new(2)))
    }

    #[test]
    fn the_count_in_clicks_then_the_song_plays_round_and_round() {
        let mut c = core();
        // a "song" of one bar at 120 bpm: 2 s of a steady level on the left
        c.set_backing((0..96000).flat_map(|_| [0.25f32, 0.0]).collect());
        c.start(120.0, 4, 4, None);
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
    fn the_voice_is_recorded_from_the_first_click_with_both_moments_known() {
        let mut c = core();
        c.set_backing(vec![0.0; 2000]);
        let (p, mut cons) = rtrb::RingBuffer::<f32>::new(100000);
        c.start(120.0, 4, 4, Some(p));
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
}

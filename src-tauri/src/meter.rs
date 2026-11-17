//! A live input meter: opens one input device (the Scarlett, through its ASIO driver on
//! Windows) and reports how loud each input is, about thirty times a second. It is the first
//! piece of the recording engine: the same stream will later write takes to disk.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use serde::Serialize;
use tauri::ipc::Channel;

/// Every thirtieth of a second: the loudest sample of each input since the last report (0..1),
/// and how loud it was on average (RMS).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Levels {
    pub peak: Vec<f32>,
    pub rms: Vec<f32>,
}

/// What was opened.
#[derive(Serialize, Clone, Debug)]
pub struct Opened {
    pub host: String,
    pub device: String,
    pub channels: u16,
    pub sample_rate: u32,
    pub format: String,
}

struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

/// The levels shared between the audio thread and the reporting thread, without locks:
/// the audio thread only raises a peak and adds to a sum.
pub struct Shared {
    peak: Vec<AtomicU32>,
    sum: Vec<AtomicU32>,
    count: AtomicU32,
}

impl Shared {
    pub fn new(channels: usize) -> Self {
        Shared { peak: (0..channels).map(|_| AtomicU32::new(0)).collect(), sum: (0..channels).map(|_| AtomicU32::new(0)).collect(), count: AtomicU32::new(0) }
    }
    /// Take in one block of interleaved samples.
    pub fn feed<T: Sample>(&self, data: &[T])
    where
        f32: FromSample<T>,
    {
        let ch = self.peak.len();
        if ch == 0 {
            return;
        }
        let mut peaks = [0f32; 8];
        let mut sums = [0f32; 8];
        for frame in data.chunks(ch) {
            for (c, s) in frame.iter().enumerate().take(8) {
                let v = f32::from_sample(*s).abs();
                if v > peaks[c] {
                    peaks[c] = v;
                }
                sums[c] += v * v;
            }
        }
        for c in 0..ch.min(8) {
            let _ = self.peak[c].fetch_update(Ordering::Relaxed, Ordering::Relaxed, |old| (peaks[c] > f32::from_bits(old)).then(|| peaks[c].to_bits()));
            let _ = self.sum[c].fetch_update(Ordering::Relaxed, Ordering::Relaxed, |old| Some((f32::from_bits(old) + sums[c]).to_bits()));
        }
        self.count.fetch_add((data.len() / ch) as u32, Ordering::Relaxed);
    }
    /// What has come in since the last call, and start again.
    pub fn take(&self) -> Levels {
        let n = self.count.swap(0, Ordering::Relaxed).max(1) as f32;
        let peak = self.peak.iter().map(|p| f32::from_bits(p.swap(0, Ordering::Relaxed)).min(1.0)).collect();
        let rms = self.sum.iter().map(|s| (f32::from_bits(s.swap(0, Ordering::Relaxed)) / n).sqrt().min(1.0)).collect();
        Levels { peak, rms }
    }
}

fn find(host: &str, device: &str) -> Result<(cpal::Host, cpal::Device), String> {
    let id = cpal::available_hosts().into_iter().find(|h| h.name().eq_ignore_ascii_case(host)).ok_or_else(|| format!("No {host} audio on this computer"))?;
    let h = cpal::host_from_id(id).map_err(|e| e.to_string())?;
    let d = h.input_devices().map_err(|e| e.to_string())?.find(|d| d.to_string() == device).ok_or_else(|| format!("{device} is not connected"))?;
    Ok((h, d))
}

fn build<T>(d: &cpal::Device, config: cpal::StreamConfig, shared: Arc<Shared>) -> Result<cpal::Stream, String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    d.build_input_stream::<T, _, _>(config, move |data: &[T], _| shared.feed(data), |e| eprintln!("input stream: {e}"), None).map_err(|e| e.to_string())
}

/// Stop the meter, if it is running.
pub fn stop() {
    let r = RUNNING.lock().ok().and_then(|mut g| g.take());
    if let Some(mut r) = r {
        r.stop.store(true, Ordering::Relaxed);
        if let Some(t) = r.thread.take() {
            let _ = t.join();
        }
    }
}

/// Open an input device and start reporting its levels.
#[tauri::command]
pub fn meter_start(host: String, device: String, levels: Channel<Levels>) -> Result<Opened, String> {
    stop();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<Result<Opened, String>>();
    let flag = stop_flag.clone();
    // the stream lives on a thread of its own (on some systems a stream must stay on the thread that made it)
    let thread = std::thread::spawn(move || {
        let opened = (|| -> Result<(cpal::Stream, Arc<Shared>, Opened), String> {
            let (h, d) = find(&host, &device)?;
            let sc = d.default_input_config().map_err(|e| e.to_string())?;
            let channels = sc.channels();
            let shared = Arc::new(Shared::new(channels as usize));
            let config = sc.config();
            let stream = match sc.sample_format() {
                SampleFormat::F32 => build::<f32>(&d, config, shared.clone()),
                SampleFormat::I32 => build::<i32>(&d, config, shared.clone()),
                SampleFormat::I16 => build::<i16>(&d, config, shared.clone()),
                SampleFormat::F64 => build::<f64>(&d, config, shared.clone()),
                other => Err(format!("This device sends {other} samples, which the meter cannot read yet")),
            }?;
            stream.play().map_err(|e| e.to_string())?;
            let info = Opened { host: h.id().name().to_string(), device: d.to_string(), channels, sample_rate: sc.sample_rate(), format: sc.sample_format().to_string() };
            Ok((stream, shared, info))
        })();
        match opened {
            Err(e) => {
                let _ = tx.send(Err(e));
            }
            Ok((stream, shared, info)) => {
                let _ = tx.send(Ok(info));
                while !flag.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(33));
                    if levels.send(shared.take()).is_err() {
                        break; // the page has gone
                    }
                }
                drop(stream);
            }
        }
    });
    let result = rx.recv_timeout(Duration::from_secs(10)).unwrap_or_else(|_| Err("The audio driver did not answer".into()));
    if result.is_ok() {
        if let Ok(mut g) = RUNNING.lock() {
            *g = Some(Running { stop: stop_flag, thread: Some(thread) });
        }
    } else {
        stop_flag.store(true, Ordering::Relaxed);
    }
    result
}

/// Close the input device.
#[tauri::command]
pub fn meter_stop() {
    stop();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_follow_each_input_and_start_again_after_each_report() {
        let s = Shared::new(2);
        // input 1 loud, input 2 quiet, interleaved
        s.feed(&[0.5f32, 0.01, -0.9, 0.02, 0.1, -0.03]);
        let l = s.take();
        assert_eq!(l.peak, vec![0.9, 0.03]);
        assert!((l.rms[0] - ((0.25 + 0.81 + 0.01) / 3f32).sqrt()).abs() < 1e-6);
        assert_eq!(s.take().peak, vec![0.0, 0.0]);
    }

    #[test]
    fn integer_samples_are_read_as_full_scale() {
        let s = Shared::new(1);
        s.feed(&[i32::MIN, 0, i32::MAX / 2]);
        assert!((s.take().peak[0] - 1.0).abs() < 1e-6);
        s.feed(&[i16::MAX / 2]);
        assert!((s.take().peak[0] - 0.5).abs() < 1e-3);
    }

    #[test]
    fn a_device_that_is_not_there_is_reported_plainly() {
        let e = find("NoSuchHost", "x").err().unwrap();
        assert!(e.contains("NoSuchHost"));
    }
}

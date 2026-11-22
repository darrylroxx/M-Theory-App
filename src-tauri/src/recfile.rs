//! Recordings on disk: writing the voice as it arrives, making the version through the vocal
//! chain, reading back just one take, and how much room the disk has left.
//!
//! A flow session can run for an hour or more, so nothing here ever holds a whole recording in
//! memory: the voice is written as it comes, the vocal chain runs over the file a block at a
//! time, and a take is read back on its own (a minute of an hour-long file is a minute's worth
//! of memory, not an hour's).

use std::fs::File;
use std::io::{BufWriter, Cursor, Read, Seek, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use crate::dsp::db_to_gain;
use crate::fx::{Chain, VocalFx};

/// A WAV file counts its bytes in 32 bits, so it cannot hold more than 4 GiB. The version
/// through the vocal chain is the bigger file (stereo, 8 bytes a frame; a recording of a pair
/// of inputs is as big), so a recording stops taking sound a little before that would be
/// reached (about 3 hours at 48 kHz). Without this the count would wrap round silently and the
/// file would read back as a few seconds.
pub const MAX_FRAMES: u64 = (u32::MAX as u64 - 64 * 1024) / 8;

/// How far the version through the vocal chain has got (0..1 as f32 bits; 0 when none is being made).
pub static RENDER: AtomicU32 = AtomicU32::new(0);

/// What the writer reports while a recording is being written. Read by the status loop.
#[derive(Default)]
pub struct Writing {
    /// frames in the file so far
    pub written: AtomicU64,
    /// bytes free on the disk the file is on (0 until known)
    pub free: AtomicU64,
    /// the file has stopped taking sound: it reached its size limit, or the disk is full
    pub full: AtomicBool,
}

/// Write the voice to `w` as it arrives from the audio thread, until `stop` (then whatever is
/// still waiting is written too). Never more than `max` frames: past that the rest is let go
/// and `full` is set, so the app can stop and say why. A write that fails (the disk is full)
/// does the same, and what was written until then is kept: a long session is never thrown
/// away because its end could not be saved. The header is brought up to date about once a
/// second, so even a crash loses at most a second or so. Returns the frames written, and why
/// it stopped early, if it did.
///
/// How many samples make a frame is the writer's own channel count (`w.spec().channels`): one
/// for a voice, two for a pair of inputs, whose samples arrive left, right, left, right. Only
/// whole frames are taken from the queue, so left and right can never change places in the file.
pub fn write_voice<W: Write + Seek>(mut cons: rtrb::Consumer<f32>, mut w: hound::WavWriter<W>, stop: &AtomicBool, st: &Writing, rate: u32, max: u64, mut free: impl FnMut() -> Option<u64>) -> (u64, Option<String>) {
    let ch = w.spec().channels.max(1) as usize;
    // samples written (frames x channels)
    let mut n = 0u64;
    let mut since = 0u64;
    let mut since_disk = u64::MAX;
    let mut note: Option<String> = None;
    loop {
        // the disk's free space, every few seconds (asking is cheap, but not free)
        if since_disk >= rate as u64 * 5 {
            st.free.store(free().unwrap_or(0), Ordering::Relaxed);
            since_disk = 0;
        }
        let avail = cons.slots() / ch * ch;
        if avail == 0 {
            if stop.load(Ordering::Relaxed) || cons.is_abandoned() {
                // (less than a frame left over is not a frame: nothing more will come to finish it)
                if cons.slots() < ch {
                    break;
                }
                continue;
            }
            std::thread::sleep(Duration::from_millis(5));
            continue;
        }
        let Ok(chunk) = cons.read_chunk(avail) else { continue };
        for v in chunk.into_iter() {
            if note.is_some() {
                continue;
            }
            if n >= max.saturating_mul(ch as u64) {
                note = Some("the recording reached the longest a file can hold".into());
                st.full.store(true, Ordering::Relaxed);
                continue;
            }
            if let Err(e) = w.write_sample(v) {
                note = Some(format!("the disk would not take more ({e})"));
                st.full.store(true, Ordering::Relaxed);
                continue;
            }
            n += 1;
        }
        since += (avail / ch) as u64;
        since_disk += (avail / ch) as u64;
        st.written.store(n / ch as u64, Ordering::Relaxed);
        if since > rate as u64 && note.is_none() {
            if let Err(e) = w.flush() {
                note = Some(format!("the disk would not take more ({e})"));
                st.full.store(true, Ordering::Relaxed);
            }
            since = 0;
        }
    }
    if let Err(e) = w.finalize() {
        note.get_or_insert(format!("the file could not be closed ({e})"));
    }
    st.written.store(n / ch as u64, Ordering::Relaxed);
    (n / ch as u64, note)
}

/// The voice through the vocal chain, a block at a time. The chain works one sample after
/// another and keeps its state between them, so this gives exactly what running the whole
/// file at once would, without ever holding the file (or its result) in memory. A last sample
/// cut short by a crash simply ends it. Returns the frames written.
pub fn stream_wet<R: Read, W: Write + Seek>(mut r: hound::WavReader<R>, mut w: hound::WavWriter<W>, chain: &mut Chain, mut progress: impl FnMut(f32)) -> Result<u64, String> {
    const BLOCK: usize = 1 << 16;
    let total = r.duration() as u64;
    if total > MAX_FRAMES {
        return Err("This recording is too long to put the vocal sound on".into());
    }
    let mut block: Vec<f32> = Vec::with_capacity(BLOCK);
    let mut done = 0u64;
    let mut samples = r.samples::<f32>();
    loop {
        block.clear();
        for s in samples.by_ref().take(BLOCK) {
            match s {
                Ok(v) => block.push(v),
                Err(_) => break,
            }
        }
        if block.is_empty() {
            break;
        }
        for &x in &block {
            let (l, r) = chain.run(x);
            w.write_sample(l).map_err(|e| e.to_string())?;
            w.write_sample(r).map_err(|e| e.to_string())?;
        }
        done += block.len() as u64;
        progress(if total > 0 { (done as f32 / total as f32).min(1.0) } else { 1.0 });
        if block.len() < BLOCK {
            break;
        }
    }
    w.finalize().map_err(|e| e.to_string())?;
    Ok(done)
}

/// What a pair of inputs is turned up or down by: the vocal sound's Output level (dB), as a
/// gain. It is all of the vocal sound a pair has (the chain takes one voice), whether the chain
/// is on or off. At 0 dB it is exactly 1: the pair as it came in.
pub fn pair_gain(fx: &VocalFx) -> f32 {
    db_to_gain(fx.level.clamp(-24.0, 12.0))
}

/// The second file of a recording of a pair of inputs: the pair as recorded, left and right,
/// times `gain` (see `pair_gain`), a block at a time as `stream_wet` does it. A last frame cut
/// short by a crash is left out. Returns the frames written.
pub fn stream_pair<R: Read, W: Write + Seek>(mut r: hound::WavReader<R>, mut w: hound::WavWriter<W>, gain: f32, mut progress: impl FnMut(f32)) -> Result<u64, String> {
    const BLOCK: usize = 1 << 16;
    let total = r.duration() as u64;
    if total > MAX_FRAMES {
        return Err("This recording is too long to put the vocal sound on".into());
    }
    let mut block: Vec<f32> = Vec::with_capacity(BLOCK);
    let mut done = 0u64;
    let mut samples = r.samples::<f32>();
    loop {
        block.clear();
        for s in samples.by_ref().take(BLOCK) {
            match s {
                Ok(v) => block.push(v),
                Err(_) => break,
            }
        }
        for f in block.chunks_exact(2) {
            w.write_sample(f[0] * gain).map_err(|e| e.to_string())?;
            w.write_sample(f[1] * gain).map_err(|e| e.to_string())?;
        }
        done += (block.len() / 2) as u64;
        progress(if total > 0 { (done as f32 / total as f32).min(1.0) } else { 1.0 });
        if block.len() < BLOCK {
            break;
        }
    }
    w.finalize().map_err(|e| e.to_string())?;
    Ok(done)
}

/// The recording through the vocal chain, written next to it (`…-wet-N.wav`, stereo). If it
/// cannot be finished (the disk is full), the part-made file is removed again. A recording of
/// a pair of inputs (a stereo file) does not go through the chain: see `stream_pair`.
pub fn render_wet(dry: &Path, fx: &VocalFx) -> Result<String, String> {
    let r = hound::WavReader::open(dry).map_err(|e| e.to_string())?;
    let spec = r.spec();
    let stem = dry.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut n = 1;
    let mut out = dry.with_file_name(format!("{stem}-wet-{n}.wav"));
    while out.exists() {
        n += 1;
        out = dry.with_file_name(format!("{stem}-wet-{n}.wav"));
    }
    let spec2 = hound::WavSpec { channels: 2, sample_rate: spec.sample_rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let made = (|| -> Result<u64, String> {
        let w = hound::WavWriter::new(BufWriter::new(File::create(&out).map_err(|e| e.to_string())?), spec2).map_err(|e| e.to_string())?;
        if spec.channels == 2 {
            return stream_pair(r, w, pair_gain(fx), |p| RENDER.store(p.max(1e-6).to_bits(), Ordering::Relaxed));
        }
        let mut chain = Chain::new(spec.sample_rate as f32, fx);
        stream_wet(r, w, &mut chain, |p| RENDER.store(p.max(1e-6).to_bits(), Ordering::Relaxed))
    })();
    RENDER.store(0, Ordering::Relaxed);
    match made {
        Ok(_) => Ok(out.to_string_lossy().to_string()),
        Err(e) => {
            let _ = std::fs::remove_file(&out);
            Err(e)
        }
    }
}

/// Only recordings can be read back (never any other file the app is asked for).
pub fn is_recording(p: &Path) -> bool {
    p.extension().map(|e| e.eq_ignore_ascii_case("wav")).unwrap_or(false)
}

/// Just one part of a recording, as a small WAV of its own: `frames` frames from `start`
/// (cut short at the end of the file). A take is read this way, so an hour-long recording is
/// never loaded, sent to the page and decoded whole to play one pass of it. A part that begins
/// before the file (a negative `start`) begins with silence for the frames before it, so what
/// follows keeps its place in time.
pub fn read_range(path: &Path, start: i64, frames: u64) -> Result<Vec<u8>, String> {
    let r = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    range_of(r, start, frames)
}

pub fn range_of<R: Read + Seek>(mut r: hound::WavReader<R>, start: i64, frames: u64) -> Result<Vec<u8>, String> {
    let spec = r.spec();
    let total = r.duration() as u64;
    // the frames before the file, as silence; then the file from its first frame
    let before = start.min(0).unsigned_abs().min(frames);
    let from = (start.max(0) as u64).min(total);
    let inside = (frames - before).min(total - from);
    if inside == 0 {
        return Err("That part of the recording is not there".into());
    }
    r.seek(from as u32).map_err(|e| e.to_string())?;
    let ch = spec.channels.max(1) as u64;
    let out_spec = hound::WavSpec { channels: spec.channels, sample_rate: spec.sample_rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let mut out = Cursor::new(Vec::with_capacity(64 + ((before + inside) * ch * 4) as usize));
    {
        let mut w = hound::WavWriter::new(&mut out, out_spec).map_err(|e| e.to_string())?;
        for _ in 0..before * ch {
            w.write_sample(0.0f32).map_err(|e| e.to_string())?;
        }
        let mut n = 0u64;
        for s in r.samples::<f32>().take((inside * ch) as usize) {
            match s {
                Ok(v) => w.write_sample(v).map_err(|e| e.to_string())?,
                Err(_) => break,
            }
            n += 1;
        }
        // a file cut short mid-frame: the frame is finished with silence, so the WAV stays whole
        while !n.is_multiple_of(ch) {
            w.write_sample(0.0f32).map_err(|e| e.to_string())?;
            n += 1;
        }
        w.finalize().map_err(|e| e.to_string())?;
    }
    Ok(out.into_inner())
}

/// Bytes free on the disk that holds `dir`, for whoever is running the app (None if the
/// system will not say).
pub fn free_space(dir: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut free = 0u64;
        // SAFETY: a NUL-terminated wide path, and one place to put the one number asked for
        let ok = unsafe { windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok != 0 {
            Some(free)
        } else {
            None
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
        // SAFETY: statvfs only fills the struct it is given, from a NUL-terminated path
        let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut s) } == 0 {
            #[allow(clippy::unnecessary_cast)]
            Some(s.f_bavail as u64 * s.f_frsize as u64)
        } else {
            None
        }
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = dir;
        None
    }
}

/// A fresh file name for a recording that does not exist yet (used by tests).
#[cfg(test)]
pub fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("m-theory-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: u32 = 48000;

    fn mono() -> hound::WavSpec {
        hound::WavSpec { channels: 1, sample_rate: SR, bits_per_sample: 32, sample_format: hound::SampleFormat::Float }
    }
    fn wav(spec: hound::WavSpec, samples: &[f32]) -> Vec<u8> {
        let mut out = Cursor::new(vec![]);
        {
            let mut w = hound::WavWriter::new(&mut out, spec).unwrap();
            for &v in samples {
                w.write_sample(v).unwrap();
            }
            w.finalize().unwrap();
        }
        out.into_inner()
    }
    fn read_all(bytes: Vec<u8>) -> (hound::WavSpec, Vec<f32>) {
        let mut r = hound::WavReader::new(Cursor::new(bytes)).unwrap();
        let spec = r.spec();
        (spec, r.samples::<f32>().map(|s| s.unwrap()).collect())
    }
    fn voice(n: usize) -> Vec<f32> {
        (0..n).map(|i| ((i as f32 * 0.031).sin() * 0.4 + (i as f32 * 0.0007).sin() * 0.2) * if (i / 9000) % 3 == 2 { 0.05 } else { 1.0 }).collect()
    }

    #[test]
    fn the_vocal_sound_is_put_on_a_block_at_a_time_exactly_as_all_at_once() {
        // a few blocks' worth, and not a whole number of them, with the chain's compressors,
        // echo and reverb all working (they carry state from one block into the next)
        let dry = voice((1 << 16) * 3 + 12345);
        let fx = VocalFx::default();
        let whole = Chain::new(SR as f32, &fx).render(&dry);
        let r = hound::WavReader::new(Cursor::new(wav(mono(), &dry))).unwrap();
        let mut out = Cursor::new(vec![]);
        let spec2 = hound::WavSpec { channels: 2, ..mono() };
        let w = hound::WavWriter::new(&mut out, spec2).unwrap();
        let mut seen = vec![];
        let n = stream_wet(r, w, &mut Chain::new(SR as f32, &fx), |p| seen.push(p)).unwrap();
        assert_eq!(n, dry.len() as u64);
        let (spec, wet) = read_all(out.into_inner());
        assert_eq!(spec.channels, 2);
        assert_eq!(wet.len(), whole.len());
        assert!(wet.iter().zip(&whole).all(|(a, b)| a.to_bits() == b.to_bits()), "identical, sample for sample");
        assert_eq!(seen.len(), 4, "progress after every block");
        assert!(seen.windows(2).all(|w| w[1] > w[0]) && (seen[3] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_take_is_read_on_its_own_as_a_small_wav() {
        // a stereo file whose samples count up, so any wrong place shows
        let frames = 50_000usize;
        let data: Vec<f32> = (0..frames * 2).map(|i| i as f32).collect();
        let spec = hound::WavSpec { channels: 2, ..mono() };
        let bytes = wav(spec, &data);
        let r = hound::WavReader::new(Cursor::new(bytes.clone())).unwrap();
        let part = range_of(r, 10_000, 3_000).unwrap();
        assert!(part.len() < 3_000 * 8 + 100, "only the take, not the file: {} bytes", part.len());
        let (s, got) = read_all(part);
        assert_eq!((s.channels, s.sample_rate), (2, SR));
        assert_eq!(got.len(), 6_000);
        assert_eq!(got[0], 20_000.0, "starts at frame 10 000 (left)");
        assert_eq!(got[1], 20_001.0, "and its right");
        assert_eq!(*got.last().unwrap(), (13_000 * 2 - 1) as f32);
        // past the end it is cut short; wholly past the end there is nothing to read
        let r = hound::WavReader::new(Cursor::new(bytes.clone())).unwrap();
        let (_, tail) = read_all(range_of(r, 49_000, 5_000).unwrap());
        assert_eq!(tail.len(), 2_000);
        let r = hound::WavReader::new(Cursor::new(bytes)).unwrap();
        assert!(range_of(r, 60_000, 10).is_err());
    }

    #[test]
    fn a_take_that_begins_before_the_file_begins_with_silence_and_keeps_its_time() {
        // stereo again, counting up: 1 000 frames before the file, then its first 2 000
        let data: Vec<f32> = (0..20_000).map(|i| i as f32 + 1.0).collect();
        let bytes = wav(hound::WavSpec { channels: 2, ..mono() }, &data);
        let r = hound::WavReader::new(Cursor::new(bytes.clone())).unwrap();
        let (s, got) = read_all(range_of(r, -1_000, 3_000).unwrap());
        assert_eq!(s.channels, 2);
        assert_eq!(got.len(), 6_000, "as long as asked for");
        assert!(got[..2_000].iter().all(|v| *v == 0.0), "silence where the file had not begun");
        assert_eq!(got[2_000], 1.0, "then the file from its very first frame (left)");
        assert_eq!(got[2_001], 2.0, "and its right");
        assert_eq!(*got.last().unwrap(), 4_000.0);
        // a part wholly before the file is not there
        let r = hound::WavReader::new(Cursor::new(bytes)).unwrap();
        assert!(range_of(r, -5_000, 5_000).is_err());
    }

    #[test]
    fn a_take_is_read_from_a_file_on_disk() {
        let p = scratch("range.wav");
        std::fs::write(&p, wav(mono(), &(0..9_000).map(|i| i as f32).collect::<Vec<_>>())).unwrap();
        let (_, got) = read_all(read_range(&p, 1_000, 500).unwrap());
        assert_eq!(got.first().copied(), Some(1_000.0));
        assert_eq!(got.len(), 500);
        assert!(is_recording(&p) && !is_recording(Path::new("C:/secret.txt")));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn the_writer_stops_cleanly_at_the_size_limit_and_keeps_what_it_has() {
        let (mut p, cons) = rtrb::RingBuffer::<f32>::new(4096);
        for i in 0..1500 {
            p.push(i as f32).unwrap();
        }
        drop(p);
        let mut out = Cursor::new(vec![]);
        let st = Writing::default();
        let stop = AtomicBool::new(true);
        let w = hound::WavWriter::new(&mut out, mono()).unwrap();
        let (n, note) = write_voice(cons, w, &stop, &st, SR, 1000, || Some(123));
        assert_eq!(n, 1000);
        assert!(note.unwrap().contains("longest"));
        assert!(st.full.load(Ordering::Relaxed));
        assert_eq!(st.written.load(Ordering::Relaxed), 1000);
        assert_eq!(st.free.load(Ordering::Relaxed), 123, "the disk's room is reported");
        let (_, got) = read_all(out.into_inner());
        assert_eq!(got.len(), 1000, "a whole, readable file up to the limit");
        assert_eq!(got[999], 999.0);
    }

    #[test]
    fn a_pair_is_written_left_right_left_right_with_a_stereo_header() {
        // 1500 frames as the audio thread sends them (left counts up, right is the same below
        // zero), and one stray sample that no frame ever came to finish
        let fill = || {
            let (mut p, cons) = rtrb::RingBuffer::<f32>::new(4096);
            for i in 0..1500 {
                p.push(i as f32).unwrap();
                p.push(-(i as f32)).unwrap();
            }
            p.push(7.0).unwrap();
            cons
        };
        let stereo = hound::WavSpec { channels: 2, ..mono() };
        let mut out = Cursor::new(vec![]);
        let st = Writing::default();
        let (n, note) = write_voice(fill(), hound::WavWriter::new(&mut out, stereo).unwrap(), &AtomicBool::new(true), &st, SR, MAX_FRAMES, || None);
        assert_eq!((n, note), (1500, None), "counted in frames; the stray sample is not one");
        assert_eq!(st.written.load(Ordering::Relaxed), 1500);
        let bytes = out.into_inner();
        // the header: two channels, eight bytes a frame, and a length that is all of the frames
        assert_eq!((u16::from_le_bytes([bytes[22], bytes[23]]), u16::from_le_bytes([bytes[32], bytes[33]])), (2, 8));
        assert_eq!(&bytes[bytes.len() - 1500 * 8 - 8..bytes.len() - 1500 * 8 - 4], b"data");
        assert_eq!(u32::from_le_bytes(bytes[bytes.len() - 1500 * 8 - 4..bytes.len() - 1500 * 8].try_into().unwrap()), 1500 * 8);
        let mut r = hound::WavReader::new(Cursor::new(bytes)).unwrap();
        assert_eq!((r.spec().channels, r.spec().sample_rate, r.spec().bits_per_sample, r.duration()), (2, SR, 32, 1500));
        let got: Vec<f32> = r.samples::<f32>().map(|s| s.unwrap()).collect();
        assert!(got.chunks(2).enumerate().all(|(i, f)| f[0] == i as f32 && f[1] == -(i as f32)), "left, right, in order");
        // the size limit is in frames here too, and stops on a whole one
        let mut out = Cursor::new(vec![]);
        let st = Writing::default();
        let (n, note) = write_voice(fill(), hound::WavWriter::new(&mut out, stereo).unwrap(), &AtomicBool::new(true), &st, SR, 1000, || None);
        assert_eq!(n, 1000);
        assert!(note.unwrap().contains("longest") && st.full.load(Ordering::Relaxed));
        assert_eq!(st.written.load(Ordering::Relaxed), 1000);
        let (spec, got) = read_all(out.into_inner());
        assert_eq!((spec.channels, got.len()), (2, 2000), "a whole, readable file up to the limit");
        assert_eq!((got[1998], got[1999]), (999.0, -999.0));
    }

    #[test]
    fn a_pairs_second_file_is_the_pair_at_the_output_level_and_a_voice_still_goes_through_the_chain() {
        // a pair on disk: its left and right are different sounds
        let n = (1 << 16) + 777;
        let (a, b) = (voice(n), voice(n + 5000));
        let pair: Vec<f32> = (0..n).flat_map(|i| [a[i], -0.5 * b[i + 5000]]).collect();
        let dry = scratch("two.wav");
        std::fs::write(&dry, wav(hound::WavSpec { channels: 2, ..mono() }, &pair)).unwrap();
        // the default vocal sound (level 0 dB): the very same sound, though the chain is on
        let wet = render_wet(&dry, &VocalFx::default()).unwrap();
        assert!(wet.ends_with("two-wet-1.wav"));
        let (spec, got) = read_all(std::fs::read(&wet).unwrap());
        assert_eq!((spec.channels, spec.sample_rate, got.len()), (2, SR, pair.len()));
        assert!(got.iter().zip(&pair).all(|(x, y)| x.to_bits() == y.to_bits()), "left and right as recorded, sample for sample");
        // 6 dB down, chain on or off: both sides turned down by the same gain, and nothing else
        for on in [true, false] {
            let fx = VocalFx { level: -6.0, on, ..VocalFx::default() };
            let g = pair_gain(&fx);
            assert!((g - 0.5012).abs() < 1e-4, "{g}");
            let wet2 = render_wet(&dry, &fx).unwrap();
            assert!(wet2 != wet, "a new file each time, as for a voice");
            let (spec, got) = read_all(std::fs::read(&wet2).unwrap());
            assert_eq!((spec.channels, got.len()), (2, pair.len()));
            assert!(got.iter().zip(&pair).all(|(x, y)| *x == *y * g));
            let _ = std::fs::remove_file(wet2);
        }
        assert_eq!((pair_gain(&VocalFx { level: 40.0, ..VocalFx::default() }), pair_gain(&VocalFx { level: -90.0, ..VocalFx::default() })), (db_to_gain(12.0), db_to_gain(-24.0)), "within the knob's range");
        let _ = std::fs::remove_file(wet);
        let _ = std::fs::remove_file(dry);

        // one voice on disk (a mono file) goes through the chain, exactly as it always did
        let dry = scratch("one.wav");
        std::fs::write(&dry, wav(mono(), &a)).unwrap();
        let fx = VocalFx::default();
        let wet = render_wet(&dry, &fx).unwrap();
        let (spec, got) = read_all(std::fs::read(&wet).unwrap());
        let whole = Chain::new(SR as f32, &fx).render(&a);
        assert_eq!((spec.channels, got.len()), (2, whole.len()));
        assert!(got.iter().zip(&whole).all(|(x, y)| x.to_bits() == y.to_bits()), "the chain's own sound, sample for sample");
        assert!(got.iter().zip(a.iter().flat_map(|v| [v, v])).any(|(x, y)| x != y), "which is not the voice as sung");
        let _ = std::fs::remove_file(wet);
        let _ = std::fs::remove_file(dry);
    }

    #[test]
    fn a_take_of_a_pair_is_read_from_disk_with_both_sides_and_one_of_a_voice_with_one() {
        // frames 0, 1, 2 … on the left and the same below zero on the right
        let p = scratch("range-pair.wav");
        std::fs::write(&p, wav(hound::WavSpec { channels: 2, ..mono() }, &(0..9_000).flat_map(|i| [i as f32, -(i as f32)]).collect::<Vec<_>>())).unwrap();
        let (spec, got) = read_all(read_range(&p, 1_000, 500).unwrap());
        assert_eq!((spec.channels, spec.sample_rate, got.len()), (2, SR, 1_000));
        assert!(got.chunks(2).enumerate().all(|(i, f)| f[0] == (1_000 + i) as f32 && f[1] == -f[0]));
        // a take that begins before the file: silence on both sides first, then the file's first frame
        let (spec, got) = read_all(read_range(&p, -200, 500).unwrap());
        assert_eq!((spec.channels, got.len()), (2, 1_000));
        assert!(got[..400].iter().all(|v| *v == 0.0) && (got[402], got[403]) == (1.0, -1.0));
        let _ = std::fs::remove_file(p);
        // a voice: one channel
        let p = scratch("range-voice.wav");
        std::fs::write(&p, wav(mono(), &(0..9_000).map(|i| i as f32).collect::<Vec<_>>())).unwrap();
        let (spec, got) = read_all(read_range(&p, 1_000, 500).unwrap());
        assert_eq!((spec.channels, got.len(), got[0], got[499]), (1, 500, 1_000.0, 1_499.0));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn the_size_limit_keeps_both_files_under_4_gib() {
        // the dry file (mono) and the version through the chain (stereo), with their headers
        assert!(MAX_FRAMES * 8 + 1024 < u32::MAX as u64);
        assert!(MAX_FRAMES as f64 / 48000.0 / 3600.0 > 3.0, "about three hours at 48 kHz");
    }

    #[test]
    fn a_failed_render_leaves_no_half_made_file() {
        let dry = scratch("broken.wav");
        std::fs::write(&dry, b"not a wav").unwrap();
        assert!(render_wet(&dry, &VocalFx::default()).is_err());
        assert!(!dry.with_file_name("broken-wet-1.wav").exists());
        let _ = std::fs::remove_file(dry);
    }

    #[test]
    fn free_space_is_known() {
        #[cfg(any(unix, windows))]
        assert!(free_space(&std::env::temp_dir()).unwrap_or(0) > 0);
    }
}

//! Running the network with ONNX Runtime, gently.
//!
//! The runtime's library is opened only when a song is split (or the graphics card is tried),
//! from the copy the user downloaded, never at start-up: if it is missing or will not load, the
//! app runs exactly as before and the quick splits stay available.
//!
//! Splitting is heavy, steady work, and the live sound must never pay for it:
//! - it uses at most half the processor's threads, and always leaves two free;
//! - every thread it works on runs below normal priority, so the audio driver's thread and the
//!   app's own audio come first (the audio thread is in the "Pro Audio" class besides);
//! - its threads never spin while they wait for work, which would burn a core for nothing;
//! - while the engine records a take, it stops (the stretch under way is abandoned at once) and
//!   carries on when the take is over.
//!
//! On Windows, the graphics card is used through DirectML when it works; if it will not start,
//! or gives back silence for a stretch that is not silent, the processor takes over.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use ort::environment::{Environment, ThreadManager};
use ort::session::builder::{GraphOptimizationLevel, SessionBuilder};
use ort::session::{RunOptions, Session};
use ort::value::TensorRef;

use super::pipeline::{RunError, Separator};

/// How many threads splitting may use: half the processor's, never more than eight, and always
/// two left for the audio and the rest of the app.
pub fn threads() -> usize {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    (n / 2).min(n.saturating_sub(2)).clamp(1, 8)
}

/// Lower the calling thread's priority, so the audio always comes first.
pub fn lower_priority() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL};
        // SAFETY: changes only the priority of the calling thread, through its pseudo-handle
        unsafe {
            SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
        }
    }
    #[cfg(target_os = "linux")]
    {
        // SAFETY: on Linux, a thread id given to setpriority changes that thread alone
        unsafe {
            libc::setpriority(libc::PRIO_PROCESS, libc::gettid() as libc::id_t, 10);
        }
    }
}

/// Makes the runtime's worker threads, each at the lowered priority.
struct LowThreads;

impl ThreadManager for LowThreads {
    type Thread = std::thread::JoinHandle<()>;
    fn create(&self, work: impl FnOnce() + Send + 'static) -> ort::Result<Self::Thread> {
        std::thread::Builder::new()
            .name("stems-worker".into())
            .spawn(move || {
                lower_priority();
                work();
            })
            .map_err(|e| ort::Error::new(e.to_string()))
    }
    fn join(thread: Self::Thread) -> ort::Result<()> {
        let _ = thread.join();
        Ok(())
    }
}

/// The loaded runtime (once per run of the app: a library cannot be swapped once open).
static ENV: OnceLock<Result<Environment, String>> = OnceLock::new();
static LOADING: Mutex<()> = Mutex::new(());

/// ONNX Runtime for Windows is built against Microsoft's Visual C++ runtime, which is not part of
/// Windows (the app itself does not need it). Its library would not load without it, and with an
/// older one than it was built for (before 14.40, from 2024) it would crash the whole app, the
/// sound with it, the first time it locked a mutex. So the copy Windows would hand it is looked
/// at first: if it is missing or too old, the runtime is not touched, and the reason is shown.
/// (Nothing is loaded by the look, so once the user has installed the current one, the next try
/// works without a restart.)
#[cfg_attr(not(windows), allow(dead_code))]
const CRT_NEEDED: (u16, u16) = (14, 40);

/// What is wrong with the Visual C++ runtime, if anything (`version`: that of msvcp140.dll, None
/// if there is none).
#[cfg_attr(not(windows), allow(dead_code))]
fn crt_verdict(version: Option<(u16, u16, u16)>) -> Option<String> {
    let fix = "Install the latest Microsoft Visual C++ Redistributable (x64), then try again.";
    match version {
        None => Some(format!("ONNX Runtime needs Microsoft's Visual C++ Redistributable (x64), which this computer does not have. {fix}")),
        Some((a, b, c)) if (a, b) < CRT_NEEDED => Some(format!("ONNX Runtime needs a newer Microsoft Visual C++ Redistributable (x64): {}.{} or later; this computer has {a}.{b}.{c}. {fix}", CRT_NEEDED.0, CRT_NEEDED.1)),
        Some(_) => None,
    }
}

/// `crt_verdict` for this computer (on Windows; elsewhere nothing is needed).
pub fn crt_problem() -> Option<String> {
    #[cfg(windows)]
    {
        // the copy the runtime would get: one already loaded into the app (an audio driver can
        // bring its own), else where Windows looks, beside the app first, then its system folder
        let file = loaded_module("msvcp140.dll").or_else(|| {
            let beside = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf));
            let system = std::env::var_os("SystemRoot").map(|r| PathBuf::from(r).join("System32"));
            let dir = [beside, system].into_iter().flatten().find(|d| d.join("msvcp140.dll").exists())?;
            // the rest of the same redistributable, beside it
            ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140_1.dll"].iter().all(|f| dir.join(f).exists()).then(|| dir.join("msvcp140.dll"))
        });
        crt_verdict(file.and_then(|f| file_version(&f)))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Where the module `name` this process has already loaded comes from, if it has.
#[cfg(windows)]
fn loaded_module(name: &str) -> Option<PathBuf> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::System::LibraryLoader::{GetModuleFileNameW, GetModuleHandleW};
    let wide: Vec<u16> = std::ffi::OsStr::new(name).encode_wide().chain(Some(0)).collect();
    let mut buf = vec![0u16; 32_768];
    // SAFETY: the name is NUL-terminated; the handle is only looked up, never freed (no reference
    // is taken); the path is written into a buffer of the length given
    unsafe {
        let module = GetModuleHandleW(wide.as_ptr());
        if module.is_null() {
            return None;
        }
        let n = GetModuleFileNameW(module, buf.as_mut_ptr(), buf.len() as u32) as usize;
        (n > 0 && n < buf.len()).then(|| PathBuf::from(std::ffi::OsString::from_wide(&buf[..n])))
    }
}

/// A file's version (major, minor, build), from its version resource.
#[cfg(windows)]
fn file_version(path: &Path) -> Option<(u16, u16, u16)> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let root: [u16; 2] = [b'\\' as u16, 0];
    // SAFETY: the name and the sub-block are NUL-terminated; the buffer is as large as the size
    // asked for, and the pointer handed back points into it, checked for null and length
    unsafe {
        let size = GetFileVersionInfoSizeW(name.as_ptr(), std::ptr::null_mut());
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        if GetFileVersionInfoW(name.as_ptr(), 0, size, buf.as_mut_ptr().cast()) == 0 {
            return None;
        }
        let mut info: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        if VerQueryValueW(buf.as_ptr().cast(), root.as_ptr(), &mut info, &mut len) == 0 || info.is_null() || (len as usize) < std::mem::size_of::<VS_FIXEDFILEINFO>() {
            return None;
        }
        let f = std::ptr::read_unaligned(info as *const VS_FIXEDFILEINFO);
        Some(((f.dwFileVersionMS >> 16) as u16, (f.dwFileVersionMS & 0xffff) as u16, (f.dwFileVersionLS >> 16) as u16))
    }
}

/// Why the runtime would not load in this run of the app, if it would not.
pub fn load_failure() -> Option<String> {
    ENV.get().and_then(|r| r.as_ref().err().cloned())
}

/// Open the runtime from `dir` (where it was downloaded). The answer is kept: the library stays
/// loaded for the life of the app. A failure is kept too, so a broken copy is not tried over and
/// over; the user can download again and restart the app.
pub fn environment(dir: &Path, library: &str, preload: &[&str]) -> Result<Environment, String> {
    let _g = LOADING.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(r) = ENV.get() {
        return r.clone();
    }
    let lib = dir.join(library);
    if !lib.exists() {
        // not downloaded yet: nothing is remembered, so it can be loaded once it is
        return Err("ONNX Runtime has not been downloaded".into());
    }
    if let Some(why) = crt_problem() {
        // not remembered either: nothing has been loaded, so it can be once that is put right
        return Err(why);
    }
    let r = (|| {
        for p in preload {
            // its helpers first, from the same folder (Windows then uses this copy, not the older
            // one it may keep in its system folder). Only the graphics card needs them: if one
            // will not load, the processor still can do the work, so it is noted, not fatal.
            if let Err(e) = ort::util::preload_dylib(dir.join(p)) {
                block_gpu(format!("{p} could not be loaded ({e}); splitting uses the processor"));
            }
        }
        let b = ort::init_from(&lib).map_err(|e| format!("ONNX Runtime could not be loaded ({e}); restart the app to try again."))?;
        b.with_name("m-theory-stems").with_telemetry(false).build().map_err(|e| format!("ONNX Runtime would not start ({e}); restart the app to try again."))
    })();
    let _ = ENV.set(r.clone());
    r
}

/// Is the runtime already open in this run of the app?
pub fn loaded() -> bool {
    matches!(ENV.get(), Some(Ok(_)))
}

fn builder(env: &Environment, gpu: bool) -> Result<SessionBuilder, String> {
    let e = |e: ort::Error<SessionBuilder>| e.to_string();
    let mut b = Session::builder(env)
        .map_err(|e| e.to_string())?
        .with_no_environment_execution_providers()
        .map_err(e)?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(e)?
        .with_intra_threads(threads())
        .map_err(e)?
        .with_inter_threads(1)
        .map_err(e)?
        .with_intra_op_spinning(false)
        .map_err(e)?
        .with_inter_op_spinning(false)
        .map_err(e)?
        .with_flush_to_zero()
        .map_err(e)?
        .with_thread_manager(LowThreads)
        .map_err(e)?;
    if gpu {
        b = gpu_builder(b)?;
    }
    Ok(b)
}

#[cfg(windows)]
fn gpu_builder(b: SessionBuilder) -> Result<SessionBuilder, String> {
    let e = |e: ort::Error<SessionBuilder>| e.to_string();
    // DirectML cannot share memory plans between runs, nor run parts of the graph side by side
    b.with_memory_pattern(false)
        .map_err(e)?
        .with_parallel_execution(false)
        .map_err(e)?
        .with_execution_providers([ort::ep::DirectML::default().build().error_on_failure()])
        .map_err(e)
}

#[cfg(not(windows))]
fn gpu_builder(_b: SessionBuilder) -> Result<SessionBuilder, String> {
    Err("No graphics-card path on this computer".into())
}

/// The graphics card's state, as found the last time it was tried (None: not tried yet).
static GPU: Mutex<Option<Result<(), String>>> = Mutex::new(None);
/// Why the graphics card must not be tried at all in this run of the app (its helper library
/// would not load: the runtime would then reach for whatever older copy Windows keeps).
static GPU_BLOCKED: OnceLock<String> = OnceLock::new();

pub fn gpu_state() -> Option<Result<(), String>> {
    if let Some(why) = GPU_BLOCKED.get() {
        return Some(Err(why.clone()));
    }
    GPU.lock().ok().and_then(|g| g.clone())
}
fn set_gpu(r: Result<(), String>) {
    if let Ok(mut g) = GPU.lock() {
        *g = Some(r);
    }
}
fn block_gpu(why: String) {
    let _ = GPU_BLOCKED.set(why);
}

/// Try the graphics card with a tiny network, once the runtime is here. Cheap (well under a
/// second), and done when the runtime has just been downloaded, so the page can say at once
/// whether splitting will use it.
pub fn probe_gpu(env: &Environment) -> Option<Result<(), String>> {
    if !cfg!(windows) {
        return None;
    }
    if let Some(why) = GPU_BLOCKED.get() {
        return Some(Err(why.clone()));
    }
    let bytes = onnx::scaled_copies(&[1.0], Some(64));
    let r = (|| -> Result<(), String> {
        let mut s = builder(env, true)?.commit_from_memory(&bytes).map_err(|e| e.to_string())?;
        let x = vec![0.25f32; 128];
        let t = TensorRef::from_array_view(([1usize, 2, 64], &x[..])).map_err(|e| e.to_string())?;
        let out = s.run(ort::inputs![t]).map_err(|e| e.to_string())?;
        let (_, y) = out[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        if y.iter().all(|v| (v - 0.25).abs() < 1e-3) {
            Ok(())
        } else {
            Err("The graphics card gave wrong numbers".into())
        }
    })();
    set_gpu(r.clone());
    Some(r)
}

/// The network, run by ONNX Runtime, as the pipeline wants it.
pub struct OrtSeparator {
    env: Environment,
    model: PathBuf,
    session: Session,
    input: String,
    stems: usize,
    seg: usize,
    pub gpu: bool,
    first: bool,
    pub stop: Arc<RunOptions>,
}

impl OrtSeparator {
    /// Open the model, on the graphics card if it works (and `try_gpu`), else on the processor.
    /// `stems` and `segment` are what the model is known to make and take; the file's own
    /// description wins where it gives them.
    pub fn open(env: &Environment, model: &Path, stems: usize, segment: usize, try_gpu: bool) -> Result<Self, String> {
        let mut gpu = false;
        let mut session = None;
        if try_gpu && cfg!(windows) && !matches!(gpu_state(), Some(Err(_))) {
            match builder(env, true).and_then(|mut b| b.commit_from_file(model).map_err(|e| e.to_string())) {
                Ok(s) => {
                    session = Some(s);
                    gpu = true;
                }
                Err(e) => set_gpu(Err(e)),
            }
        }
        let session = match session {
            Some(s) => s,
            None => builder(env, false)?.commit_from_file(model).map_err(|e| format!("The model could not be opened ({e})"))?,
        };
        let (input, seg, stems) = shape_of(&session, stems, segment)?;
        Ok(OrtSeparator { env: env.clone(), model: model.to_path_buf(), session, input, stems, seg, gpu, first: true, stop: Arc::new(RunOptions::new().map_err(|e| e.to_string())?) })
    }

    pub fn provider(&self) -> &'static str {
        if self.gpu {
            "DirectML"
        } else {
            "CPU"
        }
    }

    /// Leave the graphics card for the processor (it failed or gave silence).
    fn fall_back(&mut self, why: String) -> Result<(), RunError> {
        set_gpu(Err(why));
        self.session = builder(&self.env, false).and_then(|mut b| b.commit_from_file(&self.model).map_err(|e| e.to_string())).map_err(RunError::Failed)?;
        self.gpu = false;
        Ok(())
    }

    pub(super) fn run_once(&mut self, mix: &[f32], out: &mut Vec<f32>) -> Result<(), RunError> {
        let t = TensorRef::from_array_view(([1usize, 2, self.seg], mix)).map_err(|e| RunError::Failed(e.to_string()))?;
        let stop = self.stop.clone();
        let outputs = match self.session.run_with_options(ort::inputs![self.input.as_str() => t], &stop) {
            Ok(o) => o,
            Err(e) => {
                let msg = e.to_string();
                // stopped from outside: not a failure
                if msg.contains("terminate") {
                    return Err(RunError::Interrupted);
                }
                return Err(RunError::Failed(msg));
            }
        };
        let (shape, data) = outputs[0].try_extract_tensor::<f32>().map_err(|e| RunError::Failed(e.to_string()))?;
        if data.len() != self.stems * 2 * self.seg {
            return Err(RunError::Failed(format!("The model gave back {shape:?}, not {} stems of {} samples", self.stems, self.seg)));
        }
        out.clear();
        out.extend_from_slice(data);
        Ok(())
    }
}

impl Separator for OrtSeparator {
    fn stems(&self) -> usize {
        self.stems
    }
    fn segment(&self) -> usize {
        self.seg
    }
    fn run(&mut self, mix: &[f32], out: &mut Vec<f32>) -> Result<(), RunError> {
        // a stop left over from a take that has finished is cleared first
        let _ = self.stop.unterminate();
        match self.run_once(mix, out) {
            Err(RunError::Failed(e)) if self.gpu => {
                self.fall_back(e)?;
                self.run_once(mix, out)
            }
            Ok(()) if self.gpu && self.first => {
                // some graphics drivers give back silence or nonsense: the first stretch with
                // sound in it is checked (a quiet intro tells nothing)
                let loud = mix.iter().map(|v| v.abs()).fold(0.0f32, f32::max) > 1e-3;
                let broken = out.iter().any(|v| !v.is_finite());
                let silent = loud && out.iter().all(|v| v.abs() < 1e-7);
                if broken || silent {
                    self.first = false;
                    self.fall_back(if broken { "The graphics card gave back nonsense" } else { "The graphics card gave back silence" }.into())?;
                    return self.run_once(mix, out);
                }
                if loud {
                    self.first = false;
                    set_gpu(Ok(()));
                }
                Ok(())
            }
            r => r,
        }
    }
}

/// The input's name, the stretch length and the stem count, from the model's own description
/// where it gives them (a fixed size), else from what the model is known to be.
fn shape_of(s: &Session, stems: usize, segment: usize) -> Result<(String, usize, usize), String> {
    let input = s.inputs().first().ok_or("The model takes no input")?;
    let output = s.outputs().first().ok_or("The model gives no output")?;
    let dims = |t: &ort::value::ValueType| -> Vec<i64> {
        match t {
            ort::value::ValueType::Tensor { shape, .. } => shape.iter().copied().collect(),
            _ => vec![],
        }
    };
    let i = dims(input.dtype());
    let o = dims(output.dtype());
    if i.len() != 3 || (i[1] > 0 && i[1] != 2) {
        return Err(format!("The model takes {i:?}, not a stereo stretch"));
    }
    let seg = if i[2] > 0 { i[2] as usize } else { segment };
    let stems = if o.len() == 4 && o[1] > 0 { o[1] as usize } else { stems };
    Ok((input.name().to_string(), seg, stems))
}

/// Keeps an eye on a split while the network works: stops the stretch under way at once when
/// the split is cancelled or the engine starts recording (the pipeline then waits, or ends).
pub struct Watch {
    done: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Watch {
    pub fn start(stop: Arc<RunOptions>, cancel: Arc<AtomicBool>, busy: fn() -> bool) -> Self {
        let done = Arc::new(AtomicBool::new(false));
        let d = done.clone();
        let thread = std::thread::Builder::new()
            .name("stems-watch".into())
            .spawn(move || {
                while !d.load(Ordering::Relaxed) {
                    if cancel.load(Ordering::Relaxed) || busy() {
                        let _ = stop.terminate();
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            })
            .ok();
        Watch { done, thread }
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Tiny ONNX models written by hand (the format is protocol buffers), for trying the graphics
/// card and for the tests: no model file has to ship or be downloaded for either.
pub mod onnx {
    fn varint(out: &mut Vec<u8>, mut v: u64) {
        loop {
            let b = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                return;
            }
            out.push(b | 0x80);
        }
    }
    fn key(out: &mut Vec<u8>, field: u64, wire: u64) {
        varint(out, (field << 3) | wire);
    }
    fn int(out: &mut Vec<u8>, field: u64, v: i64) {
        key(out, field, 0);
        varint(out, v as u64);
    }
    fn bytes(out: &mut Vec<u8>, field: u64, b: &[u8]) {
        key(out, field, 2);
        varint(out, b.len() as u64);
        out.extend_from_slice(b);
    }
    /// A float tensor's type: each dimension a size, or (None) a named, free one.
    fn value_info(name: &str, dims: &[Option<i64>]) -> Vec<u8> {
        let mut shape = vec![];
        for (i, d) in dims.iter().enumerate() {
            let mut dim = vec![];
            match d {
                Some(v) => int(&mut dim, 1, *v),
                None => bytes(&mut dim, 2, format!("d{i}").as_bytes()),
            }
            bytes(&mut shape, 1, &dim);
        }
        let mut tensor = vec![];
        int(&mut tensor, 1, 1); // FLOAT
        bytes(&mut tensor, 2, &shape);
        let mut ty = vec![];
        bytes(&mut ty, 1, &tensor);
        let mut vi = vec![];
        bytes(&mut vi, 1, name.as_bytes());
        bytes(&mut vi, 2, &ty);
        vi
    }
    fn initializer(name: &str, dims: &[i64], data_type: i64, raw: &[u8]) -> Vec<u8> {
        let mut t = vec![];
        for d in dims {
            int(&mut t, 1, *d);
        }
        int(&mut t, 2, data_type);
        bytes(&mut t, 8, name.as_bytes());
        bytes(&mut t, 9, raw);
        t
    }
    fn node(inputs: &[&str], outputs: &[&str], op: &str) -> Vec<u8> {
        let mut n = vec![];
        for i in inputs {
            bytes(&mut n, 1, i.as_bytes());
        }
        for o in outputs {
            bytes(&mut n, 2, o.as_bytes());
        }
        bytes(&mut n, 4, op.as_bytes());
        n
    }

    /// A stand-in for Demucs with its exact interface: "mix" [1, 2, T] in, "stems" [1, S, 2, T]
    /// out, each stem being the mix times its share. With shares that add up to one, the stems
    /// add up to the mix. `t`: a fixed stretch length, or None for a free one.
    pub fn scaled_copies(shares: &[f32], t: Option<i64>) -> Vec<u8> {
        let s = shares.len() as i64;
        let mut g = vec![];
        bytes(&mut g, 1, &node(&["mix", "axes"], &["one"], "Unsqueeze"));
        bytes(&mut g, 1, &node(&["one", "shares"], &["stems"], "Mul"));
        bytes(&mut g, 2, b"stand-in");
        bytes(&mut g, 5, &initializer("axes", &[1], 7, &1i64.to_le_bytes()));
        let raw: Vec<u8> = shares.iter().flat_map(|v| v.to_le_bytes()).collect();
        bytes(&mut g, 5, &initializer("shares", &[1, s, 1, 1], 1, &raw));
        bytes(&mut g, 11, &value_info("mix", &[Some(1), Some(2), t]));
        bytes(&mut g, 12, &value_info("stems", &[Some(1), Some(s), Some(2), t]));
        let mut opset = vec![];
        int(&mut opset, 2, 13);
        let mut m = vec![];
        int(&mut m, 1, 8); // IR version 8 (ONNX 1.10 and later)
        bytes(&mut m, 2, b"m-theory");
        bytes(&mut m, 7, &g);
        bytes(&mut m, 8, &opset);
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitting_always_leaves_threads_for_the_audio() {
        let t = threads();
        let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
        assert!((1..=8).contains(&t));
        assert!(t <= (n / 2).max(1));
        assert!(n <= 2 || t <= n - 2);
    }

    #[test]
    fn the_visual_cpp_runtime_must_be_there_and_new_enough() {
        assert!(crt_verdict(None).unwrap().contains("does not have"));
        // the one from before 2024's change to how a mutex starts: the runtime would crash on it
        let old = crt_verdict(Some((14, 38, 33135))).unwrap();
        assert!(old.contains("14.40 or later") && old.contains("14.38.33135"), "{old}");
        assert!(crt_verdict(Some((14, 40, 33810))).is_none());
        assert!(crt_verdict(Some((14, 44, 35211))).is_none());
        assert!(crt_verdict(Some((15, 0, 0))).is_none());
        if !cfg!(windows) {
            assert!(crt_problem().is_none(), "only Windows needs it");
        }
    }

    #[test]
    fn the_stand_in_model_is_well_formed() {
        let m = onnx::scaled_copies(&[0.25, 0.75], Some(10));
        // starts with the IR version field, holds the names it should
        assert_eq!(&m[..2], &[0x08, 0x08]);
        for name in ["mix", "stems", "Unsqueeze", "Mul", "shares"] {
            assert!(m.windows(name.len()).any(|w| w == name.as_bytes()), "{name}");
        }
    }
}

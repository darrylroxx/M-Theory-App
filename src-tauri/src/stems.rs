//! Stems: a song the user opens, split on their own computer into vocals, drums, bass and the
//! rest (and, with the six-stem model, guitar and piano), so the Canvas can paint each layer
//! from its own sound.
//!
//! The splitting is done by Demucs v4, a neural network, run by ONNX Runtime. Neither ships with
//! the app: both are downloaded once, when the user asks (`stems_prepare`), checked against their
//! SHA-256 and kept in the app's local data folder (see `stems/fetch.rs` for where they come
//! from). Until then, or if that fails, nothing changes: the Canvas keeps its quick splits.
//!
//! A split (`stems_split`) runs on a thread of its own, below normal priority, and never while
//! the engine is recording a take (see `stems/runtime.rs`). It works through the song in stretches
//! of 7.8 seconds, from the start, and reports after each one how far every stem is ready, so the
//! Canvas can begin painting from the stems long before the whole song is done. The stems are
//! kept in the app's cache folder as float WAV files, one folder per song and model, named by the
//! song file's SHA-256: the same song opened again is not split again. They are read back a part
//! at a time with `stems_read`.

mod fetch;
mod pipeline;
mod runtime;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::Manager;

use fetch::{ModelDef, Provenance, MODELS, RUNTIME};
use pipeline::{Controls, Event, Separator, Stop};

/// Changes whenever stems made by an older version would differ: those are made again.
const PIPELINE: u32 = 1;
/// The stems of the songs split last are kept up to about this much disk space (about ten
/// four-minute songs); older ones are deleted when a new song is split.
const CACHE_LIMIT: u64 = 4 << 30;
/// The longest part of a stem `stems_read` hands over in one go (frames): about 3 minutes at 48 kHz.
const READ_MAX: u64 = 1 << 23;

// ── where things are kept ──

// The local (not roaming) data folder: a 150 MB model should not follow a user from computer to
// computer. On Windows the app's cache and local data folders are one and the same, so the two
// get folders of their own: clearing the stems must never touch the model.
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("stems-model"))
}
fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("stems-cache"))
}

/// Is this the name of a song's stems folder (see `cache_key`)? Nothing else in the cache
/// folder is ever cleared away.
fn is_song_dir(name: &str) -> bool {
    match name.split_once('-') {
        Some((sha, model)) => sha.len() == 32 && sha.bytes().all(|b| b.is_ascii_hexdigit()) && fetch::model(model).is_some(),
        None => false,
    }
}
fn runtime_dir(data: &Path) -> Option<PathBuf> {
    RUNTIME.as_ref().map(|r| data.join("runtime").join(r.version))
}
fn model_path(data: &Path, m: &ModelDef) -> PathBuf {
    data.join("models").join(m.id).join(m.file)
}
fn provenance_path(file: &Path) -> PathBuf {
    let mut s = file.as_os_str().to_owned();
    s.push(".json");
    PathBuf::from(s)
}

/// The runtime is here if every file taken from its package is.
fn runtime_present(data: &Path) -> bool {
    match (RUNTIME.as_ref(), runtime_dir(data)) {
        (Some(r), Some(d)) => r.files.iter().all(|(_, name)| d.join(name).exists()),
        _ => false,
    }
}

/// A model is here if its file is, with the record of how it was checked.
fn model_present(data: &Path, m: &ModelDef) -> Option<Provenance> {
    let p = model_path(data, m);
    let prov = Provenance::read(&provenance_path(&p))?;
    (fs::metadata(&p).ok()?.len() == prov.bytes).then_some(prov)
}

/// Clear away what older versions of the app left in the data folder: a runtime of another
/// version (and its package), a model no longer offered, a half-downloaded file under an old
/// name. Only names this app made are looked at, and never the runtime or models in use.
fn tidy(data: &Path) {
    let gone = |p: &Path| {
        let _ = if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) };
    };
    if let (Some(rt), Ok(rd)) = (RUNTIME.as_ref(), fs::read_dir(data.join("runtime"))) {
        let package = format!("onnxruntime-{}.whl", rt.version);
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let ours = name.starts_with("onnxruntime-") || name.chars().next().is_some_and(|c| c.is_ascii_digit());
            if ours && name != rt.version && !name.starts_with(&package) {
                gone(&e.path());
            }
        }
        // a file half-unpacked when the app was closed (see `fetch::unzip`)
        for e in fs::read_dir(data.join("runtime").join(rt.version)).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().ends_with(".tmp") {
                gone(&e.path());
            }
        }
    }
    if let Ok(rd) = fs::read_dir(data.join("models")) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            match fetch::model(&name) {
                None => gone(&e.path()),
                Some(m) => {
                    for f in fs::read_dir(e.path()).into_iter().flatten().flatten() {
                        if !f.file_name().to_string_lossy().starts_with(m.file) {
                            gone(&f.path());
                        }
                    }
                }
            }
        }
    }
}

// ── what is going on ──

struct Jobs {
    /// splits under way (and downloads), by the id the page gave them, with their cancel flags
    running: Vec<(String, Arc<AtomicBool>)>,
    /// the songs' cache folders in use, which are never cleared away
    keys: Vec<String>,
    preparing: Option<String>,
}
static JOBS: Mutex<Jobs> = Mutex::new(Jobs { running: Vec::new(), keys: Vec::new(), preparing: None });
/// One split at a time: two would only share the same processor and both be slower.
static WORKER: Mutex<()> = Mutex::new(());

fn jobs() -> std::sync::MutexGuard<'static, Jobs> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Takes a job off the list when it ends, however it ends.
struct Registered {
    id: String,
    key: Option<String>,
}
impl Drop for Registered {
    fn drop(&mut self) {
        let mut j = jobs();
        j.running.retain(|(k, _)| k != &self.id);
        if let Some(k) = &self.key {
            if let Some(i) = j.keys.iter().position(|x| x == k) {
                j.keys.remove(i);
            }
        }
        if j.preparing.as_deref() == Some(self.id.as_str()) {
            j.preparing = None;
        }
    }
}

fn register(id: &str) -> Result<(Registered, Arc<AtomicBool>), String> {
    let mut j = jobs();
    if j.running.iter().any(|(k, _)| k == id) {
        return Err("That job is already running".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    j.running.push((id.to_string(), flag.clone()));
    Ok((Registered { id: id.to_string(), key: None }, flag))
}

// ── status ──

#[derive(Serialize, Clone)]
pub struct ModelStatus {
    pub id: String,
    pub name: String,
    pub stems: Vec<String>,
    pub present: bool,
    /// bytes on disk if present, else about how many will be downloaded
    pub bytes: u64,
    pub source: String,
    pub page: String,
    pub licence: String,
    /// the SHA-256 the file was checked against, and whether that was this app's own ("pinned")
    /// or the one the host stated ("host")
    pub sha256: Option<String>,
    pub checked_against: Option<String>,
    pub revision: Option<String>,
    /// why the model would not open when a split last tried, in this run of the app (None: it
    /// opened, or has not been tried). Downloading it again (`stems_prepare`) replaces it.
    pub error: Option<String>,
}

/// The models that would not open (by id, with why), in this run of the app.
static MODEL_ERRORS: Mutex<Vec<(&'static str, String)>> = Mutex::new(Vec::new());

fn model_error(id: &str) -> Option<String> {
    MODEL_ERRORS.lock().ok()?.iter().find(|(k, _)| *k == id).map(|(_, e)| e.clone())
}
fn set_model_error(id: &'static str, e: Option<String>) {
    if let Ok(mut g) = MODEL_ERRORS.lock() {
        g.retain(|(k, _)| *k != id);
        if let Some(e) = e {
            g.push((id, e));
        }
    }
}

#[derive(Serialize, Clone)]
pub struct RuntimeStatus {
    pub present: bool,
    pub loaded: bool,
    pub version: Option<String>,
    pub source: Option<String>,
    /// bytes to download
    pub bytes: u64,
    pub licence: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GpuStatus {
    /// the graphics-card path this computer's runtime has ("DirectML" on Windows)
    pub provider: Option<String>,
    /// whether it worked when last tried (null: not tried yet)
    pub usable: Option<bool>,
    pub note: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct Status {
    /// can this computer split with the neural model at all?
    pub available: bool,
    pub reason: Option<String>,
    pub models: Vec<ModelStatus>,
    pub runtime: RuntimeStatus,
    pub gpu: GpuStatus,
    pub preparing: bool,
    pub splitting: Vec<String>,
    pub cache_bytes: u64,
    pub cache_dir: String,
    pub threads: usize,
}

fn status(app: &tauri::AppHandle) -> Result<Status, String> {
    let data = data_dir(app)?;
    let cache = cache_dir(app)?;
    let models = MODELS
        .iter()
        .map(|m| {
            let prov = model_present(&data, m);
            ModelStatus {
                id: m.id.into(),
                name: m.name.into(),
                stems: m.stems.iter().map(|s| s.to_string()).collect(),
                present: prov.is_some(),
                bytes: prov.as_ref().map(|p| p.bytes).unwrap_or(m.approx_bytes),
                source: prov.as_ref().map(|p| p.url.clone()).unwrap_or_else(|| m.urls[0].to_string()),
                page: m.page.into(),
                licence: m.licence.into(),
                sha256: prov.as_ref().map(|p| p.sha256.clone()).or(m.sha256.map(str::to_string)),
                checked_against: prov.as_ref().map(|p| p.checked_against.clone()),
                revision: prov.and_then(|p| p.revision),
                error: model_error(m.id),
            }
        })
        .collect();
    let rt = RUNTIME.as_ref();
    // why splitting cannot run in this run of the app: the runtime would not load (kept until a
    // restart), or Windows lacks what it needs (looked at afresh each time, so installing it is
    // seen at once, and before anything is downloaded)
    let load_error = match (runtime::loaded(), rt) {
        (true, _) | (_, None) => None,
        (false, Some(_)) => runtime::load_failure().or_else(runtime::crt_problem),
    };
    // walked before the job list is looked at: a big cache takes a moment, and `stems_cancel`
    // must never wait for it
    let cache_bytes = fetch::dir_size(&cache);
    let gpu = match rt.and_then(|r| r.gpu) {
        Some(name) => {
            let state = runtime::gpu_state();
            GpuStatus { provider: Some(name.into()), usable: state.as_ref().map(|s| s.is_ok()), note: state.and_then(|s| s.err()) }
        }
        None => GpuStatus { provider: None, usable: None, note: Some("Splitting runs on the processor here".into()) },
    };
    let j = jobs();
    Ok(Status {
        // a runtime that would not load stays that way until the app is restarted (a library
        // cannot be loaded twice), so until then the quick splits are what there is
        available: rt.is_some() && load_error.is_none(),
        reason: if rt.is_none() { Some("Neural stems need the Windows app on a 64-bit PC".to_string()) } else { load_error.clone() },
        models,
        runtime: RuntimeStatus {
            present: runtime_present(&data),
            loaded: runtime::loaded(),
            version: rt.map(|r| r.version.into()),
            source: rt.map(|r| r.url.into()),
            bytes: rt.map(|r| r.bytes).unwrap_or(0),
            licence: rt.map(|r| r.licence.into()),
            error: load_error,
        },
        gpu,
        preparing: j.preparing.is_some(),
        splitting: j.running.iter().map(|(k, _)| k).filter(|k| j.preparing.as_deref() != Some(k.as_str())).cloned().collect(),
        cache_bytes,
        cache_dir: cache.to_string_lossy().into(),
        threads: runtime::threads(),
    })
}

/// Open the runtime (once; `runtime::environment` keeps why, if it will not load).
fn environment(data: &Path) -> Result<ort::environment::Environment, String> {
    let rt = RUNTIME.as_ref().ok_or("Neural stems need the Windows app on a 64-bit PC")?;
    let dir = runtime_dir(data).ok_or("No runtime for this computer")?;
    runtime::environment(&dir, rt.library, rt.preload)
}

/// Whether the model and its runtime are here, their sizes and where they came from, whether
/// the graphics card can be used, and how much the kept stems take.
#[tauri::command]
pub async fn stems_status(app: tauri::AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || status(&app)).await.map_err(|e| e.to_string())?
}

// ── downloading ──

#[derive(Serialize, Clone)]
pub struct PrepareEvent {
    /// "runtime", "model" or "gpu"
    pub part: &'static str,
    /// "download", "check", "unpack", "try" or "done"
    pub step: &'static str,
    pub done: u64,
    pub total: Option<u64>,
}

/// Download what splitting needs (the runtime, then the model `model`, by default the four-stem
/// one), each checked, with progress on `progress`. Can be cancelled with `stems_cancel(id)`; a
/// download stopped half-way goes on from there next time. Nothing already here is fetched again.
#[tauri::command]
pub async fn stems_prepare(app: tauri::AppHandle, id: String, model: Option<String>, progress: Channel<PrepareEvent>) -> Result<Status, String> {
    let rt = RUNTIME.as_ref().ok_or("Neural stems need the Windows app on a 64-bit PC")?;
    let m = fetch::model(model.as_deref().unwrap_or(MODELS[0].id)).ok_or("No such model")?;
    // nothing is downloaded that could not be used on this computer
    if let Some(why) = tauri::async_runtime::spawn_blocking(runtime::crt_problem).await.map_err(|e| e.to_string())? {
        return Err(why);
    }
    let (reg, cancel) = register(&id)?;
    {
        let mut j = jobs();
        if j.preparing.is_some() {
            return Err("A download is already under way".into());
        }
        j.preparing = Some(id.clone());
    }
    let data = data_dir(&app)?;
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let d = data.clone();
    tauri::async_runtime::spawn_blocking(move || tidy(&d)).await.map_err(|e| e.to_string())?;
    // a runtime already open in this run is in use, whatever happened to its files since
    let runtime_needed = !runtime_present(&data) && !runtime::loaded();
    // a model that would not open is fetched again (a copy damaged on the disk is replaced)
    let model_needed = model_present(&data, m).is_none() || model_error(m.id).is_some();
    let need = (if runtime_needed { rt.bytes * 3 } else { 0 }) + if model_needed { m.approx_bytes + m.approx_bytes / 5 } else { 0 };
    if let Some(free) = crate::recfile::free_space(&data) {
        if free < need {
            return Err(format!("Not enough room on the disk: {} MB are needed, {} MB are free", need >> 20, free >> 20));
        }
    }
    let send = |part: &'static str, step: &'static str, done: u64, total: Option<u64>| {
        let _ = progress.send(PrepareEvent { part, step, done, total });
    };
    // the last report of a download comes when all of it is here: then it is being checked
    let step = |g: fetch::Got| if g.total == Some(g.done) { "check" } else { "download" };
    let client = fetch::client()?;

    if runtime_needed {
        let dir = runtime_dir(&data).ok_or("No runtime for this computer")?;
        let wheel = data.join("runtime").join(format!("onnxruntime-{}.whl", rt.version));
        fetch::download(&client, &fetch::PUBLIC, rt.url, &wheel, Some(rt.sha256), Some(rt.bytes), &cancel, |g| send("runtime", step(g), g.done, g.total)).await?;
        send("runtime", "unpack", 0, None);
        let (w, d) = (wheel.clone(), dir.clone());
        tauri::async_runtime::spawn_blocking(move || fetch::unzip(&w, rt.files, &d)).await.map_err(|e| e.to_string())??;
        Provenance { url: rt.url.into(), sha256: rt.sha256.into(), bytes: rt.bytes, checked_against: "pinned".into(), revision: None, fetched: fetch::now() }.write(&dir.join("runtime.json"))?;
        let _ = fs::remove_file(&wheel);
        send("runtime", "done", rt.bytes, Some(rt.bytes));
    }

    if model_needed {
        let dest = model_path(&data, m);
        let _ = fs::remove_file(provenance_path(&dest));
        let mut last = String::new();
        let mut got = None;
        for url in m.urls {
            match fetch::download(&client, &fetch::PUBLIC, url, &dest, m.sha256, Some(m.approx_bytes), &cancel, |g| send("model", step(g), g.done, g.total)).await {
                Ok(f) => {
                    got = Some((url, f));
                    break;
                }
                Err(e) if e == "cancelled" => return Err(e),
                Err(e) => last = e,
            }
        }
        let (url, f) = got.ok_or(last)?;
        Provenance { url: url.to_string(), sha256: f.sha256, bytes: f.bytes, checked_against: f.checked_against.into(), revision: f.revision, fetched: fetch::now() }.write(&provenance_path(&dest))?;
        set_model_error(m.id, None);
        send("model", "done", f.bytes, Some(f.bytes));
    }

    // open the runtime now (so a problem shows here, not half-way into a song), and try the graphics card
    send("gpu", "try", 0, None);
    let d = data.clone();
    tauri::async_runtime::spawn_blocking(move || environment(&d).map(|env| runtime::probe_gpu(&env))).await.map_err(|e| e.to_string())??;
    send("gpu", "done", 0, None);
    drop(reg);
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || status(&a)).await.map_err(|e| e.to_string())?
}

/// Stop a split or a download (by the id the page gave it). False if there is no such job.
/// (Async, like every command here, so it never runs on the window's own thread.)
#[tauri::command]
pub async fn stems_cancel(id: String) -> bool {
    cancel_job(&id)
}

fn cancel_job(id: &str) -> bool {
    match jobs().running.iter().find(|(k, _)| k == id) {
        Some((_, flag)) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

// ── splitting ──

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct StemFile {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SplitEvent {
    /// another song is being split first
    Queued,
    /// the model is being opened (a few seconds; longer the first time on a graphics card)
    Loading,
    /// the stems are being written here; each can be read from its start up to the `ready` of
    /// the latest progress
    Started { key: String, stems: Vec<StemFile>, rate: u32, seconds: Option<f64>, provider: String, cached: bool },
    /// stretch `done` of about `total` is finished; every stem holds its first `ready_frames`
    /// frames (`ready` seconds). `speed`: seconds of music per second of work so far.
    Progress { done: u64, total: u64, ready_frames: u64, ready: f64, speed: f64, eta: Option<f64> },
    /// waiting while the engine records a take
    Paused { reason: String },
    Resumed,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Separated {
    pub id: String,
    pub key: String,
    pub model: String,
    pub stems: Vec<StemFile>,
    /// the song's sample rate; every stem is stereo, 32-bit float, at this rate
    pub rate: u32,
    pub frames: u64,
    pub seconds: f64,
    /// "DirectML", "CPU", or how it was made when it comes from the cache
    pub provider: String,
    pub cached: bool,
    /// seconds the split took (0 from the cache)
    pub took: f64,
}

/// What is kept with a song's stems once they are all made (its absence means "not finished").
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Made {
    pipeline: u32,
    model: String,
    /// the SHA-256 of the model file that made them: a model downloaded again in another version
    /// makes them again
    model_sha256: String,
    stems: Vec<StemFile>,
    rate: u32,
    frames: u64,
    provider: String,
    made: u64,
}

/// The name of a song's stems folder: the song file's SHA-256 (so the same song is found again
/// under any name) and the model.
fn cache_key(file_sha: &str, model: &str) -> String {
    format!("{}-{model}", &file_sha[..32.min(file_sha.len())])
}

/// The stems kept in `dir`, if they were all made, by this version of the pipeline and (when the
/// model is here to compare with) by the model file there is now.
fn finished(dir: &Path, model_sha256: Option<&str>) -> Option<Made> {
    let made: Made = serde_json::from_slice(&fs::read(dir.join("done.json")).ok()?).ok()?;
    let same_model = model_sha256.is_none_or(|m| m.eq_ignore_ascii_case(&made.model_sha256));
    (made.pipeline == PIPELINE && same_model && made.stems.iter().all(|s| Path::new(&s.path).exists())).then_some(made)
}

/// Make room for a new song's stems: the oldest finished songs go first (never one in use, nor
/// the uploads folder), and folders left half-made by a crash go at once.
fn evict(cache: &Path, need: u64, in_use: &[String]) {
    let Ok(rd) = fs::read_dir(cache) else { return };
    let mut songs = vec![];
    let mut total = 0u64;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !is_song_dir(&name) || !e.path().is_dir() || in_use.contains(&name) {
            continue;
        }
        let size = fetch::dir_size(&e.path());
        match fs::metadata(e.path().join("done.json")).and_then(|m| m.modified()) {
            Ok(t) => {
                total += size;
                songs.push((t, e.path(), size));
            }
            Err(_) => {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
    songs.sort_by_key(|s| s.0);
    for (_, p, size) in songs {
        if total + need <= CACHE_LIMIT {
            break;
        }
        if fs::remove_dir_all(&p).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    // songs handed over by the page are kept a week after they were last handed over
    if let Ok(rd) = fs::read_dir(cache.join("uploads")) {
        for e in rd.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).map(|t| t.elapsed().map(|d| d > Duration::from_secs(7 * 86_400)).unwrap_or(false)).unwrap_or(false);
            if old {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

/// Hand over a song as bytes (a file the page opened, whose place on disk it does not know):
/// it is kept in the cache folder and its path given back, for `stems_split`. The file's name
/// travels in the `x-name` header (only its ending is used, to know its kind).
#[tauri::command]
pub async fn stems_upload(app: tauri::AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected the song's bytes".into()) };
    let bytes = bytes.clone();
    let ext: String = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .and_then(|n| Path::new(n).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()))
        .filter(|e| e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".into());
    let dir = cache_dir(&app)?.join("uploads");
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let sha = fetch::hex(&Sha256::digest(&bytes));
        let p = dir.join(format!("{}.{ext}", &sha[..32]));
        if !p.exists() {
            let tmp = p.with_extension("tmp");
            fs::write(&tmp, &bytes).map_err(|e| format!("The song could not be kept ({e})"))?;
            fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
        } else if let Ok(f) = fs::File::options().append(true).open(&p) {
            // handed over again: kept another week from now (see `evict`)
            let _ = f.set_modified(std::time::SystemTime::now());
        }
        Ok(p.to_string_lossy().into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Split the song at `path` with model `model` (by default the four-stem one). Answers when every
/// stem is finished, with where they are; on the way, `events` says where they are as soon as the
/// first stretch is under way and how far they are ready after each stretch. The same song with
/// the same model comes straight from the cache. `stems_cancel(id)` stops it (what was made is
/// deleted).
#[tauri::command]
pub async fn stems_split(app: tauri::AppHandle, id: String, path: String, model: Option<String>, events: Channel<SplitEvent>) -> Result<Separated, String> {
    let m = fetch::model(model.as_deref().unwrap_or(MODELS[0].id)).ok_or("No such model")?;
    let data = data_dir(&app)?;
    let cache = cache_dir(&app)?;
    let (reg, cancel) = register(&id)?;
    let thread = std::thread::Builder::new()
        .name("stems-split".into())
        .spawn(move || {
            runtime::lower_priority();
            let mut reg = reg;
            split_job(&id, Path::new(&path), m, &data, &cache, &cancel, &mut reg, &mut |e| {
                let _ = events.send(e);
            })
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || thread.join().unwrap_or_else(|_| Err("The split stopped unexpectedly".into()))).await.map_err(|e| e.to_string())?
}

/// Wait while the engine records a take: nothing heavy starts then, not even reading a whole
/// song through to know it, or opening the model (a few seconds of hard work).
fn wait_for_take(busy: fn() -> bool, cancel: &AtomicBool, send: &mut dyn FnMut(SplitEvent)) -> Result<(), String> {
    if !busy() {
        return Ok(());
    }
    send(SplitEvent::Paused { reason: "recording".into() });
    while busy() {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    send(SplitEvent::Resumed);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn split_job(id: &str, song: &Path, m: &'static ModelDef, data: &Path, cache: &Path, cancel: &Arc<AtomicBool>, reg: &mut Registered, send: &mut dyn FnMut(SplitEvent)) -> Result<Separated, String> {
    wait_for_take(crate::engine::recording, cancel, send)?;
    let sha = fetch::sha256_file_or_stop(song, cancel).map_err(|e| if e == "cancelled" { e } else { format!("The song could not be read ({e})") })?;
    let key = cache_key(&sha, m.id);
    let dir = cache.join(&key);
    {
        let mut j = jobs();
        if j.keys.contains(&key) {
            return Err("This song is already being split".into());
        }
        j.keys.push(key.clone());
        reg.key = Some(key.clone());
    }
    let model = model_present(data, m);
    if let Some(made) = finished(&dir, model.as_ref().map(|p| p.sha256.as_str())) {
        // touched, so it counts as used just now and is kept longest
        let _ = fs::write(dir.join("done.json"), serde_json::to_vec(&made).unwrap_or_default());
        let seconds = made.frames as f64 / made.rate.max(1) as f64;
        send(SplitEvent::Started { key: key.clone(), stems: made.stems.clone(), rate: made.rate, seconds: Some(seconds), provider: made.provider.clone(), cached: true });
        send(SplitEvent::Progress { done: 1, total: 1, ready_frames: made.frames, ready: seconds, speed: 0.0, eta: Some(0.0) });
        return Ok(Separated { id: id.into(), key, model: made.model, stems: made.stems, rate: made.rate, frames: made.frames, seconds, provider: made.provider, cached: true, took: 0.0 });
    }
    let Some(model) = model else {
        return Err("The stem model has not been downloaded".into());
    };
    let env = environment(data)?;

    // one song at a time
    let mut queued = false;
    let _worker = loop {
        match WORKER.try_lock() {
            Ok(g) => break g,
            Err(std::sync::TryLockError::Poisoned(p)) => break p.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => {
                if !queued {
                    queued = true;
                    send(SplitEvent::Queued);
                }
                if cancel.load(Ordering::Relaxed) {
                    return Err("cancelled".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    };
    // a take may have begun while this song waited its turn
    wait_for_take(crate::engine::recording, cancel, send)?;
    let started = Instant::now();
    let r = (|| -> Result<Separated, Stop> {
        let mut src = pipeline::Source::open(song)?;
        let est = src.frames.map(|f| f * 8 * m.stems.len() as u64);
        let in_use = jobs().keys.clone();
        evict(cache, est.unwrap_or(0), &in_use);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        if let (Some(need), Some(free)) = (est, crate::recfile::free_space(&dir)) {
            if free < need + (64 << 20) {
                return Err(Stop::Failed(format!("Not enough room on the disk for the stems: {} MB are needed, {} MB are free", need >> 20, free >> 20)));
            }
        }
        send(SplitEvent::Loading);
        // a model that will not open, or is not the network it should be, is reported with the
        // model's status (see `ModelStatus::error`), so the page can offer to fetch it again
        let opened = runtime::OrtSeparator::open(&env, &model_path(data, m), m.stems.len(), m.segment, true).and_then(|sep| match sep.stems() {
            n if n == m.stems.len() => Ok(sep),
            n => Err(format!("The model makes {n} stems, not {}", m.stems.len())),
        });
        // (running out of memory says nothing about the file, so that is not held against it)
        let blame = opened.as_ref().err().filter(|e| !e.to_ascii_lowercase().contains("alloc") && !e.to_ascii_lowercase().contains("memory"));
        set_model_error(m.id, blame.cloned());
        let mut sep = opened?;
        let stems: Vec<StemFile> = m.stems.iter().map(|s| StemFile { name: s.to_string(), path: dir.join(format!("{s}.wav")).to_string_lossy().into() }).collect();
        let outputs: Vec<PathBuf> = stems.iter().map(|s| PathBuf::from(&s.path)).collect();
        let rate = src.rate;
        let seconds = src.frames.map(|f| f as f64 / rate as f64);
        send(SplitEvent::Started { key: key.clone(), stems: stems.clone(), rate, seconds, provider: sep.provider().into(), cached: false });
        let _watch = runtime::Watch::start(sep.stop.clone(), cancel.clone(), crate::engine::recording);
        let ctl = Controls { cancel: cancel.as_ref(), busy: &crate::engine::recording, poll: Duration::from_millis(250) };
        let work = Instant::now();
        let done = pipeline::split_source(&mut src, &outputs, &mut sep, &ctl, &mut |e| match e {
            Event::Progress { done, total, ready } => {
                let secs = ready as f64 / rate as f64;
                let took = work.elapsed().as_secs_f64();
                let speed = if took > 0.0 { secs / took } else { 0.0 };
                let eta = seconds.filter(|_| speed > 0.0).map(|s| ((s - secs) / speed).max(0.0));
                send(SplitEvent::Progress { done, total, ready_frames: ready, ready: secs, speed, eta });
            }
            Event::Paused => send(SplitEvent::Paused { reason: "recording".into() }),
            Event::Resumed => send(SplitEvent::Resumed),
        })?;
        let provider = sep.provider().to_string();
        let made = Made { pipeline: PIPELINE, model: m.id.into(), model_sha256: model.sha256.clone(), stems: stems.clone(), rate: done.rate, frames: done.frames, provider: provider.clone(), made: fetch::now() };
        fs::write(dir.join("done.json"), serde_json::to_vec_pretty(&made).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        Ok(Separated { id: id.into(), key: key.clone(), model: m.id.into(), stems, rate: done.rate, frames: done.frames, seconds: done.frames as f64 / done.rate as f64, provider, cached: false, took: started.elapsed().as_secs_f64() })
    })();
    match r {
        Ok(s) => Ok(s),
        Err(e) => {
            // half-made stems are not kept
            let _ = fs::remove_dir_all(&dir);
            Err(match e {
                Stop::Cancelled => "cancelled".into(),
                Stop::Failed(m) => m,
            })
        }
    }
}

// ── reading back and clearing ──

/// Is `path` inside `root` (after following any links)? Only stems are read back, never any
/// other file the page might name.
fn inside(path: &Path, root: &Path) -> bool {
    match (fs::canonicalize(path), fs::canonicalize(root)) {
        (Ok(p), Ok(r)) => p.starts_with(r),
        _ => false,
    }
}

/// `frames` frames of a stem from frame `start`, as little-endian 32-bit floats, left and right
/// in turn. A part not yet written comes back shorter (or empty).
fn read_part(path: &Path, start: u64, frames: u64) -> Result<Vec<u8>, String> {
    let mut r = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = r.spec();
    if spec.sample_format != hound::SampleFormat::Float || spec.bits_per_sample != 32 {
        return Err("not a stem file".into());
    }
    let total = r.duration() as u64;
    let from = start.min(total);
    let n = frames.min(READ_MAX).min(total - from);
    r.seek(from as u32).map_err(|e| e.to_string())?;
    let ch = spec.channels as usize;
    let mut out = Vec::with_capacity(n as usize * ch * 4);
    for s in r.samples::<f32>().take(n as usize * ch) {
        match s {
            Ok(v) => out.extend_from_slice(&v.to_le_bytes()),
            Err(_) => break,
        }
    }
    // a part cut short mid-frame (being written right now) ends at the last whole frame
    out.truncate(out.len() / (ch * 4) * ch * 4);
    Ok(out)
}

/// Part of a stem: `frames` frames from `start`, as little-endian 32-bit floats, left and right
/// in turn (a stem is always stereo). Can be read while the stem is still being made, up to the
/// `ready_frames` last reported.
#[tauri::command]
pub async fn stems_read(app: tauri::AppHandle, path: String, start: u64, frames: u64) -> Result<Response, String> {
    let root = cache_dir(&app)?;
    let p = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || {
        if !inside(&p, &root) || p.extension().map(|e| e != "wav").unwrap_or(true) {
            return Err("only stems can be read".to_string());
        }
        read_part(&p, start, frames)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(Response::new)
}

/// Delete every kept stem (not those of a song being split right now). Returns the bytes freed.
#[tauri::command]
pub async fn stems_clear(app: tauri::AppHandle) -> Result<u64, String> {
    let cache = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let in_use = jobs().keys.clone();
        let before = fetch::dir_size(&cache);
        if let Ok(rd) = fs::read_dir(&cache) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                // the songs handed over by the page go too, unless one may be being read right now
                let gone = (is_song_dir(&name) && !in_use.contains(&name)) || (name == "uploads" && in_use.is_empty());
                if gone && e.path().is_dir() {
                    let _ = fs::remove_dir_all(e.path());
                }
            }
        }
        Ok(before.saturating_sub(fetch::dir_size(&cache)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::pipeline::tests::{read_wav, write_wav};

    #[test]
    fn the_cache_key_is_the_song_and_the_model() {
        let a = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(cache_key(a, "htdemucs"), "0123456789abcdef0123456789abcdef-htdemucs");
        assert_ne!(cache_key(a, "htdemucs"), cache_key(a, "htdemucs_6s"));
        let b = "1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_ne!(cache_key(a, "htdemucs"), cache_key(b, "htdemucs"));
        // the same bytes under another name are the same song
        let dir = crate::recfile::scratch("stems-key");
        let x = dir.with_file_name("key-a.wav");
        let y = dir.with_file_name("key-b.mp3");
        fs::write(&x, b"same bytes").unwrap();
        fs::write(&y, b"same bytes").unwrap();
        assert_eq!(fetch::sha256_file(&x).unwrap(), fetch::sha256_file(&y).unwrap());
        assert_eq!(fetch::sha256_file(&x).unwrap(), fetch::hex(&Sha256::digest(b"same bytes")));
        let _ = fs::remove_file(x);
        let _ = fs::remove_file(y);
    }

    #[test]
    fn a_stem_is_read_back_a_part_at_a_time_and_only_stems_are_read() {
        let root = crate::recfile::scratch("stems-read").with_file_name("read-root");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("song")).unwrap();
        let stem = root.join("song").join("vocals.wav");
        let frames: Vec<[f32; 2]> = (0..1000).map(|i| [i as f32, -(i as f32)]).collect();
        write_wav(&stem, 44_100, 2, &frames);
        let b = read_part(&stem, 10, 3).unwrap();
        let v: Vec<f32> = b.chunks(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        assert_eq!(v, vec![10.0, -10.0, 11.0, -11.0, 12.0, -12.0]);
        // past the end: what there is, then nothing
        assert_eq!(read_part(&stem, 998, 10).unwrap().len(), 2 * 2 * 4);
        assert!(read_part(&stem, 5000, 10).unwrap().is_empty());
        assert!(inside(&stem, &root));
        let outside = root.with_file_name("read-elsewhere.wav");
        write_wav(&outside, 44_100, 2, &frames);
        assert!(!inside(&outside, &root));
        assert!(!inside(&root.join("song").join("..").join("..").join("read-elsewhere.wav"), &root), "no way out by '..'");
        assert_eq!(read_wav(&stem).1.len(), 1000);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn old_songs_make_room_for_new_ones_but_songs_in_use_stay() {
        let cache = crate::recfile::scratch("stems-evict").with_file_name("evict-cache");
        let _ = fs::remove_dir_all(&cache);
        let mk = |name: &str, bytes: usize, done: bool| {
            let d = cache.join(name);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("drums.wav"), vec![0u8; bytes]).unwrap();
            if done {
                fs::write(d.join("done.json"), b"{}").unwrap();
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        let song = |c: char| format!("{}-htdemucs", c.to_string().repeat(32));
        let (oldest, middle, newest, crashed, busy) = (song('a'), song('b'), song('c'), song('d'), song('e'));
        mk(&oldest, 1000, true);
        mk(&middle, 1000, true);
        mk(&newest, 1000, true);
        mk(&crashed, 1000, false);
        mk(&busy, 1000, false);
        // anything else in the folder is never touched (on Windows the model's folder is a neighbour)
        mk("models", 1000, false);
        mk("uploads", 1000, false);
        // room for a song as big as the limit itself: every finished song goes, the oldest first
        evict(&cache, CACHE_LIMIT - 1500, std::slice::from_ref(&busy));
        assert!(!cache.join(&crashed).exists(), "a half-made folder goes");
        assert!(cache.join(&busy).exists(), "a song being split stays");
        assert!(!cache.join(&oldest).exists() && !cache.join(&middle).exists());
        assert!(cache.join(&newest).exists(), "only as much as is needed goes");
        assert!(cache.join("models").exists() && cache.join("uploads").exists());
        assert!(is_song_dir(&newest) && !is_song_dir("models") && !is_song_dir("runtime") && !is_song_dir(&format!("{}-unknown", "a".repeat(32))));
        let _ = fs::remove_dir_all(&cache);
    }

    #[test]
    fn finished_stems_are_found_again_and_unfinished_ones_are_not() {
        let dir = crate::recfile::scratch("stems-made").with_file_name("made-song");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let stem = StemFile { name: "vocals".into(), path: dir.join("vocals.wav").to_string_lossy().into() };
        fs::write(&stem.path, b"x").unwrap();
        let sha = "ab".repeat(32);
        assert!(finished(&dir, Some(&sha)).is_none());
        let made = Made { pipeline: PIPELINE, model: "htdemucs".into(), model_sha256: sha.clone(), stems: vec![stem.clone()], rate: 48_000, frames: 10, provider: "CPU".into(), made: 0 };
        fs::write(dir.join("done.json"), serde_json::to_vec(&made).unwrap()).unwrap();
        assert_eq!(finished(&dir, Some(&sha)).unwrap().stems, vec![stem.clone()]);
        // the model is not here to compare with (deleted): the stems are still good to use
        assert!(finished(&dir, None).is_some());
        // made by another version of the model file: made again
        assert!(finished(&dir, Some(&"cd".repeat(32))).is_none());
        // made by an older version of the pipeline: made again
        let old = Made { pipeline: PIPELINE + 1, ..made.clone() };
        fs::write(dir.join("done.json"), serde_json::to_vec(&old).unwrap()).unwrap();
        assert!(finished(&dir, Some(&sha)).is_none());
        // a stem file gone missing: made again
        fs::write(dir.join("done.json"), serde_json::to_vec(&made).unwrap()).unwrap();
        fs::remove_file(&stem.path).unwrap();
        assert!(finished(&dir, Some(&sha)).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_older_versions_left_behind_is_cleared_and_nothing_else() {
        let data = crate::recfile::scratch("stems-tidy").with_file_name("tidy-data");
        let _ = fs::remove_dir_all(&data);
        let mk = |rel: &str| {
            let p = data.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, b"x").unwrap();
        };
        let m = &MODELS[0];
        let keep_model = [format!("models/{}/{}", m.id, m.file), format!("models/{}/{}.json", m.id, m.file), format!("models/{}/{}.part", m.id, m.file)];
        for k in &keep_model {
            mk(k);
        }
        mk(&format!("models/{}/an-older-export.onnx.part", m.id));
        mk("models/a-model-no-longer-offered/x.onnx");
        mk("runtime/1.0.0/onnxruntime.dll");
        mk("runtime/onnxruntime-1.0.0.whl.part");
        mk("runtime/notes-the-user-left.txt");
        if let Some(rt) = RUNTIME.as_ref() {
            mk(&format!("runtime/{}/{}", rt.version, rt.library));
            mk(&format!("runtime/{}/{}.tmp", rt.version, rt.library));
            mk(&format!("runtime/onnxruntime-{}.whl.part", rt.version));
        }
        tidy(&data);
        for k in &keep_model {
            assert!(data.join(k).exists(), "{k}");
        }
        assert!(!data.join(format!("models/{}/an-older-export.onnx.part", m.id)).exists());
        assert!(!data.join("models/a-model-no-longer-offered").exists());
        assert!(data.join("runtime/notes-the-user-left.txt").exists(), "not a name the app made");
        if let Some(rt) = RUNTIME.as_ref() {
            assert!(!data.join("runtime/1.0.0").exists() && !data.join("runtime/onnxruntime-1.0.0.whl.part").exists());
            assert!(data.join(format!("runtime/{}/{}", rt.version, rt.library)).exists());
            assert!(!data.join(format!("runtime/{}/{}.tmp", rt.version, rt.library)).exists(), "half-unpacked");
            assert!(data.join(format!("runtime/onnxruntime-{}.whl.part", rt.version)).exists(), "a download to carry on with");
        }
        let _ = fs::remove_dir_all(&data);
    }

    #[test]
    fn nothing_starts_while_a_take_is_recorded() {
        use std::sync::atomic::AtomicUsize;
        static LOOKS: AtomicUsize = AtomicUsize::new(0);
        // recording for the first three looks, then not
        fn busy() -> bool {
            LOOKS.fetch_add(1, Ordering::Relaxed) < 3
        }
        let mut seen = vec![];
        wait_for_take(busy, &AtomicBool::new(false), &mut |e| seen.push(serde_json::to_value(e).unwrap()["kind"].as_str().unwrap().to_string())).unwrap();
        assert_eq!(seen, vec!["paused", "resumed"]);
        assert!(LOOKS.load(Ordering::Relaxed) >= 4);
        // not recording: straight on, with nothing said
        fn idle() -> bool {
            false
        }
        let mut seen = 0;
        wait_for_take(idle, &AtomicBool::new(false), &mut |_| seen += 1).unwrap();
        assert_eq!(seen, 0);
        // cancelled while waiting
        fn always() -> bool {
            true
        }
        assert_eq!(wait_for_take(always, &AtomicBool::new(true), &mut |_| {}).unwrap_err(), "cancelled");
    }

    #[test]
    fn a_job_is_cancelled_by_its_id_and_its_place_is_freed_when_it_ends() {
        let (reg, flag) = register("cancel-me").unwrap();
        assert!(register("cancel-me").is_err(), "one job per id");
        assert!(!cancel_job("someone-else"));
        assert!(cancel_job("cancel-me"));
        assert!(flag.load(Ordering::Relaxed));
        drop(reg);
        assert!(!cancel_job("cancel-me"), "gone once it ended");
        assert!(register("cancel-me").is_ok());
    }

    /// The whole path with the real ONNX Runtime: fetched through this app's own list (pinned
    /// SHA-256, from PyPI), unpacked, loaded, and run on a stand-in for Demucs with exactly its
    /// interface (a stereo stretch in, four stereo stems out, here each a fixed share of the mix).
    /// The real model cannot be fetched where this was written (its host is out of reach), so the
    /// stand-in shows that everything around it works. Set MT_ORT_WHEEL to a downloaded copy of
    /// the wheel to run it without the network.
    #[test]
    #[ignore = "downloads ONNX Runtime (17-25 MB) from PyPI; run with --ignored"]
    fn a_song_is_split_by_onnx_runtime_end_to_end() {
        let rt = RUNTIME.as_ref().expect("a runtime for this computer");
        let root = crate::recfile::scratch("stems-ort").with_file_name("ort-e2e");
        let _ = fs::remove_dir_all(&root);
        let data = root.join("data");
        let cache = root.join("cache");
        let dir = runtime_dir(&data).unwrap();
        let wheel = data.join("runtime.whl");
        fs::create_dir_all(&data).unwrap();
        match std::env::var("MT_ORT_WHEEL") {
            Ok(w) => {
                fs::copy(w, &wheel).unwrap();
                assert_eq!(fetch::sha256_file(&wheel).unwrap(), rt.sha256, "the pinned SHA-256 is that of the published wheel");
            }
            Err(_) => {
                let cancel = AtomicBool::new(false);
                let got = tauri::async_runtime::block_on(fetch::download(&fetch::client().unwrap(), &fetch::PUBLIC, rt.url, &wheel, Some(rt.sha256), Some(rt.bytes), &cancel, |_| {})).unwrap();
                assert_eq!(got.bytes, rt.bytes);
            }
        }
        fetch::unzip(&wheel, rt.files, &dir).unwrap();
        assert!(runtime_present(&data));

        // the stand-in model where the real one would be, with its record
        let m = fetch::model("htdemucs").unwrap();
        let shares = [0.1f32, 0.2, 0.3, 0.4];
        let bytes = runtime::onnx::scaled_copies(&shares, Some(4_410));
        let mp = model_path(&data, m);
        fs::create_dir_all(mp.parent().unwrap()).unwrap();
        fs::write(&mp, &bytes).unwrap();
        Provenance { url: "stand-in".into(), sha256: fetch::hex(&Sha256::digest(&bytes)), bytes: bytes.len() as u64, checked_against: "pinned".into(), revision: None, fetched: 0 }.write(&provenance_path(&mp)).unwrap();
        assert!(model_present(&data, m).is_some());

        // a song: three seconds at 48 kHz
        let song = root.join("song.wav");
        let x: Vec<[f32; 2]> = (0..144_000)
            .map(|i| {
                let t = i as f64 / 48_000.0;
                [(0.5 * (2.0 * std::f64::consts::PI * 330.0 * t).sin()) as f32, (0.25 * (2.0 * std::f64::consts::PI * 495.0 * t).sin()) as f32]
            })
            .collect();
        write_wav(&song, 48_000, 2, &x);

        let cancel = Arc::new(AtomicBool::new(false));
        let mut events = vec![];
        let (mut reg, _) = register("e2e").unwrap();
        let out = split_job("e2e", &song, m, &data, &cache, &cancel, &mut reg, &mut |e| events.push(serde_json::to_value(e).unwrap())).unwrap();
        drop(reg);
        assert!(runtime::loaded());
        assert_eq!(out.provider, "CPU");
        assert!(!out.cached);
        assert_eq!((out.rate, out.frames), (48_000, 144_000));
        assert_eq!(out.stems.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["drums", "bass", "other", "vocals"]);
        let kinds: Vec<String> = events.iter().map(|e| e["kind"].as_str().unwrap().to_string()).collect();
        assert_eq!(kinds[0], "loading");
        assert_eq!(kinds[1], "started");
        assert!(kinds[2..].iter().all(|k| k == "progress"));
        // 3 s at 44.1 kHz in stretches of 0.1 s with a quarter overlap
        assert_eq!(kinds.len() - 2, pipeline::Plan::quarter(4_410).count(132_300) as usize);
        let ready: Vec<u64> = events[2..].iter().map(|e| e["ready_frames"].as_u64().unwrap()).collect();
        assert!(ready.windows(2).all(|w| w[0] < w[1]) && *ready.last().unwrap() == 144_000);
        // each stem is its share of the song, in its place
        let stems: Vec<Vec<[f32; 2]>> = out.stems.iter().map(|s| read_wav(Path::new(&s.path)).1).collect();
        for (k, s) in stems.iter().enumerate() {
            assert_eq!(s.len(), x.len());
            let err = s.iter().zip(&x).skip(100).take(x.len() - 200).map(|(a, b)| (a[0] - shares[k] * b[0]).abs().max((a[1] - shares[k] * b[1]).abs())).fold(0.0f32, f32::max);
            assert!(err < 2e-3, "stem {k}: {err}");
        }
        // a part read back, as the page reads it
        let part = read_part(Path::new(&out.stems[3].path), 48_000, 4).unwrap();
        assert_eq!(part.len(), 4 * 2 * 4);

        // the same song again (under another name): from the cache, at once
        let again = root.join("same-song-renamed.wav");
        fs::copy(&song, &again).unwrap();
        let (mut reg, _) = register("e2e-2").unwrap();
        let cached = split_job("e2e-2", &again, m, &data, &cache, &cancel, &mut reg, &mut |_| {}).unwrap();
        drop(reg);
        assert!(cached.cached);
        assert_eq!(cached.stems, out.stems);

        // cancelled half-way: stops, and nothing half-made is left
        fs::remove_dir_all(cache.join(&out.key)).unwrap();
        let (mut reg, flag) = register("e2e-3").unwrap();
        let mut n = 0;
        let f2 = flag.clone();
        let r = split_job("e2e-3", &song, m, &data, &cache, &flag, &mut reg, &mut |e| {
            if matches!(e, SplitEvent::Progress { .. }) {
                n += 1;
                if n == 3 {
                    f2.store(true, Ordering::Relaxed);
                }
            }
        });
        drop(reg);
        assert_eq!(r.unwrap_err(), "cancelled");
        assert!(!cache.join(&out.key).exists());

        // a model file that will not open: the split fails plainly, and the model's status says
        // why (so the page can offer to fetch it again); nothing half-made is left
        let m6 = fetch::model("htdemucs_6s").unwrap();
        let bad = model_path(&data, m6);
        fs::create_dir_all(bad.parent().unwrap()).unwrap();
        fs::write(&bad, b"not a network at all").unwrap();
        Provenance { url: "stand-in".into(), sha256: fetch::hex(&Sha256::digest(b"not a network at all")), bytes: 20, checked_against: "pinned".into(), revision: None, fetched: 0 }.write(&provenance_path(&bad)).unwrap();
        let (mut reg, flag) = register("e2e-4").unwrap();
        let e = split_job("e2e-4", &song, m6, &data, &cache, &flag, &mut reg, &mut |_| {}).unwrap_err();
        drop(reg);
        assert!(e.contains("could not be opened"), "{e}");
        assert!(model_error("htdemucs_6s").is_some());
        assert!(!cache.join(cache_key(&fetch::sha256_file(&song).unwrap(), "htdemucs_6s")).exists());
        set_model_error("htdemucs_6s", None);

        // a stretch under way is abandoned at once when told to stop (as when a take begins)
        let mut sep = runtime::OrtSeparator::open(&environment(&data).unwrap(), &mp, 4, 4_410, false).unwrap();
        sep.stop.terminate().unwrap();
        let mix = vec![0.1f32; 2 * 4_410];
        let mut o = vec![];
        assert!(matches!(sep.run_once(&mix, &mut o), Err(pipeline::RunError::Interrupted)));
        // and the next stretch runs normally
        assert!(pipeline::Separator::run(&mut sep, &mix, &mut o).is_ok());
        assert_eq!(o.len(), 4 * 2 * 4_410);
        let _ = fs::remove_dir_all(&root);
    }
}

//! What is downloaded for stems, from where, and how each download is checked.
//!
//! Two things are fetched once, only when the user asks, and kept in the app's local data
//! folder (never in the installer, which stays free of them):
//! - the ONNX Runtime library that runs the network (Microsoft, MIT licence), taken from
//!   Microsoft's own package on the Python Package Index, whose files never change once
//!   published. Its SHA-256 is written here, so a file that is not exactly that one is refused.
//! - the network itself: Demucs v4 ("htdemucs", by Meta, MIT licence), as exported to ONNX by
//!   the demucs-onnx project (MIT), from its Hugging Face repository.
//!
//! Every download is checked against a SHA-256 before it is used. Where this file pins one, that
//! is the one; where it does not yet (the model's could not be read from where this was written),
//! the host must state the file's SHA-256 (Hugging Face sends it with every stored file) and the
//! download must match it, and the checked value is kept with the file for anyone to see.
//!
//! A download that is stopped (cancelled, the connection dropped, the app closed) is kept as a
//! part-file and continued from where it stopped next time, if the host still offers the very
//! same file; otherwise it starts again from nothing.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// One of the networks that can be downloaded.
pub struct ModelDef {
    pub id: &'static str,
    pub name: &'static str,
    /// the stems it makes, in the order of its output
    pub stems: &'static [&'static str],
    /// the file's name on disk
    pub file: &'static str,
    /// where it is fetched from (the first that works); a mirror only needs to serve the same bytes
    pub urls: &'static [&'static str],
    /// the page that describes it
    pub page: &'static str,
    /// about how big it is (bytes), to show before it is fetched
    pub approx_bytes: u64,
    /// its SHA-256, when known here; otherwise the host's stated one is required (see above)
    pub sha256: Option<&'static str>,
    pub licence: &'static str,
    /// samples per stretch at 44.1 kHz, if the file does not say (7.8 s)
    pub segment: usize,
}

pub const MODELS: &[ModelDef] = &[
    ModelDef {
        id: "htdemucs",
        name: "Demucs v4: vocals, drums, bass, other",
        stems: &["drums", "bass", "other", "vocals"],
        file: "htdemucs_fp16weights.onnx",
        urls: &["https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx"],
        page: "https://huggingface.co/StemSplitio/htdemucs-onnx",
        approx_bytes: 166_000_000,
        sha256: None,
        licence: "MIT: Demucs (Hybrid Transformer Demucs v4) by Meta Platforms; ONNX export by the demucs-onnx project",
        segment: 343_980,
    },
    ModelDef {
        id: "htdemucs_6s",
        name: "Demucs v4, six stems: adds guitar and piano (piano is rough)",
        stems: &["drums", "bass", "other", "vocals", "guitar", "piano"],
        file: "htdemucs_6s_fp16weights.onnx",
        urls: &["https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx"],
        page: "https://huggingface.co/StemSplitio/htdemucs-6s-onnx",
        approx_bytes: 136_000_000,
        sha256: None,
        licence: "MIT: Demucs (Hybrid Transformer Demucs v4, 6 sources) by Meta Platforms; ONNX export by the demucs-onnx project",
        segment: 343_980,
    },
];

pub fn model(id: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|m| m.id == id)
}

/// The ONNX Runtime library for this computer: a published Python wheel (a zip file), and the
/// files taken out of it.
pub struct RuntimeDef {
    pub version: &'static str,
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    /// (name inside the wheel, name on disk)
    pub files: &'static [(&'static str, &'static str)],
    /// the library to load
    pub library: &'static str,
    /// loaded first, from the same folder, so the library finds this copy and not an older one
    /// the system may have
    pub preload: &'static [&'static str],
    /// the graphics-card path it brings, if any
    pub gpu: Option<&'static str>,
    pub licence: &'static str,
}

/// Windows: Microsoft's "onnxruntime-directml" 1.24.4 (CPU and DirectML in one library).
#[cfg(all(windows, target_arch = "x86_64"))]
pub const RUNTIME: Option<RuntimeDef> = Some(RuntimeDef {
    version: "1.24.4",
    url: "https://files.pythonhosted.org/packages/88/ea/33814eb0ec96775eda4c1d30b0d86e91d7d2cd0d84c66d3915aef0e06fa3/onnxruntime_directml-1.24.4-cp312-cp312-win_amd64.whl",
    bytes: 25_111_930,
    sha256: "f2ecb68b7b7b259d2ef3112ae760149f9b5a1e7c0fbb73d539da6250a648a614",
    files: &[
        ("onnxruntime/capi/onnxruntime.dll", "onnxruntime.dll"),
        ("onnxruntime/capi/DirectML.dll", "DirectML.dll"),
        ("onnxruntime/LICENSE", "LICENSE.txt"),
        ("onnxruntime/ThirdPartyNotices.txt", "ThirdPartyNotices.txt"),
    ],
    library: "onnxruntime.dll",
    preload: &["DirectML.dll"],
    gpu: Some("DirectML"),
    licence: "MIT: ONNX Runtime by Microsoft; DirectML.dll by Microsoft under its own redistribution terms",
});

/// Linux (for development and the tests): Microsoft's "onnxruntime" 1.24.4, CPU only.
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub const RUNTIME: Option<RuntimeDef> = Some(RuntimeDef {
    version: "1.24.4",
    url: "https://files.pythonhosted.org/packages/6d/ab/5b68110e0460d73fad814d5bd11c7b1ddcce5c37b10177eb264d6a36e331/onnxruntime-1.24.4-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl",
    bytes: 17_244_912,
    sha256: "0d640eb9f3782689b55cfa715094474cd5662f2f137be6a6f847a594b6e9705c",
    files: &[("onnxruntime/capi/libonnxruntime.so.1.24.4", "libonnxruntime.so"), ("onnxruntime/LICENSE", "LICENSE.txt")],
    library: "libonnxruntime.so",
    preload: &[],
    gpu: None,
    licence: "MIT: ONNX Runtime by Microsoft",
});

#[cfg(not(any(all(windows, target_arch = "x86_64"), all(target_os = "linux", target_arch = "x86_64"))))]
pub const RUNTIME: Option<RuntimeDef> = None;

/// What is kept next to a downloaded file: where it came from and what it was checked against.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Provenance {
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    /// "pinned" (this app's own list) or "host" (the SHA-256 the host stated for the file)
    pub checked_against: String,
    /// the repository revision the host said it served, if it said
    pub revision: Option<String>,
    /// seconds since 1970 when it was fetched
    pub fetched: u64,
}

impl Provenance {
    pub fn read(path: &Path) -> Option<Provenance> {
        serde_json::from_slice(&fs::read(path).ok()?).ok()
    }
    pub fn write(&self, path: &Path) -> Result<(), String> {
        fs::write(path, serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Is `s` a SHA-256 written out in hex?
fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Which SHA-256 a download must have: the pinned one if there is one (a host stating another
/// is refused), else the one the host stated. With neither, the file cannot be checked and is not
/// used. Returns the expected value and where it came from.
pub fn expected_sha(pinned: Option<&str>, host: Option<&str>) -> Result<(String, &'static str), String> {
    let host = host.map(|h| h.to_ascii_lowercase()).filter(|h| is_sha256(h));
    match (pinned, host) {
        (Some(p), Some(h)) if !p.eq_ignore_ascii_case(&h) => Err("The server offers a different file from the one this app knows; it was not downloaded".into()),
        (Some(p), _) => Ok((p.to_ascii_lowercase(), "pinned")),
        (None, Some(h)) => Ok((h, "host")),
        (None, None) => Err("The server did not say what the file should be, so it could not be checked; it was not used".into()),
    }
}

/// The SHA-256 a host states for a file. Hugging Face sends it as `X-Linked-Etag` on the way to
/// the stored file (and as the plain ETag on some answers), in quotes.
pub fn host_sha(headers: &reqwest::header::HeaderMap) -> Option<String> {
    for name in ["x-linked-etag", "etag"] {
        if let Some(v) = headers.get(name).and_then(|v| v.to_str().ok()) {
            let v = v.trim().trim_start_matches("W/").trim_matches('"').to_ascii_lowercase();
            if is_sha256(&v) {
                return Some(v);
            }
        }
    }
    None
}

/// How far a download has got.
#[derive(Clone, Copy, Debug)]
pub struct Got {
    pub done: u64,
    pub total: Option<u64>,
}

/// What a download is remembered by between attempts (beside the part-file).
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct PartInfo {
    url: String,
    host_sha: Option<String>,
}

#[derive(Debug)]
pub struct Fetched {
    pub sha256: String,
    pub bytes: u64,
    pub checked_against: &'static str,
    pub revision: Option<String>,
}

/// The HTTP client for downloads. It follows redirects itself (so the headers on the way, where
/// the host states the file's SHA-256, can be read), and waits at most a minute for a server
/// that has gone quiet.
pub fn client() -> Result<reqwest::Client, String> {
    // the same TLS set-up as the updater
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(concat!("M-Theory/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// Download `url` to `dest`, checked: first into `dest.part` (continued if an earlier attempt
/// left one for the same file), then checked, then moved into place. A file that does not check
/// out is deleted. `cancel` stops it between blocks; what was fetched so far is kept for next time.
pub async fn download(client: &reqwest::Client, url: &str, dest: &Path, pinned: Option<&str>, expected_bytes: Option<u64>, cancel: &AtomicBool, mut progress: impl FnMut(Got) + Send) -> Result<Fetched, String> {
    match attempt(client, url, dest, pinned, expected_bytes, cancel, &mut progress).await {
        // the server answered for a part that was not asked for: once more, from nothing
        Err(Attempt::Restart) => {
            let _ = fs::remove_file(with_suffix(dest, ".part"));
            let _ = fs::remove_file(with_suffix(dest, ".part.json"));
            match attempt(client, url, dest, pinned, expected_bytes, cancel, &mut progress).await {
                Ok(f) => Ok(f),
                Err(Attempt::Restart) => Err("The server would not send the file in one piece".into()),
                Err(Attempt::Failed(e)) => Err(e),
            }
        }
        Err(Attempt::Failed(e)) => Err(e),
        Ok(f) => Ok(f),
    }
}

enum Attempt {
    Restart,
    Failed(String),
}

impl From<String> for Attempt {
    fn from(s: String) -> Self {
        Attempt::Failed(s)
    }
}
impl From<&str> for Attempt {
    fn from(s: &str) -> Self {
        Attempt::Failed(s.to_string())
    }
}

async fn attempt(client: &reqwest::Client, url: &str, dest: &Path, pinned: Option<&str>, expected_bytes: Option<u64>, cancel: &AtomicBool, progress: &mut (dyn FnMut(Got) + Send)) -> Result<Fetched, Attempt> {
    let part = with_suffix(dest, ".part");
    let info_path = with_suffix(dest, ".part.json");
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let old: Option<PartInfo> = fs::read(&info_path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    if have > 0 && old.as_ref().map(|o| o.url != url).unwrap_or(true) {
        have = 0;
    }

    // ask (for the rest, if some is here already), following redirects by hand
    let mut at = url.to_string();
    let mut stated: Option<String> = None;
    let mut revision: Option<String> = None;
    let mut resp = None;
    for _ in 0..8 {
        let mut req = client.get(&at);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let r = req.send().await.map_err(|e| format!("Could not reach {} ({e})", host_of(&at)))?;
        stated = stated.or_else(|| host_sha(r.headers()));
        revision = revision.or_else(|| r.headers().get("x-repo-commit").and_then(|v| v.to_str().ok()).map(str::to_string));
        if r.status().is_redirection() {
            let loc = r.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or("The server sent the download elsewhere without saying where")?;
            at = reqwest::Url::parse(&at).and_then(|base| base.join(loc)).map_err(|e| e.to_string())?.to_string();
            continue;
        }
        resp = Some(r);
        break;
    }
    let mut resp = resp.ok_or("The download was sent round in circles")?;
    let (want, against) = expected_sha(pinned, stated.as_deref())?;

    // a part-file of some other version of the file is no use
    if have > 0 && old.as_ref().and_then(|o| o.host_sha.as_ref()) != stated.as_ref() {
        return Err(Attempt::Restart);
    }
    let status = resp.status();
    let resumed = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let from = resp
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("bytes "))
            .and_then(|v| v.split('-').next())
            .and_then(|v| v.parse::<u64>().ok());
        if have == 0 || from != Some(have) {
            return Err(Attempt::Restart);
        }
        true
    } else if status.is_success() {
        false
    } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && have > 0 {
        // the part-file may already be whole: check it as it is (a wrong one is deleted)
        return Ok(finish(&part, &info_path, dest, &want, against, revision, have)?);
    } else {
        return Err(format!("{} answered {status}", host_of(&at)).into());
    };
    if !resumed {
        have = 0;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&info_path, serde_json::to_vec(&PartInfo { url: url.to_string(), host_sha: stated.clone() }).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut f = if resumed { OpenOptions::new().append(true).open(&part) } else { File::create(&part) }.map_err(|e| format!("Could not write the download ({e})"))?;
    let total = resp.content_length().map(|n| n + have).or(expected_bytes);
    let mut done = have;
    let mut last = Instant::now();
    progress(Got { done, total });
    loop {
        if cancel.load(Ordering::Relaxed) {
            f.flush().ok();
            return Err("cancelled".into());
        }
        let chunk = match resp.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => {
                f.flush().ok();
                return Err(format!("The download was cut off ({e}); it will go on from here next time").into());
            }
        };
        f.write_all(&chunk).map_err(|e| format!("Could not write the download ({e})"))?;
        done += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(100) {
            last = Instant::now();
            progress(Got { done, total });
        }
    }
    f.flush().map_err(|e| e.to_string())?;
    drop(f);
    progress(Got { done, total });
    if let Some(t) = resp.content_length().map(|n| n + have) {
        if done < t {
            return Err(format!("The download was cut off at {done} of {t} bytes; it will go on from here next time").into());
        }
    }
    Ok(finish(&part, &info_path, dest, &want, against, revision, done)?)
}

/// Check a finished part-file and move it into place, or delete it if it is not the right file.
fn finish(part: &Path, info: &Path, dest: &Path, want: &str, against: &'static str, revision: Option<String>, bytes: u64) -> Result<Fetched, String> {
    let got = sha256_file(part)?;
    if got != want {
        let _ = fs::remove_file(part);
        let _ = fs::remove_file(info);
        return Err("The downloaded file is not the expected one (its SHA-256 does not match), so it was deleted; try again".into());
    }
    fs::rename(part, dest).map_err(|e| format!("Could not keep the download ({e})"))?;
    let _ = fs::remove_file(info);
    Ok(Fetched { sha256: got, bytes, checked_against: against, revision })
}

fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| url.to_string())
}

/// Take the named files out of a zip (a Python wheel is one) into `dir`. Each is written under a
/// temporary name and renamed once whole, so a half-written library is never left to be loaded.
pub fn unzip(zip_path: &Path, files: &[(&str, &str)], dir: &Path) -> Result<(), String> {
    let f = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| format!("The download is not a readable package ({e})"))?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for (inside, name) in files {
        let mut entry = z.by_name(inside).map_err(|_| format!("The package does not hold {inside}"))?;
        let tmp = dir.join(format!("{name}.tmp"));
        {
            let mut out = File::create(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("Could not unpack {inside} ({e})"))?;
            out.flush().map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The size of everything under `dir` (bytes).
pub fn dir_size(dir: &Path) -> u64 {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Seconds since 1970.
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Read a file as it is after `skip` bytes (for the tests).
#[cfg(test)]
fn tail(path: &Path, skip: u64) -> Vec<u8> {
    use std::io::Seek;
    let mut f = File::open(path).unwrap();
    f.seek(std::io::SeekFrom::Start(skip)).unwrap();
    let mut v = vec![];
    f.read_to_end(&mut v).unwrap();
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::Arc;

    /// A tiny web server on this computer: `/file` is the file (in ranges, if asked, stating its
    /// SHA-256 as Hugging Face does), `/moved` sends there, `/quiet` states nothing. It answers
    /// `limit` requests, cutting the first answer off after `cut` bytes if asked.
    fn serve(body: Vec<u8>, sha: Option<String>, cut: Option<usize>, limit: usize) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", l.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let mut seen = vec![];
            for (n, s) in l.incoming().take(limit).enumerate() {
                let mut s = s.unwrap();
                let mut r = BufReader::new(s.try_clone().unwrap());
                let mut first = String::new();
                r.read_line(&mut first).unwrap();
                let mut range = None;
                loop {
                    let mut line = String::new();
                    r.read_line(&mut line).unwrap();
                    if line.trim().is_empty() {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range = v.trim().trim_end_matches('-').parse::<usize>().ok();
                    }
                }
                let path = first.split_whitespace().nth(1).unwrap_or("").to_string();
                seen.push(format!("{path} {}", range.map(|r| r.to_string()).unwrap_or_default()));
                if path == "/moved" {
                    let tag = sha.as_ref().map(|h| format!("X-Linked-Etag: \"{h}\"\r\nX-Repo-Commit: abc123\r\n")).unwrap_or_default();
                    write!(s, "HTTP/1.1 302 Found\r\nLocation: /file\r\n{tag}Content-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                    continue;
                }
                let tag = if path == "/quiet" { String::new() } else { sha.as_ref().map(|h| format!("ETag: \"{h}\"\r\n")).unwrap_or_default() };
                let from = range.unwrap_or(0).min(body.len());
                let rest = &body[from..];
                let head = if range.is_some() {
                    format!("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {from}-{}/{}\r\n", body.len() - 1, body.len())
                } else {
                    "HTTP/1.1 200 OK\r\n".to_string()
                };
                write!(s, "{head}{tag}Content-Length: {}\r\nConnection: close\r\n\r\n", rest.len()).unwrap();
                let send = if n == 0 { cut.map(|c| c.min(rest.len())).unwrap_or(rest.len()) } else { rest.len() };
                let _ = s.write_all(&rest[..send]);
                let _ = s.flush();
                // an orderly end (a plain close can become a reset on some systems, losing what was sent)
                let _ = s.shutdown(std::net::Shutdown::Write);
            }
            seen
        });
        (addr, h)
    }

    fn local() -> reqwest::Client {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().unwrap()
    }

    fn body() -> (Vec<u8>, String) {
        let b: Vec<u8> = (0..300_000u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect();
        let h = hex(&Sha256::digest(&b));
        (b, h)
    }

    fn fresh(name: &str) -> PathBuf {
        let p = crate::recfile::scratch(name);
        for s in ["", ".part", ".part.json"] {
            let _ = fs::remove_file(with_suffix(&p, s));
        }
        p
    }

    #[test]
    fn the_expected_checksum_is_the_pinned_one_or_else_the_hosts() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        assert_eq!(expected_sha(Some(&a), None).unwrap(), (a.clone(), "pinned"));
        assert_eq!(expected_sha(Some(&a), Some(&a.to_uppercase())).unwrap(), (a.clone(), "pinned"));
        assert!(expected_sha(Some(&a), Some(&b)).is_err(), "a host offering another file is refused");
        assert_eq!(expected_sha(None, Some(&b)).unwrap(), (b.clone(), "host"));
        assert!(expected_sha(None, None).is_err(), "nothing to check against: not used");
        assert!(expected_sha(None, Some("not-a-hash")).is_err());
        let mut h = reqwest::header::HeaderMap::new();
        h.insert("x-linked-etag", format!("\"{b}\"").parse().unwrap());
        assert_eq!(host_sha(&h), Some(b.clone()));
        let mut h = reqwest::header::HeaderMap::new();
        h.insert("etag", "W/\"1a2b-3c\"".parse().unwrap());
        assert_eq!(host_sha(&h), None, "an ordinary ETag is not a checksum");
    }

    #[test]
    fn a_download_is_checked_against_the_sha_the_host_states_on_the_way() {
        let (b, h) = body();
        let (addr, server) = serve(b.clone(), Some(h.clone()), None, 2);
        let dest = fresh("fetch-moved.bin");
        let cancel = AtomicBool::new(false);
        let mut seen = vec![];
        let got = tauri::async_runtime::block_on(download(&local(), &format!("{addr}/moved"), &dest, None, None, &cancel, |g| seen.push(g.done))).unwrap();
        assert_eq!(got.sha256, h);
        assert_eq!(got.checked_against, "host");
        assert_eq!(got.revision.as_deref(), Some("abc123"));
        assert_eq!(fs::read(&dest).unwrap(), b);
        assert_eq!(*seen.last().unwrap(), b.len() as u64);
        assert!(!with_suffix(&dest, ".part").exists() && !with_suffix(&dest, ".part.json").exists());
        assert_eq!(server.join().unwrap(), vec!["/moved ".to_string(), "/file ".to_string()]);
        let _ = fs::remove_file(dest);
    }

    #[test]
    fn a_wrong_file_is_deleted_and_a_file_nobody_vouches_for_is_not_used() {
        let (b, h) = body();
        let mut wrong = h.clone();
        wrong.replace_range(0..1, if &h[0..1] == "0" { "1" } else { "0" });
        // pinned to something else: the bytes come, do not match, and are thrown away
        let (addr, server) = serve(b.clone(), None, None, 1);
        let dest = fresh("fetch-wrong.bin");
        let cancel = AtomicBool::new(false);
        let r = tauri::async_runtime::block_on(download(&local(), &format!("{addr}/quiet"), &dest, Some(&wrong), None, &cancel, |_| {}));
        assert!(r.unwrap_err().contains("SHA-256"));
        assert!(!dest.exists() && !with_suffix(&dest, ".part").exists());
        server.join().unwrap();
        // no pin and no stated checksum: refused before anything is written
        let (addr, server) = serve(b, None, None, 1);
        let r = tauri::async_runtime::block_on(download(&local(), &format!("{addr}/quiet"), &dest, None, None, &cancel, |_| {}));
        assert!(r.unwrap_err().contains("could not be checked"));
        assert!(!dest.exists());
        server.join().unwrap();
        // pinned to the right one, with a host that says nothing: fine
        let (b, h) = body();
        let (addr, server) = serve(b.clone(), None, None, 1);
        let got = tauri::async_runtime::block_on(download(&local(), &format!("{addr}/quiet"), &dest, Some(&h), Some(b.len() as u64), &cancel, |_| {})).unwrap();
        assert_eq!(got.checked_against, "pinned");
        server.join().unwrap();
        let _ = fs::remove_file(dest);
    }

    #[test]
    fn a_download_cut_off_goes_on_from_where_it_stopped() {
        let (b, h) = body();
        let (addr, server) = serve(b.clone(), Some(h.clone()), Some(100_000), 2);
        let dest = fresh("fetch-resume.bin");
        let cancel = AtomicBool::new(false);
        let url = format!("{addr}/file");
        let first = tauri::async_runtime::block_on(download(&local(), &url, &dest, None, None, &cancel, |_| {}));
        assert!(first.is_err(), "the first try is cut off");
        let part = with_suffix(&dest, ".part");
        let kept = fs::metadata(&part).unwrap().len();
        assert!(kept > 0 && kept <= 100_000, "{kept}");
        let got = tauri::async_runtime::block_on(download(&local(), &url, &dest, None, None, &cancel, |_| {})).unwrap();
        assert_eq!(got.sha256, h);
        assert_eq!(fs::read(&dest).unwrap(), b);
        // the second request asked only for the rest
        assert_eq!(server.join().unwrap(), vec!["/file ".to_string(), format!("/file {kept}")]);
        let _ = fs::remove_file(dest);
    }

    #[test]
    fn a_part_file_of_some_other_version_is_started_again() {
        let (b, h) = body();
        let dest = fresh("fetch-stale.bin");
        let part = with_suffix(&dest, ".part");
        fs::write(&part, vec![7u8; 5000]).unwrap();
        fs::write(with_suffix(&dest, ".part.json"), serde_json::to_vec(&PartInfo { url: "elsewhere".into(), host_sha: None }).unwrap()).unwrap();
        let (addr, server) = serve(b.clone(), Some(h.clone()), None, 1);
        let cancel = AtomicBool::new(false);
        let got = tauri::async_runtime::block_on(download(&local(), &format!("{addr}/file"), &dest, None, None, &cancel, |_| {})).unwrap();
        assert_eq!(got.sha256, h);
        assert_eq!(server.join().unwrap(), vec!["/file ".to_string()], "no range was asked for");
        assert_eq!(tail(&dest, 0), b);
        let _ = fs::remove_file(dest);
    }

    #[test]
    fn cancelling_keeps_what_was_fetched_for_next_time() {
        let (b, h) = body();
        let (addr, server) = serve(b, Some(h), None, 1);
        let dest = fresh("fetch-cancel.bin");
        let cancel = Arc::new(AtomicBool::new(false));
        let c2 = cancel.clone();
        // cancelled as soon as the download has begun
        let r = tauri::async_runtime::block_on(download(&local(), &format!("{addr}/file"), &dest, None, None, &cancel, move |_| c2.store(true, Ordering::Relaxed)));
        assert_eq!(r.unwrap_err(), "cancelled");
        assert!(!dest.exists());
        assert!(with_suffix(&dest, ".part.json").exists());
        server.join().unwrap();
        let _ = fs::remove_file(with_suffix(&dest, ".part"));
        let _ = fs::remove_file(with_suffix(&dest, ".part.json"));
    }

    #[test]
    fn named_files_are_taken_out_of_a_package() {
        let dir = crate::recfile::scratch("unzip").with_file_name("unzip-out");
        let _ = fs::remove_dir_all(&dir);
        let zp = dir.with_file_name("pkg.zip");
        {
            let mut z = zip::ZipWriter::new(File::create(&zp).unwrap());
            let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            z.start_file("onnxruntime/capi/lib.bin", o).unwrap();
            z.write_all(&[1u8; 10_000]).unwrap();
            z.start_file("onnxruntime/LICENSE", o).unwrap();
            z.write_all(b"MIT").unwrap();
            z.finish().unwrap();
        }
        unzip(&zp, &[("onnxruntime/capi/lib.bin", "lib.bin"), ("onnxruntime/LICENSE", "LICENSE.txt")], &dir).unwrap();
        assert_eq!(fs::read(dir.join("lib.bin")).unwrap(), vec![1u8; 10_000]);
        assert_eq!(fs::read(dir.join("LICENSE.txt")).unwrap(), b"MIT");
        assert!(unzip(&zp, &[("missing", "x")], &dir).unwrap_err().contains("missing"));
        assert_eq!(dir_size(&dir), 10_003);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_file(zp);
    }
}

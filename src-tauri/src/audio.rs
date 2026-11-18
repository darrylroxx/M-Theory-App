//! The native audio side. For now it lists the audio interfaces the computer can see, through
//! every audio system it has (on Windows: ASIO drivers and Windows audio), so the app can show
//! that it has found the Scarlett and how many inputs and outputs it offers.

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Port {
    /// how many channels (inputs or outputs) the device offers at most
    pub channels: u16,
    /// the lowest and highest sample rates it offers
    pub min_rate: u32,
    pub max_rate: u32,
}

#[derive(Serialize, Debug)]
pub struct Device {
    pub name: String,
    pub input: Option<Port>,
    pub output: Option<Port>,
    pub default_rate: Option<u32>,
}

#[derive(Serialize, Debug)]
pub struct Host {
    /// "ASIO", "WASAPI", "ALSA", "CoreAudio" …
    pub name: String,
    pub devices: Vec<Device>,
    /// set when the audio system could not be opened or listed
    pub error: Option<String>,
}

/// The widest range a list of configurations covers: most channels, lowest and highest rate.
fn widest<I: Iterator<Item = cpal::SupportedStreamConfigRange>>(it: I) -> Option<Port> {
    it.fold(None, |acc: Option<Port>, c| {
        let p = Port { channels: c.channels(), min_rate: c.min_sample_rate(), max_rate: c.max_sample_rate() };
        Some(match acc {
            None => p,
            Some(a) => Port { channels: a.channels.max(p.channels), min_rate: a.min_rate.min(p.min_rate), max_rate: a.max_rate.max(p.max_rate) },
        })
    })
}

fn describe(d: &cpal::Device) -> Device {
    let input = d.supported_input_configs().ok().and_then(widest);
    let output = d.supported_output_configs().ok().and_then(widest);
    let default_rate = d.default_input_config().or_else(|_| d.default_output_config()).ok().map(|c| c.sample_rate());
    Device { name: d.to_string(), input, output, default_rate }
}

/// Every audio system and every device in it.
pub fn list() -> Vec<Host> {
    cpal::available_hosts()
        .into_iter()
        .map(|id| {
            let name = id.name().to_string();
            match cpal::host_from_id(id) {
                Err(e) => Host { name, devices: vec![], error: Some(e.to_string()) },
                Ok(host) => match host.devices() {
                    Err(e) => Host { name, devices: vec![], error: Some(e.to_string()) },
                    Ok(devs) => Host { name, devices: devs.map(|d| describe(&d)).collect(), error: None },
                },
            }
        })
        .collect()
}

/// The UI asks for the list. Opening drivers can be slow, so it runs off the main thread.
#[tauri::command]
pub async fn audio_devices() -> Vec<Host> {
    tauri::async_runtime::spawn_blocking(|| {
        let _driver = crate::engine::driver_lock();
        list()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_never_panics_and_names_every_host() {
        let hosts = list();
        assert_eq!(hosts.len(), cpal::available_hosts().len());
        assert!(hosts.iter().all(|h| !h.name.is_empty()));
    }

    #[test]
    fn widest_takes_the_most_channels_and_the_full_rate_range() {
        use cpal::{SampleFormat, SupportedBufferSize, SupportedStreamConfigRange};
        let r = |ch, lo, hi| SupportedStreamConfigRange::new(ch, lo, hi, SupportedBufferSize::Unknown, SampleFormat::I32);
        let p = widest(vec![r(1, 44_100, 48_000), r(2, 88_200, 192_000)].into_iter()).unwrap();
        assert_eq!(p, Port { channels: 2, min_rate: 44_100, max_rate: 192_000 });
        assert!(widest(std::iter::empty()).is_none());
    }
}

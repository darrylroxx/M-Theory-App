//! The desktop app: the same pages as the web app, plus a native audio engine.

mod audio;
mod meter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![audio::audio_devices, meter::meter_start, meter::meter_stop])
        .run(tauri::generate_context!())
        .expect("M-Theory could not start");
}

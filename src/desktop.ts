/**
 * The desktop app (Windows, built with Tauri) has a native side the web version does not:
 * updates that install themselves, and the audio engine that talks to the interface.
 * Everything here is loaded only inside the desktop app, so the web version stays as it is.
 */

/** Is this page running inside the desktop app? */
export const isDesktop = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface AudioPort { channels: number; min_rate: number; max_rate: number }
export interface AudioDevice { name: string; input: AudioPort | null; output: AudioPort | null; default_rate: number | null }
export interface AudioHost { name: string; devices: AudioDevice[]; error: string | null }

/** Every audio system the computer has (ASIO, Windows audio …) and the devices in each. */
export async function audioDevices(): Promise<AudioHost[]> {
  if (!isDesktop()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AudioHost[]>("audio_devices");
}

/** The app's own name ("M-Theory" or "M-Theory Draft") and version. */
export async function appInfo(): Promise<{ name: string; version: string } | null> {
  if (!isDesktop()) return null;
  const app = await import("@tauri-apps/api/app");
  return { name: await app.getName(), version: await app.getVersion() };
}

export interface Update {
  version: string;
  notes?: string;
  /** download it, install it and start the new version */
  install: (progress?: (done: number, total: number | null) => void) => Promise<void>;
}

/** Is a newer version waiting? (null: none, or not the desktop app, or offline.) */
export async function checkUpdate(): Promise<Update | null> {
  if (!isDesktop()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    if (!u) return null;
    return {
      version: u.version,
      notes: u.body ?? undefined,
      install: async (progress) => {
        let done = 0;
        let total: number | null = null;
        await u.downloadAndInstall((e) => {
          if (e.event === "Started") total = e.data.contentLength ?? null;
          if (e.event === "Progress") done += e.data.chunkLength;
          progress?.(done, total);
        });
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch {
    return null;
  }
}

export interface Levels { peak: number[]; rms: number[] }
export interface Opened { host: string; device: string; channels: number; sample_rate: number; format: string }

/** Open an input device and hear about its levels about thirty times a second. */
export async function meterStart(host: string, device: string, onLevels: (l: Levels) => void): Promise<Opened> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const ch = new Channel<Levels>();
  ch.onmessage = onLevels;
  return invoke<Opened>("meter_start", { host, device, levels: ch });
}
export async function meterStop(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("meter_stop");
}

// ── the recording engine ──
export interface EngineStatus { peak: number[]; rms: number[]; pos: number; count_in: number; length: number; running: boolean; reduction: number }
export interface EngineOpened { host: string; device: string; rate: number; inputs: number; outputs: number; format: string }

async function core() {
  return import("@tauri-apps/api/core");
}
/** Open the interface's inputs and outputs together, and hear about levels and position. */
export async function engineOpen(host: string, device: string, onStatus: (s: EngineStatus) => void): Promise<EngineOpened> {
  const { invoke, Channel } = await core();
  const ch = new Channel<EngineStatus>();
  ch.onmessage = onStatus;
  return invoke<EngineOpened>("engine_open", { host, deviceName: device, status: ch });
}
export async function engineClose(): Promise<void> {
  if (!isDesktop()) return;
  await (await core()).invoke("engine_close");
}
export async function engineSet(o: { monitor: boolean; input: number; fx: import("./audio/vocalfx").VocalFx; backingGain: number; clickGain: number; clickOn: boolean }): Promise<void> {
  await (await core()).invoke("engine_set", o);
}
/** The song to sing over: left and right, at the engine's rate. */
export async function engineBacking(left: Float32Array, right: Float32Array): Promise<number> {
  const inter = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    inter[2 * i] = left[i];
    inter[2 * i + 1] = right[i];
  }
  return (await core()).invoke<number>("engine_backing", new Uint8Array(inter.buffer));
}
export async function engineStart(o: { bpm: number; countInBeats: number; beatsPerBar: number; record: boolean; name: string }): Promise<string | null> {
  return (await core()).invoke<string | null>("engine_start", o);
}
export async function engineStop(): Promise<import("./song/takes").Recorded | null> {
  return (await core()).invoke("engine_stop");
}
/** The vocal chain over a whole recording again (after its settings changed): the new file. */
export async function fxRender(dry: string, fx: import("./audio/vocalfx").VocalFx): Promise<string> {
  return (await core()).invoke<string>("fx_render", { dry, fx });
}
export async function readTake(path: string): Promise<ArrayBuffer> {
  return (await core()).invoke<ArrayBuffer>("read_take", { path });
}

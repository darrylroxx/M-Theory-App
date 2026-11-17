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

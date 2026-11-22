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

/** One value for every input of the device, in order (levels are measured for the first 32). */
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
/**
 * `latency`: how late the singer hears themselves, measured from the driver (ms; 0 until known).
 * While recording: `recorded` frames are in the file, `room` more fit before it is as big as a
 * WAV can be, `free` bytes are left on the disk, and `full` says it has stopped taking sound.
 * `render`: how far the vocal sound is in being put on a recording (0..1; 0 when it is not).
 * `peak`, `rms`: one value for every input of the interface, in order (measured for the first 32).
 * `length`: the loop's length in frames; 0 while the song is played once (`engineStart`'s `once`): it has no loop.
 * `reduction`, `limit`: the vocal chain's two meters; they rest at 0 while a pair of inputs is chosen (a pair has no chain).
 */
export interface EngineStatus { peak: number[]; rms: number[]; pos: number; count_in: number; length: number; running: boolean; reduction: number; limit?: number; invalid: boolean; xruns: number; block: number; latency: number; recorded?: number; room?: number; free?: number | null; full?: boolean; render?: number; app_gaps?: number }
export interface EngineOpened { host: string; device: string; rate: number; inputs: number; outputs: number; format: string; min_buffer: number | null; max_buffer: number | null }

async function core() {
  return import("@tauri-apps/api/core");
}
/**
 * Opening, closing, starting and stopping happen one after another, in the order they were
 * asked for: a close from a page that is going away can never land after the open that follows it.
 */
let line: Promise<unknown> = Promise.resolve();
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const p = line.then(fn, fn);
  line = p.catch(() => undefined);
  return p;
}
/** Open the interface's inputs and outputs together, and hear about levels and position. */
/** `buffer`: the buffer size to ask the driver for (frames), or null for the driver's own setting. */
export async function engineOpen(host: string, device: string, buffer: number | null, onStatus: (s: EngineStatus) => void): Promise<EngineOpened> {
  const { invoke, Channel } = await core();
  const ch = new Channel<EngineStatus>();
  ch.onmessage = onStatus;
  return inTurn(() => invoke<EngineOpened>("engine_open", { host, deviceName: device, buffer, status: ch }));
}
/**
 * What the engine reports when a recording stops: `Recorded` (song/takes.ts), and how many channels its files have.
 * `channels`: 1, one input, a mono file; 2, a pair of inputs, a stereo file with the first input on the left.
 * (When it is not there: one input.) `frames`, `offset`, `count_in`,
 * `loop_frames`, `dropped` and `padded` are frames whatever the channels. `loop_frames` is 0 for a recording
 * started with `once`: the whole of it is one take, from `offset + count_in` (plus the timing nudge) to its end.
 */
export type EngineRecorded = import("./song/takes").Recorded & { channels?: number };
/**
 * Close the interface. A recording still going (the driver was reset mid-session) comes back,
 * dry, so its takes can be kept: put the vocal sound on it with `fxRender`.
 */
export async function engineClose(): Promise<EngineRecorded | null> {
  if (!isDesktop()) return null;
  const { invoke } = await core();
  return (await inTurn(() => invoke<EngineRecorded | null>("engine_close"))) ?? null;
}
/**
 * What is recorded and heard. `input`: which input, counted from 0.
 * `inputB` (left out, or null: one input, a voice, as ever): the second input of a pair, counted from 0. `input` is
 * then the left side and `inputB` the right. A pair is heard as it is, left and right, when `monitor` is on: none of
 * the vocal chain but its Output level (`fx.level`, whatever `fx.on` says). And the next recording started is a
 * stereo file: what counts is the last `engineSet` that was sent before `engineStart`.
 */
export async function engineSet(o: { monitor: boolean; input: number; inputB?: number | null; fx: import("./audio/vocalfx").VocalFx; backingGain: number; clickGain: number; clickOn: boolean }): Promise<void> {
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
/**
 * The app's own sound comes through the engine from now on, at `rate` (the page's), or no longer
 * (null: what is queued fades out). See audio/through.ts.
 */
export async function engineApp(rate: number | null): Promise<void> {
  const { invoke } = await core();
  await inTurn(() => invoke("engine_app", { rate }));
}
/** A block of the app's own sound for the engine: left and right interleaved, as raw 32-bit floats. Returns the frames it has queued. */
export async function engineFeed(bytes: Uint8Array): Promise<number> {
  return (await core()).invoke<number>("engine_feed", bytes);
}
/**
 * Start the count-in and the loop. `bars`: the beats in each bar of the loop, so the click accents every bar in its own meter.
 * `once` (left out: no, the song goes round and round as ever): the song handed over with `engineBacking` is played
 * once, then silence, and a recording goes on until `engineStop`. The status then reports a `length` of 0 (`pos` and
 * `count_in` as ever) and the recording comes back with `loop_frames` 0. The click, when it is on while recording,
 * goes on past the song's end, in the meter of the last bar in `bars`.
 */
export async function engineStart(o: { bpm: number; countInBeats: number; beatsPerBar: number; bars?: number[]; record: boolean; name: string; once?: boolean }): Promise<string | null> {
  const { invoke } = await core();
  return inTurn(() => invoke<string | null>("engine_start", o));
}
/**
 * Stop; a recording is closed and comes back with its version through the vocal chain `fx`. (A pair's second file is
 * the pair again, left and right, at the chain's Output level `fx.level`: at 0 dB the same sound as the first.)
 */
export async function engineStop(fx: import("./audio/vocalfx").VocalFx): Promise<EngineRecorded | null> {
  const { invoke } = await core();
  return inTurn(() => invoke("engine_stop", { fx }));
}
/** The vocal chain over a whole recording again (after its settings changed): the new file. (A stereo recording: its Output level only.) */
export async function fxRender(dry: string, fx: import("./audio/vocalfx").VocalFx): Promise<string> {
  return (await core()).invoke<string>("fx_render", { dry, fx });
}
export async function readTake(path: string): Promise<ArrayBuffer> {
  return (await core()).invoke<ArrayBuffer>("read_take", { path });
}
/**
 * One take of a recording: `frames` frames from `start`, as a small WAV of its own (a part before the file's start
 * comes back as silence). The WAV has as many channels as the file: one for a voice's dry file, two for its version
 * through the vocal chain and for both files of a pair.
 */
export async function readTakeRange(path: string, start: number, frames: number): Promise<ArrayBuffer> {
  return (await core()).invoke<ArrayBuffer>("read_take_range", { path, start: Math.round(start), frames: Math.max(0, Math.round(frames)) });
}

/**
 * The keyboard instruments that ship with the app, ready to put on a track.
 *
 * - The grand piano: a Sampler on the pack in public/keys/piano/, a reduced Salamander Grand Piano
 *   V3 (CC BY 3.0; see LICENSE.md beside it and NOTICE.md): every minor third across the 88 keys,
 *   at five strengths, with the dampers' own sound. About 19 MB to download; the first layer (about
 *   4 MB) is enough to play every key.
 * - The electric piano: mda ePiano's tine piano (MIT), 845 KB, in public/keys/epiano/.
 *
 * Both work on any audio context: the live one, or an OfflineAudioContext for a WAV bounce (call
 * the piano's prepare() with the song's notes, or the electric piano's load(), before rendering).
 */
import { EPiano, type EPianoOptions } from "./epiano";
import { Sampler, type SamplerOptions } from "./sampler";

/** Where the packs are, relative to the app's page. */
export const PIANO_PATH = "keys/piano/";
export const EPIANO_PATH = "keys/epiano/";

/** A pack's full URL (it follows the page, so it works from any sub-path, the PWA and the desktop app). */
export function packUrl(path: string): string {
  const base = typeof document !== "undefined" ? document.baseURI : "http://localhost/";
  return new URL(path, base).href;
}

export const pianoUrl = () => packUrl(PIANO_PATH);

/** A grand piano on this audio context (live, or offline for a WAV bounce). Call load() before playing. */
export function createPiano(ctx: BaseAudioContext, opts: SamplerOptions = {}): Sampler {
  return new Sampler(ctx, pianoUrl(), opts);
}

/** An electric piano on this audio context. Call load() before playing. */
export function createElectricPiano(ctx: BaseAudioContext, opts: EPianoOptions = {}): EPiano {
  return new EPiano(ctx, packUrl(EPIANO_PATH), opts);
}

/** The keyboards a track can choose, in the order to offer them. */
export const KEYS = [
  { id: "piano", name: "Piano" },
  { id: "epiano", name: "Electric piano" },
] as const;
export type KeysId = (typeof KEYS)[number]["id"];

/** One of the keyboards by id. */
export function createKeys(id: KeysId, ctx: BaseAudioContext): Sampler | EPiano {
  return id === "epiano" ? createElectricPiano(ctx) : createPiano(ctx);
}

/**
 * Ask the browser to keep the downloaded samples when the disk runs low. Chromium and Safari answer
 * without asking the user; returns whether the storage is now kept.
 */
export async function keepSamples(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

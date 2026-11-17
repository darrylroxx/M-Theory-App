/** Recorded takes, read from disk and decoded once, ready to play with the song. */
import { audioContext } from "./context";
import { readTake } from "../desktop";

const ready = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

export const takeBuffer = (path: string): AudioBuffer | undefined => ready.get(path);

export function loadTake(path: string): Promise<AudioBuffer | null> {
  const have = ready.get(path);
  if (have) return Promise.resolve(have);
  let p = loading.get(path);
  if (!p) {
    p = readTake(path)
      .then((bytes) => audioContext().decodeAudioData(bytes))
      .then((buf) => {
        ready.set(path, buf);
        return buf;
      })
      .catch(() => null)
      .finally(() => loading.delete(path));
    loading.set(path, p);
  }
  return p;
}

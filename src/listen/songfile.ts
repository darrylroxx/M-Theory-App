/**
 * A song from a file: any recording the browser can read (WAV, MP3, M4A, FLAC, OGG) can be
 * played through the canvas.
 *
 * Because the whole recording is in memory, it does not have to be listened to through the
 * speakers' path: the ear reads the samples themselves, just ahead of where the music is, so
 * the paint is exactly in time with what is heard.
 */
import { master } from "../audio/mix";
import { Ear, type Frame } from "./ear";

export interface Song {
  name: string;
  buffer: AudioBuffer;
  /** left and right as one */
  mono: Float32Array;
  duration: number;
  /** how loud its loudest parts are, as the ear measures (so the whole song is painted on one scale) */
  ref: number;
}

/** Left and right (and any more) as one channel. */
export function toMono(buffer: { numberOfChannels: number; length: number; getChannelData(c: number): Float32Array }): Float32Array {
  const mono = new Float32Array(buffer.length);
  const n = buffer.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += d[i] / n;
  }
  return mono;
}

/** How loud the loudest parts of a recording are: the ear is run over twenty stretches spread through it. */
export function loudest(mono: Float32Array, sr: number): number {
  const len = Math.min(mono.length, Math.round(sr * 0.6));
  const spots = Math.max(1, Math.min(20, Math.floor(mono.length / len)));
  const found: number[] = [];
  for (let k = 0; k < spots; k++) {
    const at = Math.floor(((k + 0.5) / spots) * (mono.length - len));
    const ear = new Ear(sr);
    ear.push(mono.subarray(at, at + len));
    found.push(ear.loudest);
  }
  found.sort((a, b) => a - b);
  // not the very loudest stretch (one crash should not make the rest of the song faint): the one a fifth of the way down
  return found[Math.max(0, Math.floor(found.length * 0.8) - 1)] ?? -54;
}

export async function openSong(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }, c: BaseAudioContext): Promise<Song> {
  const buffer = await c.decodeAudioData(await file.arrayBuffer());
  const mono = toMono(buffer);
  return { name: file.name.replace(/\.[a-z0-9]+$/i, ""), buffer, mono, duration: buffer.duration, ref: loudest(mono, buffer.sampleRate) };
}

/** Reads a song a little at a time, in step with where it is being played. */
export class Reader {
  private ear: Ear;
  private at = 0;
  constructor(private readonly song: Pick<Song, "mono" | "ref"> & { buffer: { sampleRate: number } }, from = 0) {
    this.ear = new Ear(song.buffer.sampleRate, song.ref);
    this.seek(from);
  }
  /** Start again from `t` seconds (the ear is given a third of a second before it to settle on). */
  seek(t: number) {
    const sr = this.song.buffer.sampleRate;
    this.ear = new Ear(sr, this.song.ref);
    const start = Math.max(0, Math.round((t - 0.35) * sr));
    this.at = start;
    this.offset = start / sr;
    this.from = t;
  }
  private offset = 0;
  private from = 0;
  /** Everything heard up to `t` seconds of the song since the last call. */
  upTo(t: number, out: Frame[] = []): Frame[] {
    const { mono, buffer } = this.song;
    const end = Math.min(mono.length, Math.round(t * buffer.sampleRate));
    if (end <= this.at) return out;
    const first = out.length;
    this.ear.push(mono.subarray(this.at, end), out);
    this.at = end;
    let keep = first;
    for (let i = first; i < out.length; i++) {
      out[i].t += this.offset;
      // what the ear heard while settling is not for painting
      if (out[i].t >= this.from - 0.02) out[keep++] = out[i];
    }
    out.length = keep;
    return out;
  }
}

/** Plays a song through the app's speakers path. */
export class Player {
  private node: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  onEnd: (() => void) | null = null;
  constructor(private readonly c: AudioContext) {}
  get playing() {
    return this.node !== null;
  }
  play(song: Song, from = 0) {
    this.stop();
    const node = this.c.createBufferSource();
    node.buffer = song.buffer;
    node.connect(master(this.c));
    this.offset = Math.max(0, Math.min(song.duration, from));
    this.startedAt = this.c.currentTime + 0.03;
    node.start(this.startedAt, this.offset);
    node.onended = () => {
      if (this.node === node) {
        this.node = null;
        this.onEnd?.();
      }
    };
    this.node = node;
  }
  stop() {
    const n = this.node;
    this.node = null;
    if (n) {
      n.onended = null;
      try {
        n.stop();
      } catch {
        // it had not started
      }
      n.disconnect();
    }
  }
  /** Where the song is, in seconds, as it is heard (null = not playing). */
  position(): number | null {
    if (!this.node) return null;
    const heard = this.c.currentTime - (this.c.outputLatency || 0);
    return Math.max(this.offset, this.offset + heard - this.startedAt);
  }
}

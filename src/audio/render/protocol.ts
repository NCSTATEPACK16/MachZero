/**
 * The render Worker's messages (IMPLEMENTATION §M6a, §M6b), shared by the Worker and the client.
 */
import type { RenderedSong } from '../dsp/render';
import type { MusicId } from '../songs/format';

export interface PresetRequest {
  kind: 'presets';
  req: number;
  ids: string[];
  sampleRate: number;
}

export interface PresetReply {
  kind: 'presets';
  req: number;
  ids: string[];
  data: Float32Array[];
  ms: number;
}

export interface SongRequest {
  kind: 'song';
  req: number;
  id: MusicId;
  sampleRate: number;
}

export type SongReply = { kind: 'song'; req: number; ok: true; song: RenderedSong } | { kind: 'song'; req: number; ok: false; error: string };

/** The transferable buffers of a rendered song. */
export function songTransfer(s: RenderedSong): ArrayBuffer[] {
  return [...(s.intro ?? []), ...s.loop, ...(s.lift ? [s.lift] : [])].map((b) => b.buffer as ArrayBuffer);
}


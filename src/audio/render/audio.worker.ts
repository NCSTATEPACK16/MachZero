/**
 * The render Worker (IMPLEMENTATION §M6a, §M6b, decision A): renders the SFX presets and the songs off the main
 * thread, one request at a time (the client queues them), and posts the samples back as transferables. A song it
 * cannot render answers `{ ok: false, error }`.
 */
import { renderSong } from '../dsp/render';
import { PRESETS, renderPreset, type SfxPreset } from '../sfx/presets';
import { SONGS } from '../songs';
import { songTransfer, type PresetReply, type PresetRequest, type SongReply, type SongRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as PresetRequest | SongRequest;
  if (msg?.kind === 'presets') {
    const t0 = performance.now();
    const ids: string[] = [];
    const data: Float32Array[] = [];
    for (const id of msg.ids) {
      const preset = (PRESETS as Record<string, SfxPreset>)[id];
      if (!preset) continue;
      ids.push(id);
      data.push(renderPreset(preset, msg.sampleRate));
    }
    const reply: PresetReply = { kind: 'presets', req: msg.req, ids, data, ms: performance.now() - t0 };
    scope.postMessage(reply, data.map((d) => d.buffer as ArrayBuffer));
    return;
  }
  if (msg?.kind === 'song') {
    const def = SONGS[msg.id];
    if (!def) {
      const reply: SongReply = { kind: 'song', req: msg.req, ok: false, error: `${msg.id} is not written` };
      scope.postMessage(reply, []);
      return;
    }
    try {
      const song = renderSong(def, { sampleRate: msg.sampleRate });
      const reply: SongReply = { kind: 'song', req: msg.req, ok: true, song };
      scope.postMessage(reply, songTransfer(song));
    } catch (err) {
      const reply: SongReply = { kind: 'song', req: msg.req, ok: false, error: String(err) };
      scope.postMessage(reply, []);
    }
  }
};

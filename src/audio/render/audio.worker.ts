/**
 * The render Worker (IMPLEMENTATION §M6a, decision A): renders the SFX presets off the main thread and posts the
 * samples back as transferables. M6b adds songs, stingers and ambience to the same protocol.
 */
import { PRESETS, renderPreset, type SfxPreset } from '../sfx/presets';
import type { PresetReply, PresetRequest } from './RenderClient';

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as PresetRequest;
  if (!msg || msg.kind !== 'presets') return;
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
};

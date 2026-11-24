/**
 * The render fallback (IMPLEMENTATION §M6a, §M6b): what the main thread needs to render presets and songs when the
 * Worker cannot. A lazy chunk, loaded only when the Worker fails, so the page itself carries none of it.
 */
export { PRESETS, renderPreset } from '../sfx/presets';
export { SongRender } from '../dsp/render';
export { SONGS } from '../songs';

export type FallbackModule = typeof import('./fallback');

/**
 * Authored tracks (SPEC §6), one per world. The JSON files are written by scripts/track-design.mjs from the
 * hand-designed segment lists there; `npm run tracks:check` validates them and `npm run tracks:preview`
 * draws docs/v2/tracks/<id>.svg.
 */
import type { TrackDefinition } from '../../core/contracts';
import neonBay from './neon-bay.json';
import sunsetMesa from './sunset-mesa.json';

export const TRACK_DEFS: Readonly<Record<string, TrackDefinition>> = {
  'neon-bay': neonBay as TrackDefinition,
  'sunset-mesa': sunsetMesa as TrackDefinition,
};

export function trackDefById(id: string): TrackDefinition | undefined {
  return TRACK_DEFS[id];
}

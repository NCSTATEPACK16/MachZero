/**
 * The five worlds (SPEC §6, IMPLEMENTATION Appendix B), in World Tour order. A world is `built` once its
 * authored track, theme and scenery exist; the others show as locked "coming soon" cards.
 */
import type { TrackPalette } from '../track/TrackMesh';

export type WorldId = 'neon-bay' | 'sunset-mesa' | 'cryo-station' | 'jade-ruins' | 'orbital-ring';

export interface WorldDef {
  id: WorldId;
  /** 1-based World Tour order. */
  order: number;
  name: string;
  /** One line for the world card. */
  tagline: string;
  gimmick: string;
  trackId: string;
  /** Track neon colours. */
  palette: TrackPalette;
  /** Card / UI accent colours (CSS hex). */
  ui: { from: string; to: string };
  built: boolean;
}

export const WORLDS: readonly WorldDef[] = [
  {
    id: 'neon-bay',
    order: 1,
    name: 'NEON BAY',
    tagline: 'Synthwave harbour at midnight',
    gimmick: '360° CORKSCREW',
    trackId: 'neon-bay',
    palette: { left: 0x19f0ff, right: 0xff2bd6, accent: 0xffb319, pit: 0x7dff3a },
    ui: { from: '#19f0ff', to: '#ff2bd6' },
    built: true,
  },
  {
    id: 'sunset-mesa',
    order: 2,
    name: 'SUNSET MESA',
    tagline: 'Chrome canyon under an airbrushed sky',
    gimmick: 'JUMP RAMPS',
    trackId: 'sunset-mesa',
    palette: { left: 0xffa13a, right: 0xff4f6e, accent: 0xfff06a, pit: 0x6affc8 },
    ui: { from: '#ffb347', to: '#ff4f6e' },
    built: true,
  },
  {
    id: 'cryo-station',
    order: 3,
    name: 'CRYO STATION',
    tagline: 'Frosted tubes on an ice planet',
    gimmick: 'FULL-PIPE',
    trackId: 'cryo-station',
    palette: { left: 0x7fe8ff, right: 0xb98cff, accent: 0xffffff, pit: 0x7dff3a },
    ui: { from: '#7fe8ff', to: '#b98cff' },
    built: false,
  },
  {
    id: 'jade-ruins',
    order: 4,
    name: 'JADE RUINS',
    tagline: 'Neon temple deep in the jungle',
    gimmick: 'SPLIT PATH',
    trackId: 'jade-ruins',
    palette: { left: 0x2bffa8, right: 0xffd23a, accent: 0xb04dff, pit: 0x7dff3a },
    ui: { from: '#2bffa8', to: '#ffd23a' },
    built: false,
  },
  {
    id: 'orbital-ring',
    order: 5,
    name: 'ORBITAL RING',
    tagline: 'A station ring above the Earth',
    gimmick: 'LOOP + LOW-G',
    trackId: 'orbital-ring',
    palette: { left: 0xf4f7ff, right: 0x2b8cff, accent: 0xff3344, pit: 0x7dff3a },
    ui: { from: '#f4f7ff', to: '#2b8cff' },
    built: false,
  },
];

export function worldById(id: string): WorldDef | undefined {
  return WORLDS.find((w) => w.id === id);
}

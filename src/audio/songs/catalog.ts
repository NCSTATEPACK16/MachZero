/**
 * The song catalogue (IMPLEMENTATION §M6.4): the only song data the page carries (no notes). `ready` marks the pieces
 * written so far; the registry (`songs/index.ts`, Worker side) holds exactly the ready ones, which a test checks,
 * along with every title, tempo and key.
 */
import type { WorldId } from '../../content/worlds';
import type { MusicId, SongKind } from './format';

export interface CatalogEntry {
  id: MusicId;
  title: string;
  bpm: number;
  key: string;
  kind: SongKind;
  worldId?: WorldId;
  /** Written and in the registry (M6b: the menu theme, Neon Bay, Orbital Ring). */
  ready: boolean;
}

const world = (id: WorldId, title: string, bpm: number, key: string, ready = false): CatalogEntry => ({ id, title, bpm, key, kind: 'world', worldId: id, ready });
const sting = (id: MusicId, title: string): CatalogEntry => ({ id, title, bpm: 120, key: 'C major', kind: 'stinger', ready: false });

export const CATALOG: readonly CatalogEntry[] = [
  { id: 'menu', title: 'MACHZERO — "STARTING GRID"', bpm: 108, key: 'F major', kind: 'menu', ready: false },
  world('neon-bay', 'NEON BAY — "GRID RUNNER"', 118, 'A minor'),
  world('sunset-mesa', 'SUNSET MESA', 124, 'D Dorian'),
  world('cryo-station', 'CRYO STATION', 110, 'E minor'),
  world('jade-ruins', 'JADE RUINS', 128, 'G Phrygian'),
  world('orbital-ring', 'ORBITAL RING — "LOW ORBIT"', 96, 'C Lydian'),
  world('tempest-spire', 'TEMPEST SPIRE', 132, 'F# minor'),
  world('cinder-forge', 'CINDER FORGE', 140, 'C Phrygian'),
  world('abyss-line', 'ABYSS LINE', 104, 'D Mixolydian'),
  { id: 'results', title: 'RESULTS', bpm: 112, key: 'C major', kind: 'results', ready: false },
  sting('win', 'WIN'),
  sting('podium', 'PODIUM'),
  sting('finish', 'FINISH'),
  sting('record', 'NEW RECORD'),
  sting('unlock', 'UNLOCK'),
  sting('trophy', 'TROPHY'),
  sting('medal-bronze', 'BRONZE MEDAL'),
  sting('medal-silver', 'SILVER MEDAL'),
  sting('medal-gold', 'GOLD MEDAL'),
  sting('champion', 'CHAMPION'),
];

export const catalogEntry = (id: MusicId): CatalogEntry | undefined => CATALOG.find((e) => e.id === id);

/** The world's song id (world songs share their world's id). */
export const songForWorld = (worldId: WorldId): MusicId => worldId;

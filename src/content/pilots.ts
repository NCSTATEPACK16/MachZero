/**
 * The 7 rival pilots (SPEC §5.3) and the race-field builder: player loadout + 7 rivals at
 * tier-appropriate parts → 8 ShipDefinitions with resolved stats.
 */
import type { AIPersonality, AITier, Loadout, PartSlot, PartTier, ShipDefinition, ShipLivery } from '../core/contracts';
import { resolveStats } from '../physics/ShipStatsResolver';
import { chassisById } from './ships';

export interface PilotDef {
  id: string;
  name: string;
  chassisId: string;
  /** v1 AI personality (tier-specific tuning arrives in M5). */
  personality: AIPersonality;
  /** Flavour shown in menus; M5 maps it onto tier tuning. */
  style: string;
  catchphrase: string;
  livery: ShipLivery;
}

export const RIVALS: readonly PilotDef[] = [
  { id: 'nova', name: 'NOVA BLAZE', chassisId: 'dart', personality: 'aggressive', style: 'aggressive', catchphrase: 'Try to keep up!', livery: { primary: 0xff3b1f, secondary: 0x1a1a1a, glow: 0xffb319 } },
  { id: 'ziggy', name: 'CAPTAIN ZIGGY', chassisId: 'comet', personality: 'steady', style: 'steady', catchphrase: 'Smooth is fast, cadet.', livery: { primary: 0x1fb5ff, secondary: 0xf4f7ff, glow: 0x19f0ff } },
  { id: 'rex', name: 'REX THUNDER', chassisId: 'titan', personality: 'aggressive', style: 'rams', catchphrase: 'Coming through!', livery: { primary: 0xd81b2a, secondary: 0x2b2b35, glow: 0xff5a2b } },
  { id: 'pixel', name: 'PIXEL', chassisId: 'wisp', personality: 'erratic', style: 'erratic (robot)', catchphrase: 'BEEP. VICTORY. PROBABLE.', livery: { primary: 0x7dff3a, secondary: 0x14161f, glow: 0x7dff3a } },
  { id: 'luna', name: 'LUNA FROST', chassisId: 'arrow', personality: 'steady', style: 'precise', catchphrase: "I don't miss apexes.", livery: { primary: 0xcfe8ff, secondary: 0x3a4a8a, glow: 0x8ad8ff } },
  { id: 'tia', name: 'TURBO TIA', chassisId: 'dart', personality: 'aggressive', style: 'boost-happy', catchphrase: 'Boost now, think later!', livery: { primary: 0xff2bd6, secondary: 0xf2b705, glow: 0xff2bd6 } },
  { id: 'sparky', name: 'OLD SPARKY', chassisId: 'bastion', personality: 'steady', style: 'veteran', catchphrase: 'Been racing since before hover was cool.', livery: { primary: 0x8a6a3a, secondary: 0xe8dcc0, glow: 0xffb319 } },
];

/** Parts fitted to rivals per AI tier (Appendix A). */
export const RIVAL_FITS: Readonly<Record<AITier, Readonly<Record<PartSlot, PartTier>>>> = {
  rookie: { engine: 0, booster: 0, stabilizer: 0, hull: 0 },
  pilot: { engine: 1, booster: 0, stabilizer: 1, hull: 0 },
  ace: { engine: 2, booster: 2, stabilizer: 1, hull: 1 },
  legend: { engine: 3, booster: 3, stabilizer: 2, hull: 2 },
};

export const RACE_SIZE = 8;

export interface RaceFieldOptions {
  playerName: string;
  playerLoadout: Loadout;
  tier: AITier;
  /** Override the player's grid slot (default: P8 on Rookie, P5 otherwise). */
  playerGridIndex?: number;
}

/** Player (id 0) + 7 rivals (ids 1..7). Rivals fill the grid slots the player doesn't take, in roster order. */
export function buildRaceField(opts: RaceFieldOptions): ShipDefinition[] {
  const playerGrid = opts.playerGridIndex ?? (opts.tier === 'rookie' ? RACE_SIZE - 1 : 4);
  const player: ShipDefinition = {
    id: 0,
    name: opts.playerName,
    isPlayer: true,
    gridIndex: playerGrid,
    livery: { primary: opts.playerLoadout.livery.primary, secondary: opts.playerLoadout.livery.secondary, glow: opts.playerLoadout.livery.glow },
    loadout: opts.playerLoadout,
    stats: resolveStats(opts.playerLoadout),
    tier: opts.tier,
  };
  const freeSlots: number[] = [];
  for (let g = 0; g < RACE_SIZE; g++) if (g !== playerGrid) freeSlots.push(g);
  const parts = RIVAL_FITS[opts.tier];
  const rivals = RIVALS.map((p, i): ShipDefinition => {
    chassisById(p.chassisId); // validates the id
    const loadout: Loadout = { chassisId: p.chassisId, parts: { ...parts }, livery: { ...p.livery, decal: i % 6 } };
    return {
      id: i + 1,
      name: p.name,
      isPlayer: false,
      personality: p.personality,
      gridIndex: freeSlots[i],
      livery: p.livery,
      loadout,
      stats: resolveStats(loadout),
      pilotId: p.id,
      tier: opts.tier,
    };
  });
  return [player, ...rivals];
}

/** Stock COMET in its factory colours: the default loadout of a new profile. */
export function defaultLoadout(): Loadout {
  const c = chassisById('comet');
  return { chassisId: c.id, parts: { engine: 0, booster: 0, stabilizer: 0, hull: 0 }, livery: { ...c.livery, decal: 0 } };
}

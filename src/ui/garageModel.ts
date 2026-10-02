/**
 * Garage stat bars: five kid-readable numbers from ShipStats, each normalised over every class and part
 * combination, so a bar's length means the same thing on every ship. Pure (no Preact) for tests.
 */
import type { Loadout, PartSlot, PartTier, ShipClass, ShipStats } from '../core/contracts';
import { PART_SLOTS, PART_TIERS } from '../content/parts';
import { CHASSIS } from '../content/ships';
import { resolveStats } from '../physics/ShipStatsResolver';

export type StatKey = 'speed' | 'accel' | 'boost' | 'handling' | 'armor';

interface Metric {
  key: StatKey;
  label: string;
  of(s: ShipStats): number;
}

export const METRICS: readonly Metric[] = [
  { key: 'speed', label: 'SPEED', of: (s) => s.topSpeed },
  { key: 'accel', label: 'ACCEL', of: (s) => s.thrustAccel },
  // Boost value: speed × duration per unit of energy.
  { key: 'boost', label: 'BOOST', of: (s) => (s.boostTopSpeed * s.boostTime) / s.boostCost },
  { key: 'handling', label: 'HANDLING', of: (s) => s.steerRate * s.lateralGrip },
  // Effective energy: how much punishment the ship soaks.
  { key: 'armor', label: 'ARMOR', of: (s) => s.energyMax / s.damageTakenScale },
];

/** Shortest bar (so a minimum still shows). */
const FLOOR = 0.12;

function everyLoadout(): Pick<Loadout, 'chassisId' | 'parts'>[] {
  const byClass = new Map<ShipClass, string>();
  for (const c of CHASSIS) if (!byClass.has(c.cls)) byClass.set(c.cls, c.id);
  const out: Pick<Loadout, 'chassisId' | 'parts'>[] = [];
  for (const chassisId of byClass.values()) {
    for (let code = 0; code < 4 ** PART_SLOTS.length; code++) {
      const parts = {} as Record<PartSlot, PartTier>;
      PART_SLOTS.forEach((slot, i) => (parts[slot] = PART_TIERS[Math.floor(code / 4 ** i) % 4]));
      out.push({ chassisId, parts });
    }
  }
  return out;
}

let ranges: Map<StatKey, [number, number]> | null = null;
function rangeOf(key: StatKey): [number, number] {
  if (!ranges) {
    ranges = new Map(METRICS.map((m) => [m.key, [Infinity, -Infinity] as [number, number]]));
    for (const l of everyLoadout()) {
      const s = resolveStats(l);
      for (const m of METRICS) {
        const r = ranges.get(m.key)!;
        const v = m.of(s);
        r[0] = Math.min(r[0], v);
        r[1] = Math.max(r[1], v);
      }
    }
  }
  return ranges.get(key)!;
}

export interface StatBar {
  key: StatKey;
  label: string;
  /** FLOOR..1 */
  value: number;
}

export function statBars(loadout: Pick<Loadout, 'chassisId' | 'parts'>): StatBar[] {
  const s = resolveStats(loadout);
  return METRICS.map((m) => {
    const [lo, hi] = rangeOf(m.key);
    const t = hi > lo ? (m.of(s) - lo) / (hi - lo) : 1;
    return { key: m.key, label: m.label, value: FLOOR + (1 - FLOOR) * Math.min(1, Math.max(0, t)) };
  });
}

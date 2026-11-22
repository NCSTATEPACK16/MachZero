/**
 * The economy guard (IMPLEMENTATION §M8d step 1): credits a race for an autopilot standing in for the player (at the
 * tier's own skill, full thrust, from its usual grid slot), as bands around the measurements of §M8. A later change to
 * payouts, pace or parts that breaks the progression (a first part after one Rookie race, a Mk III kit after about 10
 * Pilot races, a Prototype kit after about 25 Ace races) fails here. Shared by the three `economy.*.sim.test.ts` files
 * so each stays under a minute.
 *
 * Kits are one part of the given tier in every slot, variant A (`soloRace.kit`). PartTier 1 is Mk II, 2 is Mk III,
 * 3 is Prototype.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier, PartTier } from '../core/contracts';
import { HAZARDS_ROOKIE } from '../core/hazards';
import { racePayout } from '../content/economy';
import { TIER_NAMES } from '../content/parts';
import { worldsFor } from '../content/worlds';
import { kit } from './soloRace';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 60_000 });

export interface EconomyCase {
  tier: AITier;
  kit: PartTier;
  /** Mean credits a race over the tracks, inclusive. */
  min: number;
  max: number;
}

/** The tracks the bands are measured over: every world visible with `expansion` (8). */
export const ECONOMY_TRACKS: readonly string[] = worldsFor({ expansion: true }).map((w) => w.trackId);

/** Rookie preset, stock, Neon Bay: the profile's first race (from P8, Rookie hazards, the assists) pays a Mk II part. */
export function describeRookieFirstRace(): void {
  it('Rookie preset, stock, Neon Bay: the first race pays at least 600 (a Mk II part)', async () => {
    const r = await runWorldRace('neon-bay', 'rookie', { hazards: HAZARDS_ROOKIE, player: { tier: 'rookie', pace: 1, assisted: true, loadout: kit(0) } });
    const me = r.results.find((s) => s.id === 0)!;
    const pay = racePayout(me.position, 'rookie');
    console.log(`economy rookie first race: P${me.position} ${me.status}, ${pay} credits`);
    expect(me.status).toBe('finished');
    expect(pay).toBeGreaterThanOrEqual(600);
  });
}

export function describeEconomy(cases: readonly EconomyCase[]): void {
  describe('economy: credits a race', () => {
    it.each(cases.map((c) => [`${c.tier}, ${TIER_NAMES[c.kit]} kit: ${c.min}–${c.max} a race`, c] as const))('%s', async (_name, c) => {
      const rows: string[] = [];
      let sum = 0;
      for (const trackId of ECONOMY_TRACKS) {
        const r = await runWorldRace(trackId, c.tier, { player: { tier: c.tier, pace: 1, loadout: kit(c.kit) } });
        const me = r.results.find((s) => s.id === 0)!;
        const pay = racePayout(me.position, c.tier);
        sum += pay;
        rows.push(`${trackId} P${me.position} ${pay}`);
      }
      const mean = sum / ECONOMY_TRACKS.length;
      console.log(`economy ${c.tier} ${TIER_NAMES[c.kit]}: mean ${mean.toFixed(0)} (${rows.join(', ')})`);
      expect(mean).toBeGreaterThanOrEqual(c.min);
      expect(mean).toBeLessThanOrEqual(c.max);
    });
  });
}

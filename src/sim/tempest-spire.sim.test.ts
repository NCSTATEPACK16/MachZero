/**
 * World race sim: 8 ships, 3 laps (the player's) on Tempest Spire at the Rookie and Legend fits. Every ship finishes
 * through the three crosswind zones, the two lightning fields and over the jump between the towers, without being
 * destroyed or respawned. The AI reads the wind and lightning timelines: it aims upwind in a gust, so the wind does
 * not put it into a rail, and it keeps off a strike circle whose bolt would land as it passes, so strikes are rare
 * (8 ships × 3 laps pass 240 strike points).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';
import { describeTierMatrix } from './tierMatrix';

vi.setConfig({ testTimeout: 300_000 });

describe.each<AITier>(['rookie', 'legend'])('tempest-spire: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps through the wind and the lightning', async () => {
    const r = await runWorldRace('tempest-spire', tier);
    console.log(`tempest-spire ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) expect(r.respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBe(0);
    // One jump a lap.
    for (const s of r.ships) expect(r.jumps.get(s.def.id) ?? 0, `${s.def.name} jumps`).toBeGreaterThanOrEqual(3);
    const strikes = [...r.lightningHits.values()].reduce((a, b) => a + b, 0);
    expect(strikes).toBeLessThanOrEqual(tier === 'rookie' ? 6 : 10);
  });
});

describe('tempest-spire: hazards on the race clock', () => {
  it('replays the same race to the same standings and the same strikes', async () => {
    const a = await runWorldRace('tempest-spire', 'ace');
    const b = await runWorldRace('tempest-spire', 'ace');
    expect(a.finished).toBe(true);
    expect(b.standings).toEqual(a.standings);
    expect([...b.lightningHits]).toEqual([...a.lightningHits]);
  });
});

describeTierMatrix('tempest-spire');

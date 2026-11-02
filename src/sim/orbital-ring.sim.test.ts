/**
 * World race sim: 8 ships, 3 laps (the player's) on Orbital Ring at the Rookie and Legend fits. Every ship finishes
 * round the loop-the-loop, over the low-gravity jumps and through the mine fields and debris without being destroyed
 * or respawned. The AI reads the hazard timeline and keeps to the clear side of each field, so it seldom sets off a
 * mine (8 ships × 3 laps pass 216 mines) and never hits the debris.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 300_000 });

describe.each<AITier>(['rookie', 'legend'])('orbital-ring: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps round the loop and through the hazards', async () => {
    const r = await runWorldRace('orbital-ring', tier);
    console.log(`orbital-ring ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) expect(r.respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBe(0);
    // Two low-gravity jumps a lap.
    for (const s of r.ships) expect(r.jumps.get(s.def.id) ?? 0, `${s.def.name} jumps`).toBeGreaterThanOrEqual(6);
    const mineHits = [...r.mineHits.values()].reduce((a, b) => a + b, 0);
    const debrisHits = [...r.debrisHits.values()].reduce((a, b) => a + b, 0);
    expect(mineHits).toBeLessThanOrEqual(tier === 'rookie' ? 4 : 8);
    expect(debrisHits).toBeLessThanOrEqual(2);
  });
});

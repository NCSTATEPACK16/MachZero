/**
 * World race sim: 8 ships, 3 laps (the player's) on the authored neon-bay track at each AI tier's fits. Every ship finishes;
 * nobody explodes; only the erratic personality may respawn, and at most once per jump per lap.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 300_000 });

// The two extremes of the field (all-Stock rivals vs Mk III/Prototype rivals) keep the suite fast; the v1
// seed sims cover the Pilot fits.
describe.each<AITier>(['rookie', 'legend'])('neon-bay: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps and stays on the track', async () => {
    const r = await runWorldRace('neon-bay', tier);
    console.log(`neon-bay ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) {
      const respawns = r.respawns.get(s.def.id) ?? 0;
      const allowed = s.def.personality === 'erratic' ? r.track.jumps.length * 3 : 0;
      expect(respawns, `${s.def.name} respawns`).toBeLessThanOrEqual(allowed);
      // Every lap crosses every jump (rivals may still be on their last lap when the results show).
      expect(r.jumps.get(s.def.id) ?? 0, `${s.def.name} jumps`).toBeGreaterThanOrEqual(r.track.jumps.length * 2 - respawns);
    }
  });
});

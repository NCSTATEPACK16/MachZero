/**
 * World race sim: 8 ships, 3 laps on the authored sunset-mesa track at each AI tier's fits. Every ship finishes;
 * nobody explodes; only the erratic personality may respawn, and at most once per jump per lap.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 300_000 });

describe.each<AITier>(['rookie', 'pilot', 'ace', 'legend'])('sunset-mesa: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps and stays on the track', async () => {
    const r = await runWorldRace('sunset-mesa', tier);
    console.log(`sunset-mesa ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) {
      const respawns = r.respawns.get(s.def.id) ?? 0;
      const allowed = s.def.personality === 'erratic' ? r.track.jumps.length * 3 : 0;
      expect(respawns, `${s.def.name} respawns`).toBeLessThanOrEqual(allowed);
      // Every lap crosses every jump.
      expect(r.jumps.get(s.def.id) ?? 0, `${s.def.name} jumps`).toBeGreaterThanOrEqual(r.track.jumps.length * 3 - respawns);
    }
  });
});

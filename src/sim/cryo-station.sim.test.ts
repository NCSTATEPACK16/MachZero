/**
 * World race sim: 8 ships, 3 laps (the player's) on Cryo Station at the Rookie and Legend fits. Every ship
 * finishes through the full-pipe and over the ice patches; nobody explodes or respawns (the pipe has no gaps
 * and its seam guard keeps ships off the top as the tube opens).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 300_000 });

describe.each<AITier>(['rookie', 'legend'])('cryo-station: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps through the pipe and over the ice', async () => {
    const r = await runWorldRace('cryo-station', tier);
    console.log(`cryo-station ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) expect(r.respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBe(0);
  });
});

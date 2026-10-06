/**
 * World race sim: 8 ships, 3 laps (the player's) on Jade Ruins at the Rookie and Legend fits. Every ship finishes
 * through the stone gates without being destroyed or respawned. Rookies never take the shortcut; Legends take it
 * whenever its gate will be open on arrival. The AI reads the gates' timeline, so it seldom hits one.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';

vi.setConfig({ testTimeout: 300_000 });

describe.each<AITier>(['rookie', 'legend'])('jade-ruins: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps through the gates; the shortcut by tier', async () => {
    const r = await runWorldRace('jade-ruins', tier);
    console.log(`jade-ruins ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) expect(r.respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBe(0);
    const shortcuts = [...r.shortcuts.values()].reduce((a, b) => a + b, 0);
    const gateHits = [...r.gateHits.values()].reduce((a, b) => a + b, 0);
    if (tier === 'rookie') expect(shortcuts).toBe(0);
    // 8 ships × 3 laps: Legends take most of the 24 chances (the rest are skipped for a shut gate).
    else expect(shortcuts).toBeGreaterThanOrEqual(8);
    expect(gateHits).toBeLessThanOrEqual(4);
  });
});

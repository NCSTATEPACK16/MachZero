/**
 * World race sim: 8 ships, 3 laps (the player's) on Cinder Forge at the Rookie and Legend fits. Every ship finishes
 * past the two geyser fields on the rim, down the Plunge, across the crater floor, up the climb and over the jump,
 * without being destroyed or respawned. The AI reads the geyser timeline: it keeps off a vent that would erupt as it
 * passes, so hits are rare (8 ships × 3 laps pass 240 vents).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';
import { describeTierMatrix } from './tierMatrix';

vi.setConfig({ testTimeout: 300_000 });

describe.each<AITier>(['rookie', 'legend'])('cinder-forge: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps through the geysers and the Plunge', async () => {
    const r = await runWorldRace('cinder-forge', tier);
    console.log(`cinder-forge ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) expect(r.respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBe(0);
    // One jump a lap.
    for (const s of r.ships) expect(r.jumps.get(s.def.id) ?? 0, `${s.def.name} jumps`).toBeGreaterThanOrEqual(3);
    const hits = [...r.geyserHits.values()].reduce((a, b) => a + b, 0);
    expect(hits).toBeLessThanOrEqual(tier === 'rookie' ? 6 : 10);
  });
});

describe('cinder-forge: hazards on the race clock', () => {
  it('replays the same race to the same standings and the same geyser hits', async () => {
    const a = await runWorldRace('cinder-forge', 'ace');
    const b = await runWorldRace('cinder-forge', 'ace');
    expect(a.finished).toBe(true);
    expect(b.standings).toEqual(a.standings);
    expect([...b.geyserHits]).toEqual([...a.geyserHits]);
  });
});

describeTierMatrix('cinder-forge');

/**
 * World race sim: 8 ships, 3 laps (the player's) on Abyss Line at the Rookie and Legend fits. Every ship finishes
 * round the outside of the Spine and past its two jet fields, without being destroyed or respawned. The AI reads the
 * jet timeline: it keeps off a vent that would fire as it passes, so hits are rare (8 ships × 3 laps pass 192 vents).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AITier } from '../core/contracts';
import { runWorldRace } from './worldRace';
import { describeTierMatrix } from './tierMatrix';

vi.setConfig({ testTimeout: 300_000 });

describe.each<AITier>(['rookie', 'legend'])('abyss-line: 8-ship race (%s fits)', (tier) => {
  it('every ship finishes 3 laps round the Spine and through the jets', async () => {
    const r = await runWorldRace('abyss-line', tier);
    const hits = [...r.jetHits.values()].reduce((a, b) => a + b, 0);
    console.log(`abyss-line ${tier}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)} jetHits=${hits}\n${r.table}`);
    expect(r.finished).toBe(true);
    expect(r.playerLaps).toBe(3);
    expect(r.destroyed).toEqual([]);
    expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
    for (const s of r.ships) expect(r.respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBe(0);
    expect(hits).toBeLessThanOrEqual(tier === 'rookie' ? 6 : 10);
  });
});

describe('abyss-line: hazards on the race clock', () => {
  it('replays the same race to the same standings and the same jet hits', async () => {
    const a = await runWorldRace('abyss-line', 'ace');
    const b = await runWorldRace('abyss-line', 'ace');
    expect(a.finished).toBe(true);
    expect(b.standings).toEqual(a.standings);
    expect([...b.jetHits]).toEqual([...a.jetHits]);
  });
});

describeTierMatrix('abyss-line');

/**
 * M5 tier matrix (IMPLEMENTATION §M5, Appendix C), shared by the per-world sim files so each track runs in its own
 * worker. Per track, on top of the file's own Rookie and Legend races:
 *  - Pilot and Ace fields: every ship finishes, nobody explodes, only the erratic personality may respawn;
 *  - a mixed field (Legend, Rookie and one Pilot rival): Legend rivals finish ahead of Rookie rivals on average;
 *  - balance: a Rookie-assisted autopilot on stock parts makes the podium against Rookie AI from the back of the
 *    grid, and an unassisted Pilot-level autopilot on stock parts finishes mid-pack against Pilot AI (P2–P7, within
 *    1.5% of the median time: the Pilot field races as a pack, so the exact place inside it is a lottery).
 * The autopilots stand in for a human, so they race at full thrust (pace 1), without the CPU's pace cap.
 */
import { describe, expect, it } from 'vitest';
import type { AITier } from '../core/contracts';
import { HAZARDS_ROOKIE, hazardPolicy } from '../core/hazards';
import { runWorldRace, type WorldRaceResult } from './worldRace';

/** Rivals in roster order (NOVA, ZIGGY, REX, PIXEL, LUNA, TIA, SPARKY): both DARTs and both heavies are split. */
export const MIXED_FIELD: readonly AITier[] = ['legend', 'rookie', 'legend', 'rookie', 'legend', 'rookie', 'pilot'];

export function expectCleanRace(r: WorldRaceResult): void {
  expect(r.finished).toBe(true);
  expect(r.playerLaps).toBe(3);
  expect(r.destroyed).toEqual([]);
  expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
  for (const s of r.ships) {
    const allowed = s.def.personality === 'erratic' ? r.track.jumps.length * 3 : 0;
    expect(r.respawns.get(s.def.id) ?? 0, `${s.def.name} respawns`).toBeLessThanOrEqual(allowed);
  }
}

function log(trackId: string, label: string, r: WorldRaceResult): void {
  console.log(`${trackId} ${label}: simT=${r.simTime.toFixed(1)}s physics=${r.stepMs.toFixed(3)}ms/step maxLateral=${r.maxLateral.toFixed(2)}\n${r.table}`);
}

/** Finishing position (1-based) of ship `id`. */
export function positionOf(r: WorldRaceResult, id: number): number {
  return r.results.find((s) => s.id === id)!.position;
}

export function describeTierMatrix(trackId: string): void {
  describe(`${trackId}: tier matrix`, () => {
    it.each<AITier>(['pilot', 'ace'])('%s field: everyone finishes cleanly', async (tier) => {
      const r = await runWorldRace(trackId, tier, { hazards: hazardPolicy('normal'), untilAllFinish: true });
      log(trackId, tier, r);
      expectCleanRace(r);
    });

    it('mixed field: Legend rivals finish ahead of Rookie rivals on average', async () => {
      const r = await runWorldRace(trackId, 'pilot', { rivalTiers: MIXED_FIELD, untilAllFinish: true });
      log(trackId, 'mixed', r);
      expectCleanRace(r);
      const mean = (t: AITier): number => {
        const ids = MIXED_FIELD.flatMap((x, i) => (x === t ? [i + 1] : []));
        return ids.reduce((a, id) => a + positionOf(r, id), 0) / ids.length;
      };
      console.log(`${trackId} mixed: mean position legend=${mean('legend').toFixed(2)} rookie=${mean('rookie').toFixed(2)}`);
      expect(mean('legend')).toBeLessThan(mean('rookie'));
    });

    it('balance: a Rookie-assisted autopilot on stock parts makes the podium against Rookie AI from P8', async () => {
      const r = await runWorldRace(trackId, 'rookie', { hazards: HAZARDS_ROOKIE, player: { tier: 'rookie', pace: 1, assisted: true }, untilAllFinish: true });
      log(trackId, 'balance rookie', r);
      expectCleanRace(r);
      expect(positionOf(r, 0)).toBeLessThanOrEqual(3);
    });

    it('balance: an unassisted Pilot-level autopilot on stock parts finishes mid-pack against Pilot AI', async () => {
      const r = await runWorldRace(trackId, 'pilot', { player: { tier: 'pilot', pace: 1 }, untilAllFinish: true });
      log(trackId, 'balance pilot', r);
      expectCleanRace(r);
      // The Pilot field races as a pack (P2–P8 typically finish within ~1 s), so "mid-pack" is: neither the winner
      // nor last, and within 1.5% of the field's median time.
      const p = positionOf(r, 0);
      const times = r.standings.map((x) => x.totalTime!).sort((a, b) => a - b);
      const median = (times[3] + times[4]) / 2;
      const mine = r.standings.find((x) => x.id === 0)!.totalTime!;
      console.log(`${trackId} balance pilot: P${p}, ${mine.toFixed(2)} s vs median ${median.toFixed(2)} s`);
      expect(p).toBeGreaterThanOrEqual(2);
      expect(p).toBeLessThanOrEqual(7);
      expect(Math.abs(mine - median) / median).toBeLessThan(0.015);
    });
  });
}

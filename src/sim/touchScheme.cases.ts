/**
 * The touch-scheme cases per track (IMPLEMENTATION §M7b step 9): the default scheme by two scripted thumbs finishes
 * three clean laps within 12% of the same Pilot AIDriver driving directly, replays identically, and the Rookie preset
 * on top (strong steering help, No-KO) also finishes clean. Together the two files cover all 8 tracks: the corkscrew,
 * the pipe, the loop, the Plunge and the Spine.
 */
import { describe, expect, it, vi } from 'vitest';
import { NO_ASSISTS, ROOKIE_ASSISTS } from '../save/schema';
import { ScriptedThumbs, thumbRace, type ThumbRun } from './touchScheme';

vi.setConfig({ testTimeout: 60_000 });

const TOUCH_DEFAULT = { ...NO_ASSISTS, autoAccelerate: true };

function expectClean(r: ThumbRun): void {
  expect(r.laps).toBe(3);
  expect(r.totalTime).toBeLessThan(Infinity);
  expect(r.respawns).toBe(0);
  expect(r.destroyed).toBe(false);
  expect(r.maxLateral).toBeLessThan(r.track.halfWidth + 1);
}

export function describeTouchScheme(trackIds: readonly string[]): void {
  describe.each(trackIds)('%s: touch scheme', (trackId) => {
    it('scripted thumbs on the default scheme: 3 clean laps within 12% of the AI driving directly, replayed identically', async () => {
      const direct = await thumbRace(trackId, null, NO_ASSISTS);
      const a = await thumbRace(trackId, new ScriptedThumbs(), TOUCH_DEFAULT);
      const b = await thumbRace(trackId, new ScriptedThumbs(), TOUCH_DEFAULT);
      console.log(`${trackId} touch: thumbs ${a.totalTime.toFixed(2)} s vs direct ${direct.totalTime.toFixed(2)} s (${(((a.totalTime - direct.totalTime) / direct.totalTime) * 100).toFixed(1)}%), maxLateral ${a.maxLateral.toFixed(2)}`);
      expectClean(direct);
      expectClean(a);
      expect(Math.abs(a.totalTime - direct.totalTime) / direct.totalTime).toBeLessThan(0.12);
      expect(b).toEqual(a);
    });

    it('the Rookie preset on top (strong steering help, No-KO): 3 laps, no respawn', async () => {
      const r = await thumbRace(trackId, new ScriptedThumbs(), ROOKIE_ASSISTS);
      console.log(`${trackId} touch rookie: ${r.totalTime.toFixed(2)} s, respawns ${r.respawns}`);
      expectClean(r);
    });
  });
}

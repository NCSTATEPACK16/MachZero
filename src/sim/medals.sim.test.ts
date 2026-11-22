/**
 * Medal reach (IMPLEMENTATION §M8b step 9): a solo Legend autopilot on a COMET, on all 8 tracks, against the
 * committed dev times. Bronze has 5% in hand for a perfect stock run, gold is not free on stock, gold has 1% in
 * hand on a Prototype kit, and silver is reachable on a Mk II kit. If a track fails, tune that track or the parts
 * with the owner; do not move the factors per track.
 */
import { describe, expect, it } from 'vitest';
import { DEV_TIMES } from '../content/devTimes';
import { TRACK_DEFS } from '../content/tracks';
import { MEDAL_FACTORS } from '../game/modes/TimeTrial';
import { kit, soloRace } from './soloRace';

const TRACK_IDS = Object.keys(TRACK_DEFS);

describe('Time Trial medals on every track', () => {
  it.each(TRACK_IDS)('%s', { timeout: 60_000 }, async (id) => {
    const dev = DEV_TIMES[id];
    const [stock, mk2, proto] = [await soloRace(id, kit(0)), await soloRace(id, kit(1)), await soloRace(id, kit(3))].map((r) => r.total / dev);
    console.log(`${id}: dev ${dev} s; stock ×${stock.toFixed(3)}, Mk II ×${mk2.toFixed(3)}, Prototype ×${proto.toFixed(3)}`);
    expect(stock, `${id}: a stock run keeps 5% in hand on bronze`).toBeLessThanOrEqual(1.07);
    expect(stock, `${id}: gold is not free on stock`).toBeGreaterThan(MEDAL_FACTORS.gold);
    expect(proto, `${id}: a Prototype kit has 1% in hand on gold`).toBeLessThanOrEqual(MEDAL_FACTORS.gold - 0.01);
    expect(mk2, `${id}: silver is reachable on a Mk II kit`).toBeLessThanOrEqual(MEDAL_FACTORS.silver);
  });
});

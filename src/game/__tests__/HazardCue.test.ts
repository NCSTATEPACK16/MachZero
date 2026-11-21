import { describe, expect, it } from 'vitest';
import type { TrackData } from '../../core/contracts';
import { TRACK_DEFS } from '../../content/tracks';
import { trackFromSource } from '../../track';
import { gateClosure, gateWarning } from '../../track/features/gate';
import { CUE_HORIZON, buildCueSpots, hazardCue, type HazardKind } from '../HazardCue';

const tracks = new Map<string, TrackData>();
const track = (id: string): TrackData => {
  let t = tracks.get(id);
  if (!t) tracks.set(id, (t = trackFromSource({ kind: 'authored', def: TRACK_DEFS[id] })));
  return t;
};

/** The first spot of `kind` on `id`, its track and the time (scanning the hazard clock) when it is live. */
function setup(id: string, kind: HazardKind) {
  const t = track(id);
  const spots = buildCueSpots(t);
  const spot = spots.find((s) => s.kind === kind);
  expect(spot, `${id} has a ${kind}`).toBeDefined();
  let live = -1;
  for (let x = 0; x < 60 && live < 0; x += 0.05) if (spot!.live(x)) live = x;
  expect(live).toBeGreaterThanOrEqual(0);
  return { t, spots, spot: spot!, live };
}

describe('hazardCue (IMPLEMENTATION §M7c)', () => {
  it.each<[string, HazardKind]>([
    ['cryo-station', 'ice'],
    ['jade-ruins', 'gate'],
    ['orbital-ring', 'mine'],
    ['orbital-ring', 'debris'],
    ['tempest-spire', 'lightning'],
    ['cinder-forge', 'geyser'],
    ['abyss-line', 'jet'],
  ])('%s: names the %s ahead within the horizon and points to the clear side', (id, kind) => {
    const { t, spots, spot, live } = setup(id, kind);
    const speed = 50;
    // Only spots of this kind, so a neighbour of another kind cannot win.
    const mine = spots.filter((s) => s === spot);
    const before = spot.d - speed * (CUE_HORIZON - 0.5);
    const cue = hazardCue(mine, before, 0, speed, live, t.length);
    expect(cue?.kind).toBe(kind);
    expect(cue!.dist).toBeGreaterThan(0);
    // The arrow leads to the clear side: following it, the side goes to 0 (clear) or keeps the same sign up to the rail.
    if (cue!.side !== 0) {
      let lat = 0;
      let steps = 0;
      while (spot.clear(lat) === cue!.side && Math.abs(lat) < t.halfWidth && steps++ < 100) lat += cue!.side * 0.5;
      expect(spot.clear(lat) === 0 || Math.abs(lat) >= t.halfWidth).toBe(true);
    }
    // Out of reach: nothing.
    expect(hazardCue(mine, spot.d - speed * CUE_HORIZON - 40, 0, speed, live, t.length)).toBeNull();
  });

  it('a gate is cued while it warns or is shut, and its arrow points away from the closing half', () => {
    const t = track('jade-ruins');
    const gates = t.features.filter((f) => f.type === 'gate' && !f.branch);
    const spots = buildCueSpots(t).filter((s) => s.kind === 'gate');
    expect(spots).toHaveLength(gates.length);
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i] as Extract<(typeof gates)[number], { type: 'gate' }>;
      let open = -1;
      for (let x = 0; x < 60 && open < 0; x += 0.05) if (gateWarning(g, x) === 0 && gateClosure(g, x) === 0 && gateWarning(g, x + 2) === 0 && gateClosure(g, x + 2) === 0) open = x;
      if (open >= 0) expect(hazardCue([spots[i]], g.d - 50, 0, 50, open, t.length)).toBeNull();
      expect(spots[i].clear(0)).toBe(g.span === 'left' ? 1 : g.span === 'right' ? -1 : 0);
    }
  });

  it('picks the nearest of several and says nothing on a quiet stretch', () => {
    const t = track('orbital-ring');
    const spots = buildCueSpots(t).filter((s) => s.kind === 'mine').sort((a, b) => a.d - b.d);
    expect(spots.length).toBeGreaterThanOrEqual(2);
    const cue = hazardCue(spots, spots[0].d - 20, 0, 60, 0, t.length);
    expect(cue?.dist).toBeCloseTo(20, 5);
    expect(hazardCue(buildCueSpots(track('neon-bay')), 100, 0, 60, 0, track('neon-bay').length)).toBeNull();
  });
});

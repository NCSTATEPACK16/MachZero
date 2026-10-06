import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import { TRACK_DEFS } from '../../content/tracks';
import { trackFromSource } from '..';
import { TrackRoute } from '../TrackRoute';

const track = trackFromSource({ kind: 'authored', def: TRACK_DEFS['jade-ruins'] });
const b = track.branches[0];
const L = track.length;
const main = new TrackRoute(track);
const short = new TrackRoute(track, b);
const W = CONFIG.TRACK_HALF_WIDTH;

describe('TrackRoute', () => {
  it('a main route is the main loop', () => {
    expect(main.length).toBe(L);
    expect(main.pathAt(1234)).toBeNull();
    expect(main.shipR(null, 0.25)).toBeCloseTo(0.25 * L, 6);
    expect(main.curvatureAt(0.3 * L)).toBe(track.samples[Math.floor(0.3 * track.samples.length)].curvature);
    expect(main.lateralShift(10, 300)).toBe(0);
  });

  it('a shortcut route runs fork → branch → merge → main round to the fork, shorter than the main loop', () => {
    expect(short.length).toBeLessThan(L - 100);
    expect(short.pathAt(0)).toBe('shortcut');
    expect(short.pathAt(b.length / 2)).toBe('shortcut');
    expect(short.pathAt(b.length + 1)).toBeNull();
    expect(short.halfWidthAt(10)).toBe(b.halfWidth);
    expect(short.halfWidthAt(b.length + 10)).toBe(W);
    expect(short.mainUAt(10)).toBeNull();
    expect(short.offset).toBe(b.side * (W - b.halfWidth));
    // Continuous road: consecutive route points are about a metre apart, all the way round.
    const a = new THREE.Vector3();
    const c = new THREE.Vector3();
    let worst = 0;
    for (let R = 0; R < short.length; R += 1) {
      short.surfacePoint(R, 0, a);
      short.surfacePoint(R + 1, 0, c);
      worst = Math.max(worst, a.distanceTo(c));
    }
    // At the merge the centre steps from the branch centre to the main centre (the lateral shift): offset apart.
    expect(worst).toBeLessThan(Math.abs(short.offset) + 1.5);
    // ...and with the lateral shift applied the line is continuous there too.
    short.surfacePoint(b.length - 0.5, 0, a);
    short.surfacePoint(b.length + 0.5, short.lateralShift(b.length - 0.5, b.length + 0.5), c);
    expect(a.distanceTo(c)).toBeLessThan(1.5);
    short.surfacePoint(short.length - 0.5, 0, a);
    short.surfacePoint(short.length + 0.5, short.lateralShift(short.length - 0.5, short.length + 0.5), c);
    expect(a.distanceTo(c)).toBeLessThan(1.5);
  });

  it('race progress along the route is monotonic (one lap) and matches the roads', () => {
    let prev = short.progressAt(b.length + 1);
    let total = 0;
    for (let R = b.length + 2; R < short.length + b.length; R += 2) {
      const u = short.progressAt(R);
      const du = (((u - prev) % 1) + 1.5) % 1 - 0.5;
      expect(du).toBeGreaterThanOrEqual(-1e-9);
      total += du;
      prev = u;
    }
    expect(total).toBeCloseTo(1, 2);
  });

  it('maps ships to route metres: before, through and after the fork, on the branch, after the merge, and off-route', () => {
    const dFork = b.uFork * L;
    const dMerge = b.uMerge * L;
    expect(short.shipR(null, (dFork - 100) / L)).toBeCloseTo(short.length - 100, 0);
    expect(short.shipR(null, (dFork + 20) / L)).toBeGreaterThan(15);
    expect(short.shipR(null, (dFork + 20) / L)).toBeLessThan(25);
    expect(short.shipR('shortcut', b.progressU(400), 400)).toBe(400);
    expect(short.shipR(null, (dMerge + 50) / L)).toBeCloseTo(b.length + 50, 0);
    // On main, on the stretch the shortcut skips: off this route.
    const mid = (b.uFork + b.uMerge) / 2;
    expect(short.shipR(null, mid)).toBeNaN();
    expect(short.skips(mid)).toBe(true);
    expect(short.skips(wrap(dFork - 50))).toBe(false);
    // The route point for a ship's R is where the ship is (centre lines, on the fork overlap).
    const R = short.shipR(null, (dFork + 30) / L);
    const p = new THREE.Vector3();
    short.surfacePoint(R, 0, p);
    const pr = track.project(p, (dFork + 30) / L, null);
    expect(pr.lateral).toBeCloseTo(short.offset, 0);
  });
});

function wrap(d: number): number {
  return (((d / L) % 1) + 1) % 1;
}

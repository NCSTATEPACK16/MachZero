import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import { TRACK_DEFS } from '../../content/tracks';
import { trackFromSource } from '..';
import { GATE_SLIDE, buildGates, gateBand, gateBlocksDuring, gateClosure, gateOpensIn, gatePose, gateWarning } from '../features/gate';

const track = trackFromSource({ kind: 'authored', def: TRACK_DEFS['jade-ruins'] });
const gates = buildGates(track);

describe('stone gates (Jade Ruins)', () => {
  it('has half-width gates on the main road, alternating sides, and one full-width gate on the shortcut', () => {
    const main = gates.filter((g) => g.branch === null);
    const short = gates.filter((g) => g.branch === 'shortcut');
    expect(main.length).toBeGreaterThanOrEqual(2);
    expect(main.length).toBeLessThanOrEqual(3);
    for (const g of main) expect(g.span).not.toBe('full');
    const byD = [...main].sort((a, b) => a.d - b.d);
    for (let i = 1; i < byD.length; i++) expect(byD[i].span).not.toBe(byD[i - 1].span);
    expect(short).toHaveLength(1);
    expect(short[0].span).toBe('full');
    expect(short[0].width).toBe(2 * track.branches[0].halfWidth);
  });

  it('follows its timeline: shut for closedFraction of each period (sliding over GATE_SLIDE), open otherwise', () => {
    const g = { period: 6, phase: 1, closedFraction: 0.45 };
    // Cycle time c = t + 1: shut window c ∈ [0, 2.7).
    expect(gateClosure(g, -1)).toBe(0); // c = 0: just starting to close
    expect(gateClosure(g, -1 + GATE_SLIDE)).toBeCloseTo(1, 6);
    expect(gateClosure(g, 0.3)).toBe(1);
    expect(gateClosure(g, 2.5)).toBe(0); // c = 3.5: open
    expect(gateClosure(g, 0.3 + 6 * 7)).toBe(1); // periodic
    expect(gateOpensIn(g, 0.3)).toBeCloseTo(1.4, 6);
    expect(gateOpensIn(g, 2.5)).toBe(0);
    expect(gateBlocksDuring(g, 2, 3)).toBe(false);
    expect(gateBlocksDuring(g, 3, 5.2)).toBe(true); // closes again at c = 6 → t = 5
    // The warning glow builds over the 1.5 s (× telegraph scale) before it closes, and stays on while shut.
    expect(gateWarning(g, 2.5)).toBe(0);
    expect(gateWarning(g, 4.4)).toBeGreaterThan(0.5);
    expect(gateWarning(g, 4.4, 3)).toBeGreaterThan(gateWarning(g, 3.0));
    expect(gateWarning(g, 3.0, 3)).toBeGreaterThan(0);
    expect(gateWarning(g, 0.3)).toBe(1);
  });

  it('a shut slab covers its band of the road; an open one is clear of the road and the ships', () => {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (const g of gates) {
      const [lo, hi] = gateBand(g);
      // Shut: centred on its band, standing on the deck.
      gatePose(g, 1, pos, quat);
      const rel = pos.clone().sub(g.center);
      expect(rel.dot(g.right)).toBeCloseTo((lo + hi) / 2, 3);
      expect(rel.dot(g.up)).toBeCloseTo(g.height / 2, 3);
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(quat).dot(g.right)).toBeCloseTo(1, 6);
      // Open: a half gate's near face is beyond the rail; a full gate's underside is above a ship's roof.
      gatePose(g, 0, pos, quat);
      const open = pos.clone().sub(g.center);
      if (g.span === 'full') {
        expect(open.dot(g.up) - g.height / 2).toBeGreaterThan(CONFIG.HOVER_HEIGHT + CONFIG.SHIP_HEIGHT + 1);
      } else {
        const nearFace = Math.abs(open.dot(g.right)) - g.width / 2;
        expect(nearFace).toBeGreaterThan(g.roadHalfWidth + CONFIG.RAIL_THICKNESS + 1);
      }
    }
  });
});

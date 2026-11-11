import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ShipPreview } from '../ShipPreview';

describe('ShipPreview orbit (§V.3)', () => {
  it('turns freely but clamps the tilt and the zoom', () => {
    const p = new ShipPreview(new THREE.Texture());
    const yaw0 = p.view.yaw;
    p.orbit(1.5, 0, 0);
    expect(p.view.yaw).toBeCloseTo(yaw0 + 1.5);
    p.orbit(0, 10, 10);
    expect(p.view.pitch).toBeLessThan(0.6);
    expect(p.view.zoom).toBeLessThan(0.5);
    p.orbit(0, -20, -20);
    expect(p.view.pitch).toBeGreaterThan(-0.2);
    expect(p.view.zoom).toBeGreaterThan(-0.5);
    p.nudge(0.25); // the mouse drag goes through the same path
    expect(p.view.yaw).toBeCloseTo(yaw0 + 1.75);
    p.hide();
    expect(p.view.pitch).toBe(0);
    expect(p.view.zoom).toBe(0);
    p.dispose();
  });
});

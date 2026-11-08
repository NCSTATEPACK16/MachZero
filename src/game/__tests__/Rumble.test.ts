import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../core/events';
import type { GameEvents } from '../../core/events';
import { Rumble, RUMBLE } from '../Rumble';

function rig() {
  const bus = new EventBus<GameEvents>();
  const played: [number, number, number][] = [];
  let t = 0;
  const r = new Rumble((s, w, ms) => played.push([s, w, ms]), () => t);
  r.attach(bus, 0);
  return { bus, played, r, tick: (ms: number) => (t += ms) };
}
const v = () => new THREE.Vector3();

describe('Rumble', () => {
  it("rumbles on the player's hits, boosts, big landings and item hits, never on a rival's", () => {
    const { bus, played, tick } = rig();
    bus.emit('ship:railHit', { shipId: 3, point: v(), normal: v(), intensity: 1 });
    bus.emit('ship:boost', { shipId: 2 });
    expect(played).toHaveLength(0);
    bus.emit('ship:railHit', { shipId: 0, point: v(), normal: v(), intensity: 0.5 });
    tick(200);
    bus.emit('ship:boost', { shipId: 0 });
    tick(200);
    bus.emit('ship:land', { shipId: 0, intensity: 0.1 }); // a small landing: nothing
    bus.emit('ship:land', { shipId: 0, intensity: 0.9 });
    tick(200);
    bus.emit('item:emp', { from: 2, target: 0, targetName: 'ME' });
    tick(200);
    bus.emit('ship:shipHit', { a: 4, b: 0, point: v(), intensity: 0.4 });
    expect(played).toHaveLength(5);
    for (const [s, w] of played) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('spaces effects out (a scrape fires every step) and stops after detach', () => {
    const { bus, played, r, tick } = rig();
    for (let i = 0; i < 10; i++) {
      bus.emit('ship:railHit', { shipId: 0, point: v(), normal: v(), intensity: 0.3 });
      tick(1000 / 120);
    }
    expect(played.length).toBeLessThanOrEqual(Math.ceil((10 * 1000) / 120 / RUMBLE.GAP_MS));
    r.detach();
    tick(1000);
    bus.emit('ship:boost', { shipId: 0 });
    expect(played.length).toBeLessThanOrEqual(1);
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../../core/events';
import { MIN_GAP_MS, bindHaptics } from '../haptics';

describe('bindHaptics', () => {
  it("taps only for the player's own events, scaled by intensity, rate-limited except a KO", () => {
    const bus = new EventBus<GameEvents>();
    const fired: string[] = [];
    let t = 0;
    const off = bindHaptics(bus, 0, (s) => fired.push(s), () => t);
    const p = new THREE.Vector3();
    bus.emit('ship:boost', { shipId: 3 });
    bus.emit('ship:boost', { shipId: 0 });
    t += MIN_GAP_MS / 2;
    bus.emit('ship:railHit', { shipId: 0, point: p, normal: p, intensity: 0.9 }); // too soon after the boost
    t += MIN_GAP_MS;
    bus.emit('ship:railHit', { shipId: 0, point: p, normal: p, intensity: 0.1 }); // a graze: nothing
    bus.emit('ship:railHit', { shipId: 0, point: p, normal: p, intensity: 0.9 });
    bus.emit('ship:destroyed', { shipId: 0, position: p }); // a KO always lands
    expect(fired).toEqual(['medium', 'heavy', 'heavy']);
    off();
    t += 1000;
    bus.emit('ship:boost', { shipId: 0 });
    expect(fired).toHaveLength(3);
  });
});

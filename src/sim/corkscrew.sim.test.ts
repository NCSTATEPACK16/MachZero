/**
 * Integration: a ship driven through the real corkscrew at racing speed must stay glued to the
 * twisting surface. On a twisting ribbon the surface at lateral offset L moves along its own
 * normal at L·ω, so the hover spring has to track the surface, not world space.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG, SHIP_ROSTER } from '../core/config';
import type { ControlInput, GridSlot, ShipId } from '../core/contracts';
import { clamp, inLoopRange, wrap01 } from '../core/math';
import { EventBus, type GameEvents } from '../core/events';
import { PhysicsSystem } from '../physics';
import { TRACK_DEFS } from '../content/tracks';
import { generateTrack, trackFromSource } from '../track';
import type { TrackData } from '../core/contracts';

const TRACKS: Record<string, () => TrackData> = {
  'v1 seed': () => generateTrack({ seed: CONFIG.TRACK_SEED }),
  'Neon Bay': () => trackFromSource({ kind: 'authored', def: TRACK_DEFS['neon-bay'] }),
};


function slotAt(track: TrackData, u: number, lateral: number): GridSlot {
  const s = track.sampleAt(u);
  const position = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
  const m = new THREE.Matrix4().makeBasis(s.right, s.up, s.forward.clone().negate());
  return { u, lateral, position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
}

describe.each(Object.keys(TRACKS))('%s', (trackName) => describe.each([-9, -5, 0, 5, 9])('corkscrew hold at lateral %i m', (targetLateral) => {
  it('stays grounded at hover height through the full 360° roll', async () => {
    const bus = new EventBus<GameEvents>();
    const track = TRACKS[trackName]();
    const physics = await PhysicsSystem.create(track, bus);
    const ship = physics.addShip(SHIP_ROSTER[0], track.startGrid[0]);
    physics.resetShip(0, slotAt(track, wrap01(track.corkscrew!.uStart - 0.12), targetLateral));
    ship.status = 'racing';
    let respawns = 0;
    bus.on('ship:respawn', () => respawns++);

    const controls = new Map<ShipId, ControlInput>();
    let worstHeightError = 0;
    let airborneSteps = 0;
    let insideSteps = 0;
    let prevLat = ship.lateral;
    for (let i = 0; i < 120 * 12 && !(insideSteps > 0 && !inLoopRange(ship.trackU, track.corkscrew!.uStart, track.corkscrew!.uEnd)); i++) {
      const latVel = (ship.lateral - prevLat) / CONFIG.FIXED_DT;
      prevLat = ship.lateral;
      const steer = clamp(0.06 * (targetLateral - ship.lateral) - 0.05 * latVel, -1, 1);
      controls.set(0, { throttle: 1, brake: 0, steer, airbrakeLeft: 0, airbrakeRight: 0, boost: false });
      physics.step(CONFIG.FIXED_DT, controls);
      if (inLoopRange(ship.trackU, track.corkscrew!.uStart, track.corkscrew!.uEnd)) {
        insideSteps++;
        worstHeightError = Math.max(worstHeightError, Math.abs(ship.heightAboveTrack - CONFIG.HOVER_HEIGHT));
        if (!ship.grounded) airborneSteps++;
      }
    }
    physics.dispose();
    console.log(`${trackName} lat ${targetLateral}: inside=${insideSteps} worstHeightErr=${worstHeightError.toFixed(2)} airborne=${airborneSteps} respawns=${respawns} speed=${ship.speed.toFixed(0)}`);
    expect(insideSteps).toBeGreaterThan(100);
    expect(respawns).toBe(0);
    expect(airborneSteps).toBe(0);
    expect(worstHeightError).toBeLessThan(0.6);
  });
}));

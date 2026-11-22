import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../../../core/config';
import { GHOST_HZ, GHOST_VERSION, decodeGhost, encodeGhost, type GhostData } from '../ghostCodec';
import { GhostPlayer } from '../GhostPlayer';
import { GhostRecorder } from '../GhostRecorder';

interface GhostPose {
  position: Vector3;
  quaternion: Quaternion;
  bank: number;
}

/** A pose source moving round a circle of radius `r` (m) at `w` rad/s, nose along the tangent, banked into the turn. */
function circle(r: number, w: number) {
  const pose: GhostPose = { position: new Vector3(), quaternion: new Quaternion(), bank: 0 };
  const up = new Vector3(0, 1, 0);
  return {
    pose,
    at(t: number, out: GhostPose = pose): GhostPose {
      const a = w * t;
      out.position.set(Math.cos(a) * r + 400, 30 + Math.sin(a * 0.5) * 12, Math.sin(a) * r - 650);
      // Heading: the tangent (−sin a, 0, cos a); the ship's forward is −Z, so yaw = −a + π.
      out.quaternion.setFromAxisAngle(up, -a + Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2 * Math.sin(a)));
      out.bank = 0.3;
      return out;
    },
  };
}

/** The visual rotation the recorder stores: body rotation with the bank applied (roll about +Z by −bank). */
function visual(p: GhostPose): Quaternion {
  return p.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -p.bank));
}

function record(seconds: number, r = 600, w = 0.4): { ghost: GhostData; src: ReturnType<typeof circle> } {
  const src = circle(r, w);
  const rec = new GhostRecorder();
  rec.start();
  const steps = Math.round(seconds / CONFIG.FIXED_DT);
  for (let i = 0; i <= steps; i++) rec.sample(src.at(i * CONFIG.FIXED_DT));
  return { ghost: rec.finish(seconds, [seconds / 3, seconds / 3, seconds / 3], 'neon-bay', 'comet'), src };
}

function angleDeg(a: Quaternion, b: Quaternion): number {
  return (a.angleTo(b) * 180) / Math.PI;
}

describe('ghost codec, recorder and player (IMPLEMENTATION §M8b step 1)', () => {
  it('samples at 20 Hz: one in every 6 fixed steps', () => {
    expect(GHOST_HZ).toBe(20);
    expect(Math.round(1 / CONFIG.FIXED_DT / GHOST_HZ)).toBe(6);
    const { ghost } = record(10);
    expect(ghost.count).toBe(10 * GHOST_HZ + 1);
    expect(ghost.version).toBe(GHOST_VERSION);
    expect(ghost.trackId).toBe('neon-bay');
    expect(ghost.chassisId).toBe('comet');
  });

  it('encode → decode is exact', () => {
    const { ghost } = record(12);
    const back = decodeGhost(encodeGhost(ghost));
    expect(back).not.toBeNull();
    expect(back!.count).toBe(ghost.count);
    expect(back!.totalTime).toBe(ghost.totalTime);
    expect(back!.lapTimes).toEqual(ghost.lapTimes);
    expect(back!.min).toEqual(ghost.min);
    expect(back!.size).toEqual(ghost.size);
    expect(Array.from(back!.pos)).toEqual(Array.from(ghost.pos));
    expect(Array.from(back!.quat)).toEqual(Array.from(ghost.quat));
    expect(Array.from(back!.largest)).toEqual(Array.from(ghost.largest));
    // And again: a decoded ghost encodes to the same bytes.
    expect(new Uint8Array(encodeGhost(back!))).toEqual(new Uint8Array(encodeGhost(ghost)));
  });

  it('a recorded circle plays back within 2 cm and 0.5°, at and between samples', () => {
    const { ghost, src } = record(30);
    const player = new GhostPlayer(decodeGhost(encodeGhost(ghost))!);
    const pos = new Vector3();
    const quat = new Quaternion();
    const want: GhostPose = { position: new Vector3(), quaternion: new Quaternion(), bank: 0 };
    let worstPos = 0;
    let worstAngle = 0;
    // On the sample times only: between samples the source moves on a curve and the player interpolates a chord.
    for (let k = 0; k < ghost.count; k++) {
      const t = k / GHOST_HZ;
      expect(player.pose(t, pos, quat)).toBe(true);
      src.at(t, want);
      worstPos = Math.max(worstPos, pos.distanceTo(want.position));
      worstAngle = Math.max(worstAngle, angleDeg(quat, visual(want)));
    }
    expect(worstPos).toBeLessThan(0.02);
    expect(worstAngle).toBeLessThan(0.5);
    // Between samples the player follows the chord: off the arc by at most its sag, r·θ²/8 with θ = ω / 20 Hz
    // (3 cm on this 600 m circle at 240 m/s), plus the 2 cm of quantisation.
    const sag = (600 * (0.4 / GHOST_HZ) ** 2) / 8;
    for (let t = 0.013; t < 30; t += 0.37) {
      expect(player.pose(t, pos, quat)).toBe(true);
      src.at(t, want);
      expect(pos.distanceTo(want.position)).toBeLessThan(sag + 0.02);
      expect(angleDeg(quat, visual(want))).toBeLessThan(0.5);
    }
  });

  it('a quaternion with any largest component, and either sign, survives the smallest-three packing', () => {
    const src = circle(50, 0);
    const rec = new GhostRecorder();
    rec.start();
    const qs = [new Quaternion(0.9, 0.1, -0.3, 0.3), new Quaternion(-0.1, -0.95, 0.2, 0.1), new Quaternion(0.2, 0.1, -0.9, -0.3), new Quaternion(-0.2, 0.3, 0.1, -0.9), new Quaternion(0, 0, 0, 1)].map((q) => q.normalize());
    for (const q of qs) {
      for (let s = 0; s < 6; s++) {
        src.pose.quaternion.copy(q);
        src.pose.bank = 0;
        rec.sample(src.pose);
      }
    }
    const ghost = decodeGhost(encodeGhost(rec.finish(1, [1], 'neon-bay', 'comet')))!;
    const player = new GhostPlayer(ghost);
    const out = new Quaternion();
    qs.forEach((q, k) => {
      player.pose(k / GHOST_HZ, new Vector3(), out);
      expect(angleDeg(out, q)).toBeLessThan(0.05);
    });
  });

  it('pose() is false past the ghost end and before its start', () => {
    const { ghost } = record(5);
    const player = new GhostPlayer(ghost);
    expect(player.duration).toBeCloseTo(5, 6);
    expect(player.pose(5, new Vector3(), new Quaternion())).toBe(true);
    expect(player.pose(5.06, new Vector3(), new Quaternion())).toBe(false);
    expect(player.pose(-0.1, new Vector3(), new Quaternion())).toBe(false);
  });

  it('a truncated, corrupt or unknown-version buffer decodes to null', () => {
    const buf = encodeGhost(record(4).ghost);
    expect(decodeGhost(buf.slice(0, buf.byteLength - 1))).toBeNull();
    expect(decodeGhost(buf.slice(0, 3))).toBeNull();
    expect(decodeGhost(new ArrayBuffer(0))).toBeNull();
    const bad = new Uint8Array(buf.slice(0));
    bad[5] = 0x7b; // garbage in the JSON header
    bad[6] = 0x7b;
    expect(decodeGhost(bad.buffer)).toBeNull();
    // Version 2 is unknown.
    const g = record(2).ghost;
    expect(decodeGhost(encodeGhost({ ...g, version: 2 as 1 }))).toBeNull();
    // A header whose count disagrees with the arrays.
    expect(decodeGhost(encodeGhost({ ...g, count: g.count + 1 }))).toBeNull();
  });

  it('a 100 s recording is under 30 KB (13 bytes a sample plus the header)', () => {
    const { ghost } = record(100);
    const bytes = encodeGhost(ghost).byteLength;
    expect(bytes).toBeLessThan(30 * 1024);
    expect(bytes).toBeLessThan(13 * ghost.count + 400);
  });

  it('the recorder allocates nothing per sample (it grows in blocks) and start() clears it', () => {
    const src = circle(100, 1);
    const rec = new GhostRecorder();
    rec.start();
    for (let i = 0; i < 6 * 50; i++) rec.sample(src.at(i * CONFIG.FIXED_DT));
    expect(rec.count).toBe(50);
    rec.start();
    expect(rec.count).toBe(0);
    rec.sample(src.at(0));
    expect(rec.finish(0.01, [], 'neon-bay', 'comet').count).toBe(1);
  });
});

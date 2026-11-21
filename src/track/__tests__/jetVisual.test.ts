/**
 * The jet visuals follow the hazard clock exactly as the physics does: idle vents show no bubbles and no column; over
 * the warning (twice as long in Rookie races) the bubble stream rises; while the jet fires its column stands straight
 * out of the tube on the vent. Three draw calls for every field of the track.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TRACK_DEFS } from '../../content/tracks';
import { trackFromSource } from '..';
import { JET_TIME, JET_WARNING, buildJets, jetActive } from '../features/jet';
import { buildJetVisual, jetColumnLength } from '../features/jetVisual';

const track = trackFromSource({ kind: 'authored', def: TRACK_DEFS['abyss-line'] });
const jets = buildJets(track);

function mesh(group: THREE.Group, name: string): THREE.InstancedMesh {
  return group.getObjectByName(name) as THREE.InstancedMesh;
}

/** Instance i's length along its own axis (the y scale) and its axis direction. */
function pose(m: THREE.InstancedMesh, i: number): { length: number; axis: THREE.Vector3; position: THREE.Vector3 } {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  // Read the y column directly: Matrix4.decompose reports a scale of 1 for a matrix with a zero scale.
  const yCol = new THREE.Vector3().setFromMatrixColumn(mat, 1);
  const position = new THREE.Vector3().setFromMatrixPosition(mat);
  return { length: yCol.length(), axis: yCol.clone().normalize(), position };
}

/** The start of vent j's first jet after t = 1 s. */
function firstJet(j: (typeof jets)[number]): number {
  let t = 1;
  while (jetActive(j, t)) t += 1 / 240;
  while (!jetActive(j, t)) t += 1 / 240;
  return t;
}

describe('jet visuals', () => {
  it('builds three instanced meshes with one instance per vent', () => {
    const v = buildJetVisual(jets, 0x40e0d0);
    for (const name of ['jet-vents', 'jet-streams', 'jet-columns']) expect(mesh(v.group, name).count).toBe(jets.length);
    let meshes = 0;
    v.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(3);
  });

  it('idle: no bubbles, no column; warning: bubbles; firing: a column straight out of the tube on the vent', () => {
    const v = buildJetVisual(jets, 0x40e0d0);
    const j = jets[0];
    const fire = firstJet(j);
    const streams = mesh(v.group, 'jet-streams');
    const columns = mesh(v.group, 'jet-columns');

    v.update(fire - JET_WARNING - 0.3);
    expect(pose(streams, 0).length).toBe(0);
    expect(pose(columns, 0).length).toBe(0);

    v.update(fire - JET_WARNING / 3);
    expect(pose(streams, 0).length).toBeGreaterThan(1);
    expect(pose(columns, 0).length).toBe(0);

    v.update(fire + JET_TIME / 2);
    const c = pose(columns, 0);
    expect(c.length).toBeGreaterThan(5);
    expect(c.axis.dot(j.up)).toBeGreaterThan(0.999);
    expect(c.position.distanceTo(j.position)).toBeLessThan(1e-4);
    // The bubbles stop once the jet fires.
    expect(pose(streams, 0).length).toBe(0);

    v.update(fire + JET_TIME + 0.2);
    expect(pose(columns, 0).length).toBe(0);
  });

  it('in Rookie races the bubbles start twice as early', () => {
    const j = jets[0];
    const fire = firstJet(j);
    const normal = buildJetVisual(jets, 0x40e0d0, 1);
    const rookie = buildJetVisual(jets, 0x40e0d0, 2);
    const t = fire - 1.5 * JET_WARNING;
    normal.update(t);
    rookie.update(t);
    expect(pose(mesh(normal.group, 'jet-streams'), 0).length).toBe(0);
    expect(pose(mesh(rookie.group, 'jet-streams'), 0).length).toBeGreaterThan(1);
  });

  it('the column shoots out, holds and collapses', () => {
    expect(jetColumnLength(0)).toBe(0);
    expect(jetColumnLength(0.05)).toBeGreaterThan(0.5);
    expect(jetColumnLength(0.5)).toBe(1);
    expect(jetColumnLength(0.9)).toBeLessThan(0.5);
    expect(jetColumnLength(1)).toBe(0);
  });
});

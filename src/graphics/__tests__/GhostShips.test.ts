import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GhostFrame } from '../../core/contracts';
import { FADE_FAR, FADE_NEAR, GHOST_COLORS, GHOST_COLORS_CB, GHOST_OPACITY, GhostShips, ghostFade, ghostGeometry } from '../GhostShips';

function frame(kind: 'best' | 'dev', x: number): GhostFrame {
  return { kind, chassisId: 'comet', position: new THREE.Vector3(x, 0, -50), quaternion: new THREE.Quaternion(), visible: true };
}

describe('GhostShips (IMPLEMENTATION §M8b step 6)', () => {
  it('fades from full at 12 m to nothing at 4 m', () => {
    expect(FADE_FAR).toBe(12);
    expect(FADE_NEAR).toBe(4);
    expect(ghostFade(30)).toBe(1);
    expect(ghostFade(12)).toBe(1);
    expect(ghostFade(4)).toBe(0);
    expect(ghostFade(1)).toBe(0);
    expect(ghostFade(8)).toBeCloseTo(0.5, 9);
  });

  it('one mesh per ghost, translucent, unlit, no depth write, no shadow; cyan and gold, blue and orange when colour-blind', () => {
    const scene = new THREE.Scene();
    const g = new GhostShips(scene);
    g.set([frame('best', 0), frame('dev', 5)], null);
    const meshes = scene.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    expect(meshes).toHaveLength(2);
    for (const m of meshes) {
      expect(m.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(m.material.transparent).toBe(true);
      expect(m.material.depthWrite).toBe(false);
      expect(m.material.fog).toBe(true);
      expect(m.castShadow).toBe(false);
      expect(m.children).toHaveLength(0); // one geometry, one material: one draw call
    }
    expect(meshes[0].material.color.getHex()).toBe(GHOST_COLORS.best);
    expect(meshes[1].material.color.getHex()).toBe(GHOST_COLORS.dev);
    g.setColorBlind(true);
    expect(meshes[0].material.color.getHex()).toBe(GHOST_COLORS_CB.best);
    expect(meshes[1].material.color.getHex()).toBe(GHOST_COLORS_CB.dev);
  });

  it('draws a ghost only when it is on, in its run and away from the camera; the dev tag follows the dev ghost', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 2000);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 0, -50);
    camera.updateMatrixWorld();
    const best = frame('best', -3);
    const dev = frame('dev', 3);
    const g = new GhostShips(scene);
    g.set([best, dev], null);
    g.update(camera);
    expect(g.drawn).toBe(2);
    const [mb] = scene.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    expect(mb.material.opacity).toBeCloseTo(GHOST_OPACITY, 9);
    expect(mb.position.toArray()).toEqual([-3, 0, -50]);
    expect(g.devTag.visible).toBe(true);
    expect(g.devTag.x).toBeGreaterThan(0.5); // right of centre, as the dev ghost is
    // Off or past its end: not drawn.
    dev.visible = false;
    g.update(camera);
    expect(g.drawn).toBe(1);
    expect(g.devTag.visible).toBe(false);
    // At the camera: faded out, not drawn.
    best.position.set(0, 1, -2);
    g.update(camera);
    expect(g.drawn).toBe(0);
    g.clear();
    expect(scene.children).toHaveLength(0);
  });

  it('without ship assets the ghost is a small wedge', () => {
    const geo = ghostGeometry(null, 'comet');
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(3);
    expect(size.x).toBeLessThan(3);
  });
});

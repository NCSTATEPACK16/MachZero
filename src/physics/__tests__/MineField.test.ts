import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import { TRACK_DEFS } from '../../content/tracks';
import { trackFromSource } from '../../track';
import { MineField, type MineTarget } from '../MineField';

const neon = trackFromSource({ kind: 'authored', def: TRACK_DEFS['neon-bay'] });
const orbital = trackFromSource({ kind: 'authored', def: TRACK_DEFS['orbital-ring'] });
const HALF = { x: 1.2, y: 0.4, z: 2.4 };

/** A hull sitting on the mine (`id` touching it). */
function on(field: MineField, index: number, id: number): MineTarget {
  return { id, position: field.mines[index].position.clone(), quaternion: new THREE.Quaternion(), half: HALF };
}

describe('MineField: dropped mines (Drop Mine item)', () => {
  it('keeps a fixed pool after the track mines; free slots are unarmed', () => {
    const f = new MineField(orbital);
    expect(f.dropBase).toBeGreaterThan(0);
    expect(f.mines).toHaveLength(f.dropBase + CONFIG.DROP_MINE_MAX);
    expect(f.mines.slice(f.dropBase).every((m) => !m.armed)).toBe(true);
    expect(new MineField(neon).dropBase).toBe(0);
  });

  it('spares its dropper for 1.5 s, but not anyone else', () => {
    const f = new MineField(neon);
    const i = f.drop(3, 0.2, 2, 10);
    expect(f.mines[i]).toMatchObject({ owner: 3, armed: true, lateral: 2 });
    expect(f.test(on(f, i, 3), 10 + CONFIG.DROP_MINE_GRACE - 0.05)).toBeNull();
    expect(f.test(on(f, i, 4), 10.1)?.mine.index).toBe(i);
    // Gone once hit: no re-arm.
    expect(f.mines[i].armed).toBe(false);
    f.update(30);
    expect(f.mines[i].armed).toBe(false);
    expect(f.droppedCount).toBe(0);

    const j = f.drop(3, 0.4, 0, 40);
    expect(f.test(on(f, j, 3), 40 + CONFIG.DROP_MINE_GRACE + 0.01)?.mine.index).toBe(j);
  });

  it('holds still and fades out after 20 s', () => {
    const f = new MineField(neon);
    const i = f.drop(1, 0.5, -3, 5);
    const at = f.mines[i].position.clone();
    f.update(5 + CONFIG.DROP_MINE_LIFE - 0.01);
    expect(f.mines[i].armed).toBe(true);
    expect(f.mines[i].position.distanceTo(at)).toBe(0);
    f.update(5 + CONFIG.DROP_MINE_LIFE);
    expect(f.mines[i].armed).toBe(false);
    expect(f.droppedCount).toBe(0);
  });

  it('keeps at most 6 on the track: the oldest goes', () => {
    const f = new MineField(neon);
    const first = f.drop(1, 0.1, 0, 1);
    for (let k = 1; k < CONFIG.DROP_MINE_MAX; k++) f.drop(1, 0.1 + k * 0.05, 0, 1 + k);
    expect(f.droppedCount).toBe(CONFIG.DROP_MINE_MAX);
    const seventh = f.drop(2, 0.9, 1, 20);
    expect(seventh).toBe(first);
    expect(f.mines[first]).toMatchObject({ owner: 2, lateral: 1, armed: true });
    expect(f.droppedCount).toBe(CONFIG.DROP_MINE_MAX);
  });

  it('places the mine on the deck at hover height, and a reset clears every dropped mine', () => {
    const f = new MineField(neon);
    const i = f.drop(1, 0.3, 4, 0);
    const s = neon.sampleAt(0.3);
    const expected = s.position.clone().addScaledVector(s.right, 4).addScaledVector(s.up, CONFIG.HOVER_HEIGHT);
    expect(f.mines[i].position.distanceTo(expected)).toBeLessThan(1e-6);
    f.reset(0);
    expect(f.droppedCount).toBe(0);
    expect(f.mines[i].armed).toBe(false);
  });
});

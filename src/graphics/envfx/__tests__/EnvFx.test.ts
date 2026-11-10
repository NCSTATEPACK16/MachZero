import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TRACK_DEFS } from '../../../content/tracks';
import { trackFromSource } from '../../../track';
import { createFogUniforms } from '../../shaders/fog';
import { createTheme } from '../../themes';
import { EnvFx, type EnvFxHost } from '../EnvFx';
import { ENVFX_MAX_DRAW_CALLS, NO_ENVFX, flashTime, type EnvFxPlan } from '../EnvFxSpec';
import { applyWetDeck } from '../WetDeck';

function host() {
  const h = { grade: null as EnvFxPlan['grade'], flash: [0, 0, 0], surface: null as EnvFxPlan['surface'] };
  const api: EnvFxHost = {
    setGrade: (g) => (h.grade = g),
    setFlash: (r, g, b) => (h.flash = [r, g, b]),
    setSurface: (s) => (h.surface = s),
  };
  return { h, api };
}

const track = trackFromSource({ kind: 'authored', def: TRACK_DEFS['neon-bay'] });
const theme = createTheme('neon-bay', createFogUniforms(0, 0.001));
const world = { spec: theme.envfx!, leftNeon: 0x19f0ff, rightNeon: 0xff2bd6, sunDirection: theme.sunDirection };
const camera = new THREE.PerspectiveCamera();

describe('EnvFx on Neon Bay (IMPLEMENTATION §X2)', () => {
  it('a world with no effects adds nothing', () => {
    const { h, api } = host();
    const fx = new EnvFx(api);
    fx.setWorld({ ...world, spec: NO_ENVFX });
    fx.build(track, null);
    expect(fx.group.children).toHaveLength(0);
    expect(fx.drawCalls).toBe(0);
    expect(h.grade).toBeNull();
    expect(h.surface).toBeNull();
  });

  it('stays inside the draw-call budget on every preset, and Low drops the shafts', () => {
    for (const level of ['high', 'med', 'low'] as const) {
      const { h, api } = host();
      const fx = new EnvFx(api);
      fx.setQuality(level);
      fx.setWorld(world);
      fx.build(trackFromSource({ kind: 'authored', def: TRACK_DEFS['neon-bay'] }), null);
      // Without props.glb: weather, fog and (Med/High) shafts. The airship adds 2 meshes (dark + neon).
      expect(fx.drawCalls).toBe(level === 'low' ? 2 : 3);
      expect(fx.drawCalls + 2).toBeLessThanOrEqual(ENVFX_MAX_DRAW_CALLS);
      expect(h.grade).not.toBeNull();
      expect(h.surface?.ships).toBe(level === 'low' ? 'player' : 'all');
      fx.dispose();
      expect(fx.group.children).toHaveLength(0);
    }
  });

  it('a preset change mid-session rescales what is built without rebuilding', () => {
    const { api } = host();
    const fx = new EnvFx(api);
    fx.setWorld(world);
    fx.build(track, null);
    const weather = fx.group.children.find((c) => c.name.startsWith('weather')) as THREE.Mesh;
    const geo = weather.geometry as THREE.InstancedBufferGeometry;
    const full = geo.instanceCount;
    fx.setQuality('low');
    expect(geo.instanceCount).toBe(Math.round(full * 0.3));
    expect(fx.group.children.find((c) => c.name.startsWith('weather'))).toBe(weather);
    fx.setQuality('high');
    expect(geo.instanceCount).toBe(full);
  });

  it('flashes at the fixed ambient times and fades; reduced motion shows none', () => {
    const { h, api } = host();
    const fx = new EnvFx(api);
    fx.setWorld(world);
    fx.build(track, null);
    const first = flashTime(theme.envfx!.lightning!.rate, 0);
    fx.update(camera, first - 0.1, 1 / 60);
    expect(fx.flash).toBe(0);
    fx.update(camera, first + 0.01, 1 / 60);
    expect(fx.flash).toBeGreaterThan(0);
    expect(h.flash[2]).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) fx.update(camera, first + 0.02 + i / 60, 1 / 60);
    expect(fx.flash).toBe(0);

    fx.setReducedMotion(true);
    fx.flashNow(1);
    fx.update(camera, flashTime(theme.envfx!.lightning!.rate, 1) + 0.01, 1 / 60);
    expect(fx.flash).toBe(0);
    expect(h.flash).toEqual([0, 0, 0]);
  });

  it('the wet-look deck changes the deck material only', () => {
    const t = trackFromSource({ kind: 'authored', def: TRACK_DEFS['neon-bay'] });
    const deck = t.visual.getObjectByName('TrackDeck') as THREE.Mesh;
    const rail = t.visual.children.find((c) => (c as THREE.Mesh).isMesh && c !== deck) as THREE.Mesh;
    const before = (deck.material as THREE.MeshStandardMaterial).roughness;
    const railRough = (rail.material as THREE.MeshStandardMaterial).roughness;
    expect(applyWetDeck(t.visual, { gloss: 0.7, streak: 0.3 }, 0x19f0ff, 0xff2bd6)).toBe(1);
    expect((deck.material as THREE.MeshStandardMaterial).roughness).toBeLessThan(before);
    expect((rail.material as THREE.MeshStandardMaterial).roughness).toBe(railRough);
  });
});

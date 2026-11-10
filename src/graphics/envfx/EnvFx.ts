/**
 * Runs the active world's environment effects (IMPLEMENTATION §X2). GraphicsSystem owns one EnvFx: it hands
 * over the theme's `EnvFxSpec` when the world changes, builds the track-dependent pieces with each track, and
 * calls `update` once a frame. Everything here is visual; nothing feeds back into the game.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TrackData } from '../../core/contracts';
import type { QualityLevel } from '../../settings/QualityManager';
import type { RoleMaterials } from '../themes/WorldTheme';
import { NO_ENVFX, flashTime, resolveEnvFx, type EnvFxPlan, type EnvFxSpec } from './EnvFxSpec';
import { FogSheets } from './FogSheets';
import { SetPieces } from './SetPieces';
import { Shafts } from './Shafts';
import { Weather } from './Weather';
import { applyWetDeck } from './WetDeck';

/** What EnvFx needs from the rest of the renderer. */
export interface EnvFxHost {
  setGrade(grade: EnvFxPlan['grade']): void;
  /** Linear RGB added to the whole frame. */
  setFlash(r: number, g: number, b: number): void;
  setSurface(surface: EnvFxPlan['surface']): void;
}

export interface EnvFxWorld {
  spec: EnvFxSpec;
  /** Track neon colours, for the wet-look streaks. */
  leftNeon: number;
  rightNeon: number;
  sunDirection: THREE.Vector3;
  /** Materials for set-piece props (the theme's own prop materials). */
  materials?: RoleMaterials;
}

/** Flash decay per second (a flash is over in about 0.2 s). */
const FLASH_DECAY = 14;

export class EnvFx {
  readonly group = new THREE.Group();
  private world: EnvFxWorld = { spec: NO_ENVFX, leftNeon: 0xffffff, rightNeon: 0xffffff, sunDirection: new THREE.Vector3(0, 1, 0) };
  private level: QualityLevel = 'high';
  private reducedMotion = false;
  private plan: EnvFxPlan = resolveEnvFx(NO_ENVFX, 'high', false);
  private weather: Weather | null = null;
  private fog: FogSheets | null = null;
  private shafts: Shafts | null = null;
  private pieces: SetPieces | null = null;
  private flashLevel = 0;
  private readonly flashColor = new THREE.Color(0xffffff);
  private flashIndex = 0;
  private lastTime = 0;

  constructor(private readonly host: EnvFxHost) {
    this.group.name = 'envfx';
  }

  /** Current flash brightness, 0..1 (GraphicsSystem lifts the scene lights with it). */
  get flash(): number {
    return this.flashLevel;
  }

  /** Draw calls the effects add right now. */
  get drawCalls(): number {
    return (this.weather ? 1 : 0) + (this.fog ? 1 : 0) + (this.shafts ? 1 : 0) + (this.pieces?.meshCount ?? 0);
  }

  /** A new world: forget the old world's effects and apply the frame-wide ones (grade, surface). */
  setWorld(world: EnvFxWorld): void {
    this.clear();
    this.world = world;
    this.replan();
  }

  setQuality(level: QualityLevel): void {
    if (level === this.level) return;
    this.level = level;
    this.replan();
    this.applyLive();
  }

  setReducedMotion(on: boolean): void {
    if (on === this.reducedMotion) return;
    this.reducedMotion = on;
    this.replan();
    this.applyLive();
    if (on) this.stopFlash();
  }

  private replan(): void {
    this.plan = resolveEnvFx(this.world.spec, this.level, this.reducedMotion);
    this.host.setGrade(this.plan.grade);
    this.host.setSurface(this.plan.surface);
  }

  /** Settings changed mid-session: adjust what is already built (counts and motion; nothing is compiled). */
  private applyLive(): void {
    const p = this.plan;
    if (this.weather) {
      this.weather.setDrawn(p.weather?.drawn ?? 0);
      if (p.weather) this.weather.setStreak(p.weather.streak);
    }
    if (this.fog && p.heightFog) {
      this.fog.setSheets(p.heightFog.sheets);
      this.fog.setMoving(p.heightFog.moving);
    }
    this.shafts?.setDrawn(p.shafts?.drawn ?? 0);
  }

  /**
   * Build the effects for a track (call before the shader warm-up, so nothing compiles mid-race). The
   * wet-look deck changes the track's own deck material.
   */
  build(track: TrackData, props: GLTF | null): void {
    this.clear();
    const p = this.plan;
    const spec = this.world.spec;
    // Weather and shafts are built at the spec's full count and drawn at the preset's, so a preset change
    // mid-session needs no rebuild.
    if (spec.weather && p.weather) {
      this.weather = new Weather({ ...spec.weather, streak: p.weather.streak }, p.weather.drawn);
      this.group.add(this.weather.mesh);
    }
    if (p.heightFog) {
      this.fog = new FogSheets(p.heightFog, p.heightFog.sheets, p.heightFog.moving);
      this.group.add(this.fog.mesh);
    }
    if (spec.shafts && p.shafts) {
      this.shafts = new Shafts(spec.shafts, p.shafts.drawn, track, this.world.sunDirection);
      this.group.add(this.shafts.mesh);
    }
    if (p.setPieces.length && props && this.world.materials) {
      this.pieces = new SetPieces(p.setPieces, track, props, this.world.materials);
      this.group.add(this.pieces.group);
    }
    if (p.wetDeck) applyWetDeck(track.visual, p.wetDeck, this.world.leftNeon, this.world.rightNeon);
    this.flashIndex = 0;
    this.lastTime = 0;
  }

  /** A flash now (a hazard's lightning strike). No effect with reduced motion. */
  flashNow(strength = 1, color?: number): void {
    if (this.reducedMotion) return;
    if (color !== undefined) this.flashColor.setHex(color);
    this.flashLevel = Math.max(this.flashLevel, Math.min(1, strength));
  }

  private stopFlash(): void {
    this.flashLevel = 0;
    this.host.setFlash(0, 0, 0);
  }

  /** Slant the weather with a gust (m/s across the world); a track's wind zones drive this. */
  setWeatherWind(x: number, z: number): void {
    this.weather?.setWind(x, z);
  }

  update(camera: THREE.Camera, time: number, dt: number): void {
    this.weather?.update(camera, time, dt);
    this.fog?.update(camera, time);
    this.pieces?.update(time);

    const l = this.plan.lightning;
    if (time < this.lastTime) this.flashIndex = 0; // the race clock restarted
    this.lastTime = time;
    if (l) {
      // Ambient flashes at fixed race times; if many are overdue (a long pause), only the last one shows.
      let due = false;
      while (flashTime(l.rate, this.flashIndex) <= time) {
        this.flashIndex++;
        due = true;
      }
      if (due) this.flashNow(l.flash, l.color);
    }
    if (this.flashLevel > 0) {
      this.flashLevel *= Math.exp(-FLASH_DECAY * dt);
      if (this.flashLevel < 0.004) this.flashLevel = 0;
      const k = this.flashLevel * 0.9;
      this.host.setFlash(this.flashColor.r * k, this.flashColor.g * k, this.flashColor.b * k);
    }
  }

  /** Remove the built effects (between tracks). The deck material belongs to the track and goes with it. */
  clear(): void {
    this.weather?.dispose();
    this.fog?.dispose();
    this.shafts?.dispose();
    this.pieces?.dispose();
    this.weather = this.fog = this.shafts = this.pieces = null;
    this.group.clear();
    this.stopFlash();
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * One race: track, Rapier world, drivers, RaceManager and (optionally) its HUD and bindings to the app's
 * long-lived graphics and audio. Built by `create`, torn down completely by `dispose`, so the App can run
 * any number of races in one page. Node-safe without a view (headless tests).
 */
import type { ControlInput, FrameContext, HudActions, ShipDefinition, ShipId, ShipState, TrackData } from '../core/contracts';
import { neutralControls } from '../core/controls';
import { EventBus, type GameBus, type GameEvents } from '../core/events';
import { AIDriver, HUD, RaceManager, type AudioSystem, type RecordStore } from '../game';
import { disposeObject3D } from '../graphics/dispose';
import type { GraphicsSystem } from '../graphics';
import { PhysicsSystem } from '../physics';
import { trackFromSource, type TrackLayoutSource, type TrackPalette } from '../track';

export interface RaceSetup {
  /** Seeded (classic / Bonus Track) or an authored world track. */
  source: TrackLayoutSource;
  /** Track neon colours (the world's); default v1 cyan / magenta. */
  palette?: TrackPalette;
  /** World theme for the scenery ('neon-bay' for seeded tracks). */
  worldId: string;
  /** Key for records: 'classic' | 'bonus-<seed>' | a world track id. */
  trackKey: string;
  field: ShipDefinition[];
  /** The player's ship is driven by its AI. */
  autopilot: boolean;
  records?: RecordStore;
}

/** Browser presentation attached to a session. */
export interface RaceView {
  graphics: GraphicsSystem;
  audio: AudioSystem;
  hudRoot: HTMLElement;
  actions: HudActions;
  /** v1 start screen inside the HUD (only without the menu UI). */
  showTitle: boolean;
}

export class RaceSession {
  readonly ships: ShipState[];
  readonly player: ShipState;
  readonly race: RaceManager;
  private readonly drivers = new Map<ShipId, AIDriver>();
  private readonly controls = new Map<ShipId, ControlInput>();
  private view: RaceView | null = null;
  private hud: HUD | null = null;
  private disposed = false;

  private constructor(
    readonly setup: RaceSetup,
    readonly track: TrackData,
    readonly physics: PhysicsSystem,
    readonly bus: GameBus,
  ) {
    this.ships = setup.field.map((def) => physics.addShip(def, track.startGrid[def.gridIndex]));
    const player = this.ships.find((s) => s.def.isPlayer);
    if (!player) throw new Error('RaceSession: the field has no player');
    this.player = player;
    // Every ship gets a driver; the player's steers only on autopilot or after the finish line.
    for (const ship of this.ships) {
      const personality = ship.def.personality ?? 'steady';
      this.drivers.set(ship.def.id, new AIDriver(ship, track, personality, track.seed * 31 + ship.def.id * 7919, this.ships));
      this.controls.set(ship.def.id, neutralControls());
    }
    this.race = new RaceManager(track, this.ships, this.bus, setup.records);
  }

  static async create(setup: RaceSetup): Promise<RaceSession> {
    const track = trackFromSource(setup.source, { palette: setup.palette });
    const bus: GameBus = new EventBus<GameEvents>();
    return new RaceSession(setup, track, await PhysicsSystem.create(track, bus), bus);
  }

  get state() {
    return this.race.state;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Put this race on screen and wire it to audio. */
  attachView(view: RaceView): void {
    if (this.view) throw new Error('RaceSession: view already attached');
    this.view = view;
    view.graphics.attachBus(this.bus);
    view.graphics.setWorld(this.setup.worldId);
    view.graphics.setTrack(this.track);
    for (const ship of this.ships) view.graphics.addShip(ship);
    view.audio.attach(this.bus);
    this.hud = new HUD(view.hudRoot, this.bus, this.track, view.actions, { showTitle: view.showTitle });
  }

  /** One fixed step. `human` is the player's input, or null when nobody is driving (menus, autopilot). */
  fixed(dt: number, human: ControlInput | null): void {
    if (this.disposed || this.race.state === 'paused') return;
    const driven = human !== null && !this.setup.autopilot && this.player.status !== 'finished';
    for (const ship of this.ships) {
      const id = ship.def.id;
      this.controls.set(id, ship === this.player && driven ? human : this.drivers.get(id)!.update(dt));
    }
    this.physics.step(dt, this.controls);
    this.race.fixedUpdate(dt);
  }

  /** Per-frame presentation (the App renders afterwards). */
  frame(dt: number, alpha: number, time: number): void {
    if (this.disposed || !this.view) return;
    const ctx: FrameContext = { dt, alpha, time, ships: this.ships, player: this.player, track: this.track, race: this.race.snapshot() };
    this.view.graphics.update(ctx);
    this.hud?.update(ctx.race, dt);
    this.view.audio.update(ctx);
  }

  /** title/results → countdown. */
  start(): void {
    if (this.race.state === 'results') this.resetToGrid();
    if (this.race.state === 'title') this.race.start();
  }

  restart(): void {
    this.resetToGrid();
    this.race.start();
  }

  /** Back to the pre-race title state (menu backdrop). */
  toTitle(): void {
    this.resetToGrid();
  }

  togglePause(): void {
    const s = this.race.state;
    if (s === 'racing' || s === 'countdown') this.race.pause(true);
    else if (s === 'paused') this.race.pause(false);
  }

  pause(paused: boolean): void {
    this.race.pause(paused);
  }

  private resetToGrid(): void {
    for (const ship of this.ships) this.physics.resetShip(ship.def.id, this.track.startGrid[ship.def.gridIndex]);
    this.race.reset();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hud?.dispose();
    this.hud = null;
    if (this.view) {
      this.view.audio.detach();
      this.view.graphics.clearRace();
      this.view = null;
    }
    this.physics.dispose();
    disposeObject3D(this.track.visual);
    this.bus.clear();
    this.drivers.clear();
    this.controls.clear();
  }
}

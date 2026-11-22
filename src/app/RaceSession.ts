/**
 * One race: track, Rapier world, drivers, RaceManager and (optionally) its HUD and bindings to the app's
 * long-lived graphics and audio. Built by `create`, torn down completely by `dispose`, so the App can run
 * any number of races in one page. Node-safe without a view (headless tests).
 */
import type { Rumble } from '../game/Rumble';
import type { TouchRig } from '../game/TouchControls';
import { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../core/config';
import type { Assists, ControlInput, FrameContext, GhostFrame, HudActions, ShipDefinition, ShipId, ShipState, TrackData } from '../core/contracts';
import { neutralControls } from '../core/controls';
import { EventBus, type GameBus, type GameEvents } from '../core/events';
import { HAZARDS_NORMAL, type HazardPolicy } from '../core/hazards';
import { AIDriver, HUD, RaceManager, type AudioSystem, type RecordStore } from '../game';
import { ItemSystem, type PlayerItems } from '../game/ItemSystem';
import { GhostCapture } from '../game/ghost/GhostCapture';
import type { GhostData } from '../game/ghost/ghostCodec';
import { GhostPlayer } from '../game/ghost/GhostPlayer';
import type { TrialHud } from '../game/HUD';
import { disposeObject3D } from '../graphics/dispose';
import { rosterOf } from '../game/pilotPortrait';
import type { GraphicsSystem } from '../graphics';
import { PhysicsSystem } from '../physics';
import { PlayerAssists } from '../physics/Assists';
import { NO_ASSISTS } from '../save/schema';
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
  /** How track hazards treat ships (default normal). */
  hazards?: Readonly<HazardPolicy>;
  records?: RecordStore;
  /** The player's item stock (the active profile's; `use` spends one). None: the player has no items. */
  items?: PlayerItems;
  /** The player's assists in force (IMPLEMENTATION §M7a; default none). `setAssists` changes them mid-race. */
  assists?: Readonly<Assists>;
  /**
   * A Time Trial (IMPLEMENTATION §M8b): the field is the player alone, there are no items, and the player's run is
   * recorded as a ghost. `ghosts` are the ones to show (switched-off and missing ghosts are left out).
   */
  trial?: { ghosts: { kind: 'best' | 'dev'; data: GhostData }[]; hud: TrialHud };
}

/** A shown ghost: its player and the frame the graphics read. */
interface LiveGhost {
  player: GhostPlayer;
  frame: GhostFrame;
}

/** Browser presentation attached to a session. */
export interface RaceView {
  graphics: GraphicsSystem;
  audio: AudioSystem;
  hudRoot: HTMLElement;
  actions: HudActions;
  /** v1 start screen inside the HUD (only without the menu UI). */
  showTitle: boolean;
  /** False when a menu screen shows the results (IMPLEMENTATION §M8a): the HUD builds no results panel. */
  results?: boolean;
  /** Controller rumble for the player's ship (§V.3); optional. */
  rumble?: Rumble;
  /** The touch controls (IMPLEMENTATION §M7b; with the `touch` feature): the HUD builds them in the race view. */
  touch?: TouchRig;
}

export class RaceSession {
  readonly ships: ShipState[];
  readonly player: ShipState;
  readonly race: RaceManager;
  readonly items: ItemSystem;
  private readonly drivers = new Map<ShipId, AIDriver>();
  private readonly controls = new Map<ShipId, ControlInput>();
  private readonly playerAssists: PlayerAssists;
  private assists: Readonly<Assists> = NO_ASSISTS;
  private view: RaceView | null = null;
  private hud: HUD | null = null;
  private disposed = false;
  /** Time Trial: the recorder of the player's run, and the ghosts shown. */
  private readonly capture: GhostCapture | null = null;
  private readonly ghosts: LiveGhost[] = [];
  private readonly ghostFrames: GhostFrame[] = [];

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
      this.drivers.set(ship.def.id, new AIDriver(ship, track, personality, track.seed * 31 + ship.def.id * 7919, this.ships, { hazardClock: () => physics.hazardTime, liveMines: () => physics.mines }));
      this.controls.set(ship.def.id, neutralControls());
    }
    this.playerAssists = new PlayerAssists(track);
    this.setAssists(setup.assists ?? NO_ASSISTS);
    this.race = new RaceManager(track, this.ships, this.bus, setup.records);
    this.items = new ItemSystem({ ships: this.ships, player, race: this.race, bus, physics, track }, track.seed, setup.items);
    if (setup.trial) {
      this.capture = new GhostCapture(bus, player, setup.trackKey);
      for (const g of setup.trial.ghosts) {
        const frame: GhostFrame = { kind: g.kind, chassisId: g.data.chassisId, position: new Vector3(), quaternion: new Quaternion(), visible: false };
        this.ghosts.push({ player: new GhostPlayer(g.data), frame });
        this.ghostFrames.push(frame);
      }
    }
  }

  /** A Time Trial race. */
  get isTrial(): boolean {
    return this.setup.trial !== undefined;
  }

  /** The ghost of the player's last finished run in a Time Trial, or null. */
  get trialGhost(): GhostData | null {
    return this.capture?.result ?? null;
  }

  /** The ghosts this trial shows (debug and e2e: `__machzero.ghosts()`). */
  get shownGhosts(): readonly { kind: 'best' | 'dev'; totalTime: number; visible: boolean }[] {
    return this.ghosts.map((g) => ({ kind: g.frame.kind, totalTime: g.player.ghost.totalTime, visible: g.frame.visible }));
  }

  static async create(setup: RaceSetup): Promise<RaceSession> {
    const hazards = setup.hazards ?? HAZARDS_NORMAL;
    const track = trackFromSource(setup.source, { palette: setup.palette, telegraphScale: hazards.telegraphScale });
    const bus: GameBus = new EventBus<GameEvents>();
    return new RaceSession(setup, track, await PhysicsSystem.create(track, bus, { hazards }), bus);
  }

  get state() {
    return this.race.state;
  }

  /** The HUD's title, pause or results panel when one is up (gamepad focus navigation). */
  get hudOverlay(): HTMLElement | null {
    return this.hud?.overlay ?? null;
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
    if (this.ghostFrames.length) view.graphics.setGhosts(this.ghostFrames);
    view.audio.attach(this.bus);
    view.rumble?.attach(this.bus, this.player.def.id);
    this.hud = new HUD(view.hudRoot, this.bus, this.track, view.actions, { showTitle: view.showTitle, results: view.results !== false, roster: rosterOf(this.setup.field), ...(view.touch ? { touch: view.touch } : {}), ...(this.setup.trial ? { trial: this.setup.trial.hud } : {}) });
  }

  /** The player's assists in force. */
  get activeAssists(): Readonly<Assists> {
    return this.assists;
  }

  /**
   * Change the player's assists; they act from the next fixed step. The hazard rules were fixed when the race was
   * built (`setup.hazards`) and do not follow No-KO until the next race. Turning boost-from-lap-1 on unlocks the boost
   * at once; turning it off mid-race leaves an unlocked boost unlocked (it locks again at the next start).
   */
  setAssists(a: Readonly<Assists>): void {
    this.assists = { ...a };
    const p = this.player;
    p.noKO = a.noKO;
    p.earlyBoost = a.earlyBoost;
    if (a.earlyBoost && p.status !== 'finished' && p.status !== 'retired') p.boostUnlocked = true;
  }

  /** The grid intro card before the countdown (shown while the race waits on the title state). */
  setIntro(on: boolean): void {
    this.hud?.setIntro(on);
  }

  /** One fixed step. `human` is the player's input, or null when nobody is driving (menus, autopilot). */
  fixed(dt: number, human: ControlInput | null): void {
    if (this.disposed || this.race.state === 'paused') return;
    const driven = human !== null && !this.setup.autopilot && this.player.status !== 'finished';
    for (const ship of this.ships) {
      const id = ship.def.id;
      // The player's controls go through the assists; the item system still reads the raw input (fire and cycle).
      this.controls.set(id, ship === this.player && driven ? this.playerAssists.apply(ship, human, this.assists) : this.drivers.get(id)!.update(dt));
    }
    this.items.fixed(dt, driven ? human : null);
    this.physics.step(dt, this.controls);
    this.race.fixedUpdate(dt);
    this.capture?.step();
  }

  /** Each ghost's pose at the race time this frame shows (the ships are drawn `alpha` of a step behind). */
  private poseGhosts(alpha: number): void {
    if (this.ghosts.length === 0) return;
    const s = this.race.state;
    const t = s === 'racing' ? Math.max(0, this.race.time - (1 - alpha) * CONFIG.FIXED_DT) : s === 'results' || s === 'paused' ? this.race.time : 0;
    for (const g of this.ghosts) g.frame.visible = g.player.pose(t, g.frame.position, g.frame.quaternion);
  }

  /** Per-frame presentation (the App renders afterwards). */
  frame(dt: number, alpha: number, time: number): void {
    if (this.disposed || !this.view) return;
    this.poseGhosts(alpha);
    const ctx: FrameContext = {
      dt,
      alpha,
      time,
      hazardTime: this.physics.hazardTime,
      ...(this.physics.mines.length > 0 ? { mines: this.physics.mines } : {}),
      ships: this.ships,
      player: this.player,
      track: this.track,
      race: this.race.snapshot(),
      ...(this.ghostFrames.length > 0 ? { ghosts: this.ghostFrames } : {}),
    };
    this.view.graphics.update(ctx);
    this.hud?.setItems(this.items.playerView());
    this.hud?.update(ctx.race, dt, ctx.hazardTime, ctx.ghosts, ctx.ghosts ? this.view.graphics.ghostTag : null);
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
    this.physics.resetTime();
    for (const ship of this.ships) this.physics.resetShip(ship.def.id, this.track.startGrid[ship.def.gridIndex]);
    this.race.reset();
    this.items.reset();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hud?.dispose();
    this.hud = null;
    if (this.view) {
      this.view.audio.detach();
      this.view.rumble?.detach();
      this.view.graphics.clearRace();
      this.view = null;
    }
    this.capture?.dispose();
    this.physics.dispose();
    disposeObject3D(this.track.visual);
    this.bus.clear();
    this.drivers.clear();
    this.controls.clear();
  }
}

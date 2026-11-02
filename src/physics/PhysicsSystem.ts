import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, EventQueue, RigidBody, TempContactManifold, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HAZARDS_NORMAL, type HazardPolicy } from '../core/hazards';
import { COLLISION, CONFIG } from '../core/config';
import type {
  ControlInput,
  GridSlot,
  IPhysicsSystem,
  ShipDefinition,
  ShipId,
  ShipState,
  TrackData,
  TriMesh,
} from '../core/contracts';
import { neutralControls } from '../core/controls';
import type { GameBus } from '../core/events';
import { clamp01 } from '../core/math';
import { ShipController, TUNING } from './ShipController';
import { CLASS_SCALE, chassisById } from '../content/ships';
import { type BuiltGate, buildGates, gateClosure, gatePose } from '../track/features/gate';
import { type BuiltDebris, buildDebris, debrisLateral, debrisPose } from '../track/features/debris';
import { MineField, type MineState } from './MineField';

/** Contact accumulation for one collider pair (all manifolds of a trimesh contact are merged). */
interface ContactAccumulator {
  /** Sum of manifold normals as reported by Rapier (unoriented). */
  nx: number;
  ny: number;
  nz: number;
  count: number;
  /** Deepest contact point (world space). */
  px: number;
  py: number;
  pz: number;
  depth: number;
}

/** Seconds during which renewed contact with the same obstacle is the same hit (event and Rookie slow-down once). */
const OBSTACLE_HIT_COOLDOWN = 1;
/** Seconds during which renewed ship-to-ship contact of the same pair is the same impact (damage and event). */
const SHIP_HIT_INTERVAL = 0.2;

function pairKey(a: ShipId, b: ShipId): number {
  return a < b ? a * 1024 + b : b * 1024 + a;
}

/** A moving solid hazard: a stone gate (Jade Ruins) or a piece of debris (Orbital Ring). */
interface Obstacle {
  kind: 'gate' | 'debris';
  /** Index in `gates` or `debris`. */
  index: number;
  body: RigidBody;
  collider: Collider;
}

/**
 * Rapier world wrapper. The track is a single fixed body carrying two trimesh
 * colliders (contact-less surface for hover rays, rails that ships collide with);
 * every ship is a dynamic cuboid whose orientation and velocity are driven by a
 * {@link ShipController}.
 */
export class PhysicsSystem implements IPhysicsSystem {
  readonly ships: ShipState[] = [];

  /** Exposed for debugging, AI wall probes and tests. */
  readonly world: World;
  readonly surfaceCollider: Collider;
  readonly railCollider: Collider;

  private readonly controllers = new Map<ShipId, ShipController>();
  private readonly controllerList: ShipController[] = [];
  private readonly byCollider = new Map<number, ShipController>();
  private readonly activePairs = new Map<number, [ShipController, ShipController]>();
  private readonly pairEventTime = new Map<number, number>();
  private readonly eventQueue: EventQueue;
  private readonly trackBody: RigidBody;
  private readonly noControls: ControlInput = neutralControls();

  private time = 0;
  /** Physics seconds since the last race reset: the stone gates' timeline. */
  private raceClock = 0;
  private disposed = false;

  /**
   * Stone gates and debris: kinematic boxes in the rail group, posed each step from the hazard clock and told apart
   * from the rails by collider handle (obstacle id = index in `obstacles`).
   */
  readonly gates: readonly BuiltGate[];
  readonly debris: readonly BuiltDebris[];
  private readonly obstacles: Obstacle[] = [];
  private readonly obstacleByHandle = new Map<number, number>();
  private readonly posePos = new THREE.Vector3();
  private readonly poseQuat = new THREE.Quaternion();
  /** Physics time of each ship's last counted hit per obstacle (key ship·1024 + obstacle): contact flickers are one hit. */
  private readonly obstacleHitTime = new Map<number, number>();
  /** Mines (Orbital Ring): trigger spheres on the hazard clock. */
  private readonly mineField: MineField;

  // Scratch for contact resolution (no per-step allocation).
  private readonly acc: ContactAccumulator = { nx: 0, ny: 0, nz: 0, count: 0, px: 0, py: 0, pz: 0, depth: Infinity };
  private readonly normalOut = new THREE.Vector3();
  private readonly vecScratch = { x: 0, y: 0, z: 0 };
  private readonly pointScratch = { x: 0, y: 0, z: 0 };
  private readonly pointVec = new THREE.Vector3();
  private readonly accRefPos = new THREE.Vector3();
  private readonly accRefQuat = new THREE.Quaternion();
  private readonly accTowardPos = new THREE.Vector3();

  private constructor(
    private readonly track: TrackData,
    private readonly bus: GameBus,
    world: World,
    /** How hazards treat ships in this race (gates and mines read it; M4b/M4c). */
    readonly hazards: Readonly<HazardPolicy>,
  ) {
    this.world = world;
    this.eventQueue = new RAPIER.EventQueue(true);

    this.trackBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.surfaceCollider = world.createCollider(
      PhysicsSystem.meshDesc(track.collision.surface, 0)
        .setCollisionGroups(COLLISION.SURFACE)
        .setFriction(0)
        .setRestitution(0),
      this.trackBody,
    );
    this.railCollider = world.createCollider(
      PhysicsSystem.meshDesc(track.collision.rails, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
        .setCollisionGroups(COLLISION.RAIL)
        .setFriction(0)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(1e9),
      this.trackBody,
    );

    this.gates = buildGates(track);
    for (const g of this.gates) this.addObstacle('gate', g.index, g.width, g.height, g.thickness);
    this.debris = buildDebris(track);
    for (const b of this.debris) this.addObstacle('debris', b.index, b.width, b.height, b.length);
    this.poseObstacles(true);
    this.mineField = new MineField(track);

    // Colliders added to the world only become visible to scene queries after a step.
    world.timestep = CONFIG.FIXED_DT;
    world.step();
  }

  /** Initialise Rapier and build the track colliders. */
  static async create(track: TrackData, bus: GameBus, opts: { hazards?: Readonly<HazardPolicy> } = {}): Promise<PhysicsSystem> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    return new PhysicsSystem(track, bus, world, opts.hazards ?? HAZARDS_NORMAL);
  }

  private static meshDesc(mesh: TriMesh, flags: number) {
    if (flags !== 0) {
      try {
        return RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, flags);
      } catch {
        // Fall back to a plain mesh when the topology-fixing flags cannot be applied.
      }
    }
    return RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices);
  }

  addShip(def: ShipDefinition, slot: GridSlot): ShipState {
    if (this.controllers.has(def.id)) throw new Error(`PhysicsSystem: ship ${def.id} already added`);
    // Heavier chassis are bigger (content/ships CLASS_SCALE); Balanced = v1 dimensions.
    const scale = def.loadout ? CLASS_SCALE[chassisById(def.loadout.chassisId).cls] : 1;

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(slot.position.x, slot.position.y, slot.position.z)
        .setRotation(slot.quaternion)
        .setGravityScale(0)
        .setLinearDamping(0)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .lockRotations(),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid((CONFIG.SHIP_WIDTH * scale) / 2, (CONFIG.SHIP_HEIGHT * scale) / 2, (CONFIG.SHIP_LENGTH * scale) / 2)
        .setDensity(def.stats.mass)
        .setCollisionGroups(COLLISION.SHIP)
        .setFriction(0)
        .setRestitution(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(1e9),
      body,
    );

    const proj = this.track.project(slot.position, slot.u);
    const state: ShipState = {
      def,
      position: slot.position.clone(),
      quaternion: slot.quaternion.clone(),
      prevPosition: slot.position.clone(),
      prevQuaternion: slot.quaternion.clone(),
      velocity: new THREE.Vector3(),
      speed: 0,
      forwardSpeed: 0,
      bank: 0,
      grounded: true,
      energy: def.stats.energyMax,
      boosting: false,
      boostTimer: 0,
      inPit: false,
      onDash: false,
      trackU: proj.u,
      path: proj.path,
      pathS: proj.pathS ?? 0,
      lateral: proj.lateral,
      heightAboveTrack: proj.height,
      airborne: false,
      lastControls: neutralControls(),
      status: 'grid',
      boostUnlocked: false,
      thrustScale: 1,
      empSlow: 0,
      empLock: 0,
    };

    const controller = new ShipController(this.world, this.track, this.bus, state, body, collider);
    this.controllers.set(def.id, controller);
    this.controllerList.push(controller);
    this.byCollider.set(collider.handle, controller);
    this.ships.push(state);
    return state;
  }

  /** Physics seconds since the last race reset (the timeline of the gates, mines and debris). */
  get hazardTime(): number {
    return this.raceClock;
  }

  /** The mines this step (positions, armed): graphics and the AI read them. */
  get mines(): readonly MineState[] {
    return this.mineField.mines;
  }

  /** Lateral of debris piece i's centre now. */
  debrisLateral(i: number): number {
    return debrisLateral(this.debris[i], this.raceClock);
  }

  /** Restart the hazard timeline (on every race reset), so each race replays the same hazard sequence. */
  resetTime(): void {
    this.raceClock = 0;
    this.poseObstacles(true);
    this.mineField.reset(0);
  }

  private addObstacle(kind: Obstacle['kind'], index: number, width: number, height: number, length: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, height / 2, length / 2)
        .setCollisionGroups(COLLISION.RAIL)
        .setFriction(0)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.obstacleByHandle.set(collider.handle, this.obstacles.length);
    this.obstacles.push({ kind, index, body, collider });
  }

  /** Move each gate slab and debris piece to its pose at the race clock (teleport, or as the next kinematic target). */
  private poseObstacles(teleport: boolean): void {
    for (const o of this.obstacles) {
      if (o.kind === 'gate') {
        const g = this.gates[o.index];
        gatePose(g, gateClosure(g, this.raceClock), this.posePos, this.poseQuat);
      } else debrisPose(this.debris[o.index], this.raceClock, this.posePos, this.poseQuat);
      if (teleport) {
        o.body.setTranslation(this.posePos, true);
        o.body.setRotation(this.poseQuat, true);
      } else {
        o.body.setNextKinematicTranslation(this.posePos);
        o.body.setNextKinematicRotation(this.poseQuat);
      }
    }
  }

  /** Set off any armed mine a racing hull touches. */
  private checkMines(): void {
    const field = this.mineField;
    if (field.mines.length === 0) return;
    field.update(this.raceClock);
    for (const c of this.controllerList) {
      const s = c.state;
      if ((s.status !== 'racing' && s.status !== 'finished') || !c.isColliderEnabled) continue;
      const hit = field.test({ id: s.def.id, position: s.position, quaternion: s.quaternion, half: c.hullHalf }, this.raceClock);
      if (!hit) continue;
      c.applyMineHit(hit.side, hit.up, this.hazards);
      this.bus.emit('hazard:mine', { shipId: s.def.id, mine: hit.mine.index, owner: hit.mine.owner, point: hit.mine.position.clone() });
    }
  }

  step(dt: number, controls: ReadonlyMap<ShipId, ControlInput>): void {
    if (this.disposed || !(dt > 0)) return;
    this.time += dt;
    this.raceClock += dt;
    if (this.world.timestep !== dt) this.world.timestep = dt;
    if (this.obstacles.length > 0) this.poseObstacles(false);

    const list = this.controllerList;

    // 1. Render-interpolation history first, then per-ship simulation.
    for (let i = 0; i < list.length; i++) list[i].beginStep();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.simulate(dt, controls.get(c.state.def.id) ?? this.noControls);
    }

    // 2. Solver: resolves rail and ship-ship contacts.
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents(this.onCollisionEvent);

    // 3. Adopt solver results, then apply the game-side collision response.
    for (let i = 0; i < list.length; i++) list[i].readback();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.railContact) this.resolveRailContact(c, dt);
      if (c.obstacleContacts.size > 0) for (const o of c.obstacleContacts) this.resolveObstacleContact(c, o, dt);
      c.obstacleHitsStarted.clear();
    }
    for (const pair of this.activePairs.values()) this.resolveShipContact(pair[0], pair[1]);
    this.checkMines();

    // 4. Projection, zones, energy, safety respawn.
    for (let i = 0; i < list.length; i++) list[i].finishStep(dt);
  }

  resetShip(id: ShipId, slot: GridSlot): void {
    const c = this.controllers.get(id);
    if (!c) throw new Error(`PhysicsSystem: unknown ship ${id}`);
    c.reset(slot);
    for (const [key, pair] of this.activePairs) {
      if (pair[0] === c || pair[1] === c) this.activePairs.delete(key);
    }
  }

  /** Rapier rigid body of a ship (debugging / tests). */
  bodyOf(id: ShipId): RigidBody | undefined {
    return this.controllers.get(id)?.body;
  }

  /** Rapier collider of a ship (debugging / tests). */
  colliderOf(id: ShipId): Collider | undefined {
    return this.controllers.get(id)?.collider;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controllers.clear();
    this.controllerList.length = 0;
    this.byCollider.clear();
    this.activePairs.clear();
    this.ships.length = 0;
    this.eventQueue.free();
    this.world.free();
  }

  // -------------------------------------------------------------------------
  // Collision handling
  // -------------------------------------------------------------------------

  private readonly onCollisionEvent = (h1: number, h2: number, started: boolean): void => {
    const railHandle = this.railCollider.handle;
    const c1 = this.byCollider.get(h1);
    const c2 = this.byCollider.get(h2);
    const o1 = this.obstacleByHandle.get(h1);
    const o2 = this.obstacleByHandle.get(h2);
    if (o1 !== undefined || o2 !== undefined) {
      const c = o1 !== undefined ? c2 : c1;
      const o = (o1 ?? o2)!;
      if (!c) return;
      if (started) {
        c.obstacleContacts.add(o);
        c.obstacleHitsStarted.add(o);
      } else c.obstacleContacts.delete(o);
    } else if (h1 === railHandle) {
      if (c2) c2.railContact = started;
    } else if (h2 === railHandle) {
      if (c1) c1.railContact = started;
    } else if (c1 && c2) {
      const key = pairKey(c1.state.def.id, c2.state.def.id);
      if (started) this.activePairs.set(key, [c1, c2]);
      else this.activePairs.delete(key);
    }
  };

  /**
   * Merge one contact manifold into the accumulator. Solver contacts are not exposed after the
   * step, so the raw contact list is used: `contactDist` gates real contact, the deepest contact
   * point is taken from the ship-side local point mapped through the ship pose.
   */
  private readonly accumulateManifold = (manifold: TempContactManifold, flipped: boolean): void => {
    const n = manifold.numContacts();
    if (n === 0) return;
    let deepest = Infinity;
    let deepestIndex = -1;
    for (let i = 0; i < n; i++) {
      const d = manifold.contactDist(i);
      if (d < deepest) {
        deepest = d;
        deepestIndex = i;
      }
    }
    if (deepest > TUNING.CONTACT_MAX_DIST) return;

    const local = flipped
      ? manifold.localContactPoint2(deepestIndex, this.vecScratch)
      : manifold.localContactPoint1(deepestIndex, this.vecScratch);
    if (!local) return;
    // Local point is on the first collider passed to contactPair (the reference ship).
    const p = this.pointVec.set(local.x, local.y, local.z).applyQuaternion(this.accRefQuat).add(this.accRefPos);

    const normal = manifold.normal(this.vecScratch);
    // Orient every manifold normal consistently (away from the wall / toward the far ship) before
    // summing, so opposite-facing reports do not cancel.
    const dot =
      normal.x * (this.accTowardPos.x - p.x) + normal.y * (this.accTowardPos.y - p.y) + normal.z * (this.accTowardPos.z - p.z);
    const sign = dot >= 0 ? 1 : -1;
    const acc = this.acc;
    acc.nx += sign * normal.x;
    acc.ny += sign * normal.y;
    acc.nz += sign * normal.z;
    acc.count++;
    if (deepest < acc.depth) {
      acc.depth = deepest;
      acc.px = p.x;
      acc.py = p.y;
      acc.pz = p.z;
    }
  };

  /**
   * @param refPos / refQuat pose of the first collider given to contactPair (local points live there)
   * @param toward  point the summed normal should face (the ship for rails, the second ship for ship pairs)
   */
  private resetAccumulator(refPos: THREE.Vector3, refQuat: THREE.Quaternion, toward: THREE.Vector3): void {
    const acc = this.acc;
    acc.nx = acc.ny = acc.nz = 0;
    acc.count = 0;
    acc.depth = Infinity;
    this.accRefPos.copy(refPos);
    this.accRefQuat.copy(refQuat);
    this.accTowardPos.copy(toward);
  }

  /** Wall normal (pointing to the ship) from the manifolds of ship vs rail; applies the response. */
  private resolveRailContact(c: ShipController, dt: number): void {
    if (c.state.status === 'retired' || !c.isColliderEnabled) return;
    this.resetAccumulator(c.state.position, c.state.quaternion, c.state.position);
    this.world.contactPair(c.collider, this.railCollider, this.accumulateManifold);
    const acc = this.acc;
    if (acc.count === 0) return;
    const n = this.normalOut.set(acc.nx, acc.ny, acc.nz);
    if (n.lengthSq() < 1e-10) return;
    n.normalize();
    c.applyWallContact(n, this.pointScratch_(acc), dt, this.time);
  }

  /**
   * A stone gate or debris: a rail-like bounce. Under a damaging hazard policy the hit drains energy like a rail;
   * otherwise it costs no energy and slows the ship (velocity × hitSpeedScale) once per hit.
   */
  private resolveObstacleContact(c: ShipController, id: number, dt: number): void {
    if (c.state.status === 'retired' || !c.isColliderEnabled) return;
    const o = this.obstacles[id];
    this.resetAccumulator(c.state.position, c.state.quaternion, c.state.position);
    this.world.contactPair(c.collider, o.collider, this.accumulateManifold);
    const acc = this.acc;
    if (acc.count === 0) return;
    const n = this.normalOut.set(acc.nx, acc.ny, acc.nz);
    if (n.lengthSq() < 1e-10) return;
    n.normalize();
    const p = this.pointScratch_(acc);
    const damage = this.hazards.damage;
    c.applyWallContact(n, p, dt, this.time, damage);
    const key = c.state.def.id * 1024 + id;
    if (c.obstacleHitsStarted.has(id) && this.time - (this.obstacleHitTime.get(key) ?? -Infinity) >= OBSTACLE_HIT_COOLDOWN) {
      this.obstacleHitTime.set(key, this.time);
      if (!damage) c.scaleVelocity(this.hazards.hitSpeedScale);
      const point = new THREE.Vector3(p.x, p.y, p.z);
      if (o.kind === 'gate') this.bus.emit('hazard:gate', { shipId: c.state.def.id, gate: o.index, point });
      else this.bus.emit('hazard:debris', { shipId: c.state.def.id, debris: o.index, point });
    }
  }

  private pointScratch_(acc: ContactAccumulator): { x: number; y: number; z: number } {
    const p = this.pointScratch;
    p.x = acc.px;
    p.y = acc.py;
    p.z = acc.pz;
    return p;
  }

  private resolveShipContact(a: ShipController, b: ShipController): void {
    if (!a.isColliderEnabled || !b.isColliderEnabled) return;
    // Normal oriented from a toward b: the contact point lies on a, so b's centre is the "toward" side.
    this.resetAccumulator(a.state.position, a.state.quaternion, b.state.position);
    this.world.contactPair(a.collider, b.collider, this.accumulateManifold);
    const acc = this.acc;
    if (acc.count === 0) return;
    const n = this.normalOut.set(acc.nx, acc.ny, acc.nz);
    if (n.lengthSq() < 1e-10) return;
    n.normalize(); // points toward b's side of the contact (from a to b)

    const va = a.preSolveVelocity;
    const vb = b.preSolveVelocity;
    const closing = (va.x - vb.x) * n.x + (va.y - vb.y) * n.y + (va.z - vb.z) * n.z;
    if (closing <= TUNING.IMPACT_MIN_SPEED) return;

    // One impact per pair per SHIP_HIT_INTERVAL: two hulls pressed together (side by side after a shared landing)
    // still show a small closing speed every step, and counting each step as a hit ground a ship to nothing.
    const key = pairKey(a.state.def.id, b.state.def.id);
    const last = this.pairEventTime.get(key) ?? -Infinity;
    if (this.time - last >= SHIP_HIT_INTERVAL) {
      this.pairEventTime.set(key, this.time);
      const sa = a.state.status;
      const sb = b.state.status;
      const bothRacing = (sa === 'racing' || sa === 'finished') && (sb === 'racing' || sb === 'finished');
      if (bothRacing) {
        a.applyShipDamage(closing);
        b.applyShipDamage(closing);
      }
      this.bus.emit('ship:shipHit', {
        a: a.state.def.id,
        b: b.state.def.id,
        point: new THREE.Vector3(acc.px, acc.py, acc.pz),
        intensity: clamp01(closing / TUNING.SHIP_INTENSITY_SPEED),
      });
    }
  }
}

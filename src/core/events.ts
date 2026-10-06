import type * as THREE from 'three';
import type { RaceState, RacerStanding, ShipId } from './contracts';

/**
 * Every cross-system event. Emitters:
 *  - physics → ship:railHit | shipHit | boost | dash | pit | lowEnergy | respawn | jump | land | ice
 *  - game    → race:*, ship:destroyed, audio:mute
 * Graphics, HUD and Audio only subscribe.
 */
export interface GameEvents {
  'race:state': { state: RaceState; prev: RaceState };
  'race:countdown': { value: 3 | 2 | 1 | 0 };
  'race:lap': { shipId: ShipId; lap: number; lapTime: number; isBest: boolean; isRecord: boolean };
  'race:finish': { shipId: ShipId; position: number; totalTime: number };
  'race:results': { standings: RacerStanding[] };
  /** intensity 0..1 */
  'ship:railHit': { shipId: ShipId; point: THREE.Vector3; normal: THREE.Vector3; intensity: number };
  'ship:shipHit': { a: ShipId; b: ShipId; point: THREE.Vector3; intensity: number };
  'ship:boost': { shipId: ShipId };
  'ship:dash': { shipId: ShipId };
  'ship:pit': { shipId: ShipId; active: boolean };
  'ship:lowEnergy': { shipId: ShipId };
  'ship:destroyed': { shipId: ShipId; position: THREE.Vector3 };
  'ship:respawn': { shipId: ShipId };
  /** A ship's hull moved onto (active) or off an ice patch. */
  'ship:ice': { shipId: ShipId; active: boolean };
  /** Left a jump lip; intensity 0..1 from speed. */
  'ship:jump': { shipId: ShipId; intensity: number };
  /** A ship hit a stone gate (Jade Ruins): `gate` is its index in the track's gates. */
  'hazard:gate': { shipId: ShipId; gate: number; point: THREE.Vector3 };
  /** Touched down after a jump; intensity 0..1 from the speed into the surface. */
  'ship:land': { shipId: ShipId; intensity: number };
  /** App → HUD/Audio: credits paid to the player's profile at the results. */
  'economy:credits': { delta: number; total: number };
  /** AudioSystem → HUD: master mute changed (keyboard M or HUD button). */
  'audio:mute': { muted: boolean };
}

export type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) (h as Handler<E[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }

  /** Live subscriptions across all event types (leak checks). */
  listenerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}

export type GameBus = EventBus<GameEvents>;

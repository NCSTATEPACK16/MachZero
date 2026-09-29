import type { ControlInput, GridSlot, IPhysicsSystem, ShipDefinition, ShipId, ShipState, TrackData } from '../core/contracts';
import type { GameBus } from '../core/events';

// STUB — replaced by Agent 1.
export class PhysicsSystem implements IPhysicsSystem {
  readonly ships: ShipState[] = [];
  private constructor() {}
  static async create(_track: TrackData, _bus: GameBus): Promise<PhysicsSystem> {
    throw new Error('PhysicsSystem not implemented');
  }
  addShip(_def: ShipDefinition, _slot: GridSlot): ShipState {
    throw new Error('not implemented');
  }
  step(_dt: number, _controls: ReadonlyMap<ShipId, ControlInput>): void {}
  resetShip(_id: ShipId, _slot: GridSlot): void {}
  dispose(): void {}
}

import type { IRaceManager, RaceSnapshot, RaceState, ShipState, TrackData } from '../core/contracts';
import type { GameBus } from '../core/events';

// STUB — replaced by Agent 4.
export class RaceManager implements IRaceManager {
  state: RaceState = 'title';
  constructor(_track: TrackData, _ships: ShipState[], _bus: GameBus) {}
  fixedUpdate(_dt: number): void {}
  snapshot(): RaceSnapshot {
    throw new Error('not implemented');
  }
  start(): void {}
  pause(_paused: boolean): void {}
  reset(): void {}
}

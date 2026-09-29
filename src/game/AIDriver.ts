import type { AIPersonality, ControlInput, IAIDriver, ShipId, ShipState, TrackData } from '../core/contracts';
import { neutralControls } from '../core/controls';

// STUB — replaced by Agent 4.
export class AIDriver implements IAIDriver {
  readonly shipId: ShipId;
  constructor(ship: ShipState, _track: TrackData, _personality: AIPersonality, _rngSeed: number, _rivals: readonly ShipState[] = []) {
    this.shipId = ship.def.id;
  }
  update(_dt: number): ControlInput {
    return neutralControls();
  }
}

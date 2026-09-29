import type { HudActions, IHUD, RaceSnapshot, TrackData } from '../core/contracts';
import type { GameBus } from '../core/events';

// STUB — replaced by Agent 4.
export class HUD implements IHUD {
  constructor(_root: HTMLElement, _bus: GameBus, _track: TrackData, _actions: HudActions) {}
  update(_snap: RaceSnapshot, _dt: number): void {}
}

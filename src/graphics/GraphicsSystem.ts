import type { FrameContext, IGraphicsSystem, ShipState, TrackData } from '../core/contracts';
import type { GameBus } from '../core/events';

// STUB — replaced by Agent 3.
export class GraphicsSystem implements IGraphicsSystem {
  constructor(_container: HTMLElement, _bus: GameBus) {}
  setTrack(_track: TrackData): void {}
  addShip(_ship: ShipState): void {}
  update(_ctx: FrameContext): void {}
  render(): void {}
  resize(_width: number, _height: number): void {}
  dispose(): void {}
}

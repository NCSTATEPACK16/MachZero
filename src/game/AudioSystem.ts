import type { FrameContext, IAudioSystem } from '../core/contracts';
import type { GameBus } from '../core/events';

// STUB — replaced by Agent 4.
export class AudioSystem implements IAudioSystem {
  muted = false;
  constructor(_bus: GameBus) {}
  update(_ctx: FrameContext): void {}
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}

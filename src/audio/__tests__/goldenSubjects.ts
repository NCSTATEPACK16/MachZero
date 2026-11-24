/** The audio implementations the v1 golden test plays (v1Golden.test.ts). */
import type { FrameContext } from '../../core/contracts';
import type { GameBus } from '../../core/events';
import { AudioSystem as V1AudioSystem } from '../../game/AudioSystem';

export interface GoldenAudio {
  attach(bus: GameBus): void;
  detach(): void;
  update(ctx: FrameContext): void;
  setVolumes(master: number, sfx: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export interface GoldenSubject {
  name: string;
  create(): GoldenAudio;
}

export function makeGoldenSubjects(): GoldenSubject[] {
  return [{ name: 'v1 AudioSystem', create: () => new V1AudioSystem() }];
}

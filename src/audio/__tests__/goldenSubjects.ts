/**
 * The audio implementations the v1 golden test plays (v1Golden.test.ts). v1's `game/AudioSystem.ts` recorded the log
 * and was the first subject until M6a step 4 moved its code here and deleted it.
 */
import type { FrameContext } from '../../core/contracts';
import type { GameBus } from '../../core/events';
import { AudioSystem } from '../AudioSystem';

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
  return [
    { name: 'M6 AudioSystem with music off', create: () => new AudioSystem({ modern: false }) },
  ];
}

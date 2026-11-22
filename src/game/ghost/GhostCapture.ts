/**
 * Records one ship's run as a ghost, driven by the race bus (IMPLEMENTATION §M8b): recording starts at GO
 * (countdown → racing), `step()` is called after every `RaceManager.fixedUpdate`, and the ship's finish closes
 * the ghost (`result`, and `onDone`). A restart (back to the grid) throws the take away. Used by the Time Trial
 * race and the headless dev-ghost bake, so both record the same way.
 */
import type { ShipState } from '../../core/contracts';
import type { GameBus } from '../../core/events';
import type { GhostData } from './ghostCodec';
import { GhostRecorder } from './GhostRecorder';

export class GhostCapture {
  private readonly rec = new GhostRecorder();
  private recording = false;
  private finishTime: number | null = null;
  private laps: number[] = [];
  /** The finished ghost of the last complete run, or null. */
  result: GhostData | null = null;
  onDone: ((g: GhostData) => void) | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(
    bus: GameBus,
    private readonly ship: ShipState,
    private readonly trackId: string,
  ) {
    this.offs.push(
      bus.on('race:state', ({ state, prev }) => {
        if (state === 'racing' && prev === 'countdown') {
          this.rec.start();
          this.recording = true;
          this.finishTime = null;
          this.laps = [];
          this.result = null;
        } else if (state === 'title' || state === 'countdown') {
          this.recording = false;
        }
      }),
      bus.on('race:lap', ({ shipId, lapTime }) => {
        if (this.recording && shipId === ship.def.id) this.laps.push(lapTime);
      }),
      bus.on('race:finish', ({ shipId, totalTime }) => {
        if (this.recording && shipId === ship.def.id) this.finishTime = totalTime;
      }),
    );
  }

  /** After each fixed step's race update. */
  step(): void {
    if (!this.recording) return;
    if (this.ship.status === 'retired') {
      this.recording = false;
      return;
    }
    this.rec.sample(this.ship);
    if (this.finishTime === null) return;
    this.recording = false;
    this.result = this.rec.finish(this.finishTime, this.laps, this.trackId, this.ship.def.loadout?.chassisId ?? 'comet');
    this.onDone?.(this.result);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.onDone = null;
  }
}

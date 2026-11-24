/**
 * Menu sounds (IMPLEMENTATION §M6.2, menu rows): the UI layer's sound events (`ui/uiSounds.ts`) and the menu bus
 * (`App.events`), on the ui bus. Modern (`music`) only: with the flag off the menus stay silent, as in v1.
 *
 * Rate limit: at most one UI sound per 40 ms, except that a confirm, back or tab inside 40 ms of a move still plays
 * (the move tick is shorter than the window). The touch race buttons never reach here (`uiSounds` ignores them).
 * The stingers of `results:open` and the results queue arrive in M6c; here they play nothing yet.
 */
import type { EventBus, MenuEvents } from '../core/events';
import type { AudioEngine } from './AudioEngine';
import type { SfxBank } from './SfxBank';
import type { SoundId, UiSoundKind } from './soundTable';

export const UI_RATE_LIMIT = 0.04;
/** The tally tick rises this much per line, up to TALLY_MAX_RATE. */
const TALLY_STEP = 0.06;
const TALLY_MAX_RATE = 1.6;
/** Navigation sounds are decoration (priority 3); shop, results and tutorial sounds are priority 1 (§M6.2). */
const DECORATION = new Set<string>(['ui.move', 'ui.confirm', 'ui.back', 'ui.slider', 'ui.tab', 'ui.locked']);

export class MenuSounds {
  private last = -Infinity;
  private lastKind: UiSoundKind | null = null;
  private tally = 0;
  private offs: Array<() => void> = [];

  constructor(
    private readonly engine: AudioEngine,
    private readonly bank: SfxBank,
    readonly modern: boolean,
  ) {}

  /** Subscribe to the menu bus; returns the unsubscribe. */
  bind(events: EventBus<MenuEvents>): () => void {
    if (!this.modern) return () => undefined;
    const play = (id: SoundId, rate?: number) => () => this.play(id, 1, rate);
    const offs = [
      events.on('ui:locked', play('ui.locked')),
      events.on('shop:buy', play('ui.buy')),
      events.on('shop:equip', play('ui.equip')),
      events.on('shop:deny', play('ui.deny')),
      events.on('results:open', () => {
        this.tally = 0;
      }),
      events.on('results:tally', () => {
        const rate = Math.min(TALLY_MAX_RATE, 1 + TALLY_STEP * this.tally++);
        this.play('ui.tally', 1, rate);
      }),
      events.on('results:total', () => {
        this.tally = 0;
        this.play('ui.coin', 1);
      }),
      events.on('tutorial:step', play('ui.tutorial')),
      events.on('tutorial:done', play('ui.sparkle')),
    ];
    this.offs.push(...offs);
    return () => {
      for (const off of offs) off();
      this.offs = this.offs.filter((o) => !offs.includes(o));
    };
  }

  /** A UI sound event. `value` is a slider's position 0..1 (its pitch). */
  ui(kind: UiSoundKind, value?: number): void {
    if (!this.modern) return;
    const ac = this.engine.ac;
    if (!ac) return;
    const now = ac.currentTime;
    const soon = now - this.last < UI_RATE_LIMIT;
    if (soon && !(kind !== 'move' && kind !== 'slider' && this.lastKind === 'move')) return;
    this.last = now;
    this.lastKind = kind;
    const rate = kind === 'slider' ? 0.7 + 0.8 * Math.min(1, Math.max(0, value ?? 0.5)) : 1;
    this.play(`ui.${kind}` as SoundId, 1, rate);
  }

  private play(id: SoundId, gain: number, rate?: number): void {
    this.bank.play(id, { bus: 'ui', priority: DECORATION.has(id) ? 3 : 1, gain, rate });
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}

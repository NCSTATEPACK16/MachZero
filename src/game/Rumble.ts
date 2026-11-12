/**
 * Controller rumble (§V.3), a nice-to-have where the browser supports it: wall and ship hits, item hits, boost
 * start and big landings on the player's ship. The output is a callback (InputManager.rumble), which
 * feature-detects `vibrationActuator` and does nothing without it, so iOS's WKWebView simply stays still.
 */
import type { GameBus } from '../core/events';
import type { ShipId } from '../core/contracts';

/** strong / weak motor 0..1, duration in ms. */
export type RumbleOut = (strong: number, weak: number, ms: number) => void;

export const RUMBLE = {
  /** Shortest gap between two effects (a scrape fires rail hits every step). */
  GAP_MS: 90,
  /** Landings below this intensity don't rumble. */
  LAND_MIN: 0.35,
} as const;

export class Rumble {
  private offs: (() => void)[] = [];
  private last = -Infinity;

  constructor(
    private readonly out: RumbleOut,
    private readonly now: () => number = () => performance.now(),
  ) {}

  attach(bus: GameBus, player: ShipId): void {
    this.detach();
    const mine = (id: ShipId) => id === player;
    this.offs = [
      bus.on('ship:railHit', (e) => mine(e.shipId) && this.play(0.25 + 0.6 * clamp01(e.intensity), 0.5, 120)),
      bus.on('ship:shipHit', (e) => (mine(e.a) || mine(e.b)) && this.play(0.3 + 0.5 * clamp01(e.intensity), 0.6, 110)),
      bus.on('ship:boost', (e) => mine(e.shipId) && this.play(0.1, 0.7, 260)),
      bus.on('ship:land', (e) => mine(e.shipId) && e.intensity >= RUMBLE.LAND_MIN && this.play(0.4 + 0.5 * clamp01(e.intensity), 0.3, 140)),
      bus.on('item:emp', (e) => mine(e.target) && this.play(0.9, 0.9, 380)),
      bus.on('hazard:mine', (e) => mine(e.shipId) && this.play(1, 0.8, 300)),
      bus.on('hazard:lightning', (e) => mine(e.shipId) && this.play(0.8, 1, 260)),
      bus.on('ship:destroyed', (e) => mine(e.shipId) && this.play(1, 1, 500)),
    ];
  }

  detach(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  private play(strong: number, weak: number, ms: number): void {
    const t = this.now();
    if (t - this.last < RUMBLE.GAP_MS) return;
    this.last = t;
    this.out(Math.min(1, strong), Math.min(1, weak), ms);
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * The first-race tutorial (IMPLEMENTATION §M8c step 5): five prompts over a real race, which is never paused:
 * steer, boost, air-brake, pit, item. One prompt at a time, in that order. Each step clears when the player does
 * the action (even before its prompt shows), and gives up after its prompt has shown long enough; a step that
 * gives up counts as done. The tutorial is done when every step is done, on SKIP, or when the race ends.
 *
 * Pure: `update` is called every fixed step with the player's ship and raw input; the HUD draws `step`.
 */
import type { ControlInput, ShipState, TrackData } from '../core/contracts';

export type TutorialStep = 'steer' | 'boost' | 'airbrake' | 'pit' | 'item';
export const TUTORIAL_STEPS: readonly TutorialStep[] = ['steer', 'boost', 'airbrake', 'pit', 'item'];

export interface TutorialView {
  /** The prompt to show now, or null. */
  step: TutorialStep | null;
  done: boolean;
}

/** What the tutorial reads from the track (TrackData has it all). */
export type TutorialTrack = Pick<TrackData, 'length' | 'zones'> & { samples: readonly { distance: number; curvature: number }[] };
/** What it reads from the player's ship. */
export type TutorialShip = Pick<ShipState, 'trackU' | 'path' | 'speed' | 'boosting' | 'boostUnlocked' | 'energy' | 'inPit'> & { def: { stats: { energyMax: number } } };
/** The race as the tutorial sees it; `itemUsed` is true in the step the player used an item. */
export interface TutorialRace {
  state: string;
  lap: number;
  itemUsed?: boolean;
}

/** |κ| (1/m) at or above which a bend is sharp: every track has 4–12 (measured on the 8 tracks, 2026-11-22). */
export const SHARP_K = 0.006;
/** |κ| under which the road counts as straight. */
export const STRAIGHT_K = 0.003;
/** Seconds between a showing that ran out and the next one. */
export const SHOW_GAP = 3;

interface Rule {
  /** Seconds a showing lasts, and how many showings before the step gives up. */
  showFor: number;
  showings: number;
}
const RULES: Readonly<Record<TutorialStep, Rule>> = {
  steer: { showFor: 12, showings: 1 },
  boost: { showFor: 8, showings: 2 },
  airbrake: { showFor: 6, showings: 2 },
  pit: { showFor: 8, showings: 2 },
  item: { showFor: 10, showings: 1 },
};

export class Tutorial {
  private index = 0;
  private finished = false;
  private showing = false;
  private shownFor = 0;
  private showings = 0;
  private gap = 0;
  /** Seconds since the current step became current (racing only). */
  private since = 0;
  private steerTime = 0;
  private airTime = 0;
  private readonly bends: number[];
  private readonly pitStart: number | null;

  constructor(
    private readonly track: TutorialTrack,
    private readonly opts: { hasItem: boolean },
  ) {
    const s = track.samples;
    this.bends = [];
    for (let i = 0; i < s.length; i++) {
      const prev = s[(i - 1 + s.length) % s.length];
      if (Math.abs(s[i].curvature) >= SHARP_K && Math.abs(prev.curvature) < SHARP_K) this.bends.push(s[i].distance);
    }
    const pit = track.zones.find((z) => z.type === 'pit');
    this.pitStart = pit ? pit.uStart * track.length : null;
  }

  /** The step in progress (shown or not), or null when done. */
  get current(): TutorialStep | null {
    return this.finished ? null : (TUTORIAL_STEPS[this.index] ?? null);
  }

  get done(): boolean {
    return this.finished;
  }

  skip(): void {
    this.finished = true;
    this.showing = false;
  }

  /** Mark every step before `step` done (REPLAY starts from the top; tests jump ahead). */
  skipTo(step: TutorialStep): void {
    this.index = TUTORIAL_STEPS.indexOf(step);
    this.resetStep();
  }

  update(dt: number, ship: TutorialShip, input: ControlInput, race: TutorialRace): TutorialView {
    if (!this.finished && (race.state === 'results' || race.state === 'title')) {
      if (race.state === 'results') this.finished = true;
      this.showing = false;
    }
    if (this.finished || race.state !== 'racing') return this.view();
    let step = this.current;
    if (step === 'item' && !this.opts.hasItem) this.next();
    step = this.current;
    if (!step) return this.view();
    this.since += dt;
    if (this.cleared(step, dt, ship, input, race)) {
      this.next();
      return this.view();
    }
    if (this.showing) {
      this.shownFor += dt;
      if (this.shownFor >= RULES[step].showFor) {
        this.showing = false;
        this.showings++;
        this.gap = SHOW_GAP;
        if (this.showings >= RULES[step].showings) this.next();
      }
    } else if (this.gap > 0) {
      this.gap -= dt;
    } else if (ship.path === null && this.triggered(step, ship, race)) {
      this.showing = true;
      this.shownFor = 0;
    }
    return this.view();
  }

  private view(): TutorialView {
    return { step: this.showing && !this.finished ? this.current : null, done: this.finished };
  }

  private next(): void {
    this.index++;
    this.resetStep();
    if (this.index >= TUTORIAL_STEPS.length) this.finished = true;
  }

  private resetStep(): void {
    this.showing = false;
    this.shownFor = 0;
    this.showings = 0;
    this.gap = 0;
    this.since = 0;
    this.steerTime = 0;
    this.airTime = 0;
  }

  private cleared(step: TutorialStep, dt: number, ship: TutorialShip, input: ControlInput, race: TutorialRace): boolean {
    switch (step) {
      case 'steer':
        if (Math.abs(input.steer) > 0.3) this.steerTime += dt;
        return this.steerTime >= 1 - 1e-9;
      case 'boost':
        return ship.boosting;
      case 'airbrake':
        if (Math.max(input.airbrakeLeft, input.airbrakeRight) > 0.5) this.airTime += dt;
        return this.airTime >= 0.3 - 1e-9;
      case 'pit':
        return ship.inPit;
      case 'item':
        return race.itemUsed === true;
    }
  }

  private triggered(step: TutorialStep, ship: TutorialShip, race: TutorialRace): boolean {
    const d = ship.trackU * this.track.length;
    switch (step) {
      case 'steer':
        return true;
      case 'boost':
        return ship.boostUnlocked && this.straightAhead(d, Math.max(80, ship.speed * 2));
      case 'airbrake':
        return this.bends.some((b) => this.ahead(d, b) <= Math.max(20, ship.speed * 1.5));
      case 'pit': {
        if (this.pitStart === null) return false;
        const ahead = this.ahead(d, this.pitStart);
        if (ahead > 300) return false;
        const wraps = d > this.pitStart; // the strip is past the line: the next lap is starting
        return ship.energy < 0.7 * ship.def.stats.energyMax || race.lap >= 2 || wraps;
      }
      case 'item':
        return this.since >= 3 && this.straightAhead(d, Math.max(80, ship.speed * 2));
    }
  }

  /** Metres from `d` forward to `target` along the loop. */
  private ahead(d: number, target: number): number {
    const L = this.track.length;
    return (((target - d) % L) + L) % L;
  }

  private straightAhead(d: number, span: number): boolean {
    const s = this.track.samples;
    const L = this.track.length;
    const step = L / s.length;
    const i0 = Math.floor(d / step);
    for (let k = 0; k * step <= span; k++) if (Math.abs(s[(i0 + k) % s.length].curvature) >= STRAIGHT_K) return false;
    return true;
  }
}

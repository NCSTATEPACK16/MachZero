import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHIP_ROSTER } from '../../core/config';
import type { HudActions, ShipState } from '../../core/contracts';
import { EventBus, type GameEvents } from '../../core/events';
import { HUD } from '../HUD';
import { RaceManager } from '../RaceManager';
import { makeCircleTrack, makeShip, placeShip } from './helpers';

/** Just enough of a DOM to exercise HUD/Minimap code paths in a node environment. */
class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  className = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty(k: string, v: string): void } = { setProperty: () => undefined };
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  width = 0;
  height = 0;
  offsetWidth = 1;
  private text = '';
  disabled = false;
  type = '';
  constructor(readonly tag: string) {}
  get textContent(): string {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this.text;
  }
  set textContent(v: string) {
    this.children = [];
    this.text = v;
  }
  classList = {
    add: (...c: string[]) => {
      for (const n of c) if (!this.className.split(' ').includes(n)) this.className = `${this.className} ${n}`.trim();
    },
    remove: (...c: string[]) => {
      this.className = this.className.split(' ').filter((n) => n && !c.includes(n)).join(' ');
    },
    toggle: (n: string, force?: boolean) => {
      const has = this.className.split(' ').includes(n);
      const want = force ?? !has;
      if (want) this.classList.add(n);
      else this.classList.remove(n);
      return want;
    },
    contains: (n: string) => this.className.split(' ').includes(n),
  };
  appendChild(c: FakeEl): FakeEl {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  addEventListener(t: string, fn: (e: unknown) => void): void {
    (this.listeners[t] ??= []).push(fn);
  }
  click(): void {
    for (const fn of this.listeners.click ?? []) fn({ stopPropagation: () => undefined });
  }
  blur(): void {}
  getContext(): unknown {
    return new Proxy({}, { get: () => () => undefined, set: () => true });
  }
  find(cls: string): FakeEl | null {
    if (this.className.split(' ').includes(cls)) return this;
    for (const c of this.children) {
      const f = c.find(cls);
      if (f) return f;
    }
    return null;
  }
  findAll(cls: string, out: FakeEl[] = []): FakeEl[] {
    if (this.className.split(' ').includes(cls)) out.push(this);
    for (const c of this.children) c.findAll(cls, out);
    return out;
  }
}

describe('HUD (fake DOM smoke test)', () => {
  const winListeners: Record<string, Array<(e: unknown) => void>> = {};

  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (t: string) => new FakeEl(t),
      createElementNS: (_ns: string, t: string) => new FakeEl(t),
    });
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: (t: string, fn: (e: unknown) => void) => (winListeners[t] ??= []).push(fn),
      removeEventListener: () => undefined,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds all screens, follows race state and renders results', () => {
    const track = makeCircleTrack(500);
    const bus = new EventBus<GameEvents>();
    const ships: ShipState[] = SHIP_ROSTER.map((d) => {
      const s = makeShip(d.id, d.isPlayer, d.personality);
      placeShip(s, track, 0.99 - d.gridIndex * 0.003, 0);
      return s;
    });
    const race = new RaceManager(track, ships, bus);
    const calls = { start: 0, restart: 0, resume: 0, mute: 0 };
    const actions: HudActions = {
      onStart: () => void (calls.start++, race.start()),
      onRestart: () => void calls.restart++,
      onResume: () => void calls.resume++,
      onToggleMute: () => void calls.mute++,
    };
    const root = new FakeEl('div');
    const hud = new HUD(root as unknown as HTMLElement, bus, track, actions);
    const container = root.children[0];
    expect(container.dataset.state).toBe('title');

    hud.update(race.snapshot(), 1 / 60);
    expect(container.dataset.state).toBe('title');

    // Buttons call back into HudActions.
    const big = container.find('mz-title')!.findAll('mz-btn')[0];
    big.click();
    expect(calls.start).toBe(1);
    expect(race.state).toBe('countdown');

    // Countdown text follows the snapshot.
    hud.update(race.snapshot(), 1 / 60);
    expect(container.dataset.state).toBe('countdown');
    expect(container.find('mz-countdown')!.textContent).toBe('3');

    // Race a few seconds; HUD numbers update.
    for (let i = 0; i < 4 * 60; i++) {
      race.fixedUpdate(1 / 60);
      ships[0].speed = 100;
      hud.update(race.snapshot(), 1 / 60);
    }
    expect(container.dataset.state).toBe('racing');
    expect(container.find('mz-speed-num')!.textContent).toBe(String(Math.round(100 * 7.9)));
    expect(container.find('mz-boost')!.dataset.s).toBe('locked');
    bus.emit('race:lap', { shipId: 0, lap: 1, lapTime: 80, isBest: true, isRecord: true });
    bus.emit('ship:lowEnergy', { shipId: 0 });
    expect(container.find('mz-toasts')!.children.length).toBeGreaterThan(0);

    // Pause overlay.
    race.pause(true);
    hud.update(race.snapshot(), 1 / 60);
    expect(container.dataset.state).toBe('paused');
    const pauseBtns = container.find('mz-pause')!.findAll('mz-btn');
    pauseBtns[0].click();
    expect(calls.resume).toBe(1);
    pauseBtns[1].click();
    expect(calls.restart).toBe(1);
    race.pause(false);

    // Results: finish the player then wait for the delay.
    ships[0].energy = 0;
    for (let i = 0; i < 6 * 60; i++) race.fixedUpdate(1 / 60);
    expect(race.state).toBe('results');
    hud.update(race.snapshot(), 1 / 60);
    expect(container.dataset.state).toBe('results');
    const results = container.find('mz-results')!;
    expect(results.find('mz-heading')!.textContent).toBe('RETIRED');
    expect(results.find('mz-table')!.findAll('row').length).toBe(4);
    results.findAll('mz-btn')[0].click();
    expect(calls.restart).toBe(2);

    // Mute events from the audio system relabel the buttons.
    bus.emit('audio:mute', { muted: true });
    expect(container.findAll('mz-chip')[0].textContent).toContain('OFF');
  });
});

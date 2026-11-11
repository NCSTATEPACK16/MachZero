import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import type { AITier, ControlInput, ShipState } from '../../core/contracts';
import { neutralControls } from '../../core/controls';
import { SHIELD_TIME, emptyBag, type ItemBag, type ItemKind } from '../../content/items';
import { ItemSystem, type ItemHost } from '../ItemSystem';
import { makeBus, makeCircleTrack, makeShip } from './helpers';

const DT = CONFIG.FIXED_DT;
/** Track metres between neighbours in the fake standings. */
const GAP = 20;

/** Ships in standings order (index 0 leads), all racing; the player is `playerAt`. */
function world(opts: { tier?: AITier; playerAt?: number; n?: number; seed?: number; bag?: Partial<ItemBag> } = {}) {
  const n = opts.n ?? 4;
  const playerAt = opts.playerAt ?? n - 1;
  const ships: ShipState[] = [];
  for (let i = 0; i < n; i++) {
    const s = makeShip(i === playerAt ? 0 : i + 1, i === playerAt);
    Object.assign(s.def, { tier: opts.tier ?? 'rookie' });
    s.status = 'racing';
    ships.push(s);
  }
  const player = ships[playerAt];
  const order = (): ShipState[] => ships.filter((s) => s.status === 'racing');
  const { bus, events } = makeBus();
  const drops: number[] = [];
  const race: ItemHost['race'] = {
    state: 'racing',
    racerAhead: (id) => {
      const o = order();
      const i = o.findIndex((s) => s.def.id === id);
      return i > 0 ? o[i - 1] : null;
    },
    racerBehind: (id) => {
      const o = order();
      const i = o.findIndex((s) => s.def.id === id);
      return i >= 0 && i < o.length - 1 ? o[i + 1] : null;
    },
    gapMetres: (a, b) => (ships.findIndex((s) => s.def.id === b) - ships.findIndex((s) => s.def.id === a)) * GAP,
  } as ItemHost['race'];
  const bag: ItemBag = { ...emptyBag(), ...opts.bag };
  const used: ItemKind[] = [];
  const playerItems = { counts: () => bag, use: (k: ItemKind) => (used.push(k), bag[k]--) };
  const host: ItemHost = { ships, player, race, bus, physics: { dropMine: (owner) => (drops.push(owner), 0) }, track: makeCircleTrack(2000) };
  const items = new ItemSystem(host, opts.seed ?? 1234, playerItems);
  const step = (input: Partial<ControlInput> | null = null) => items.fixed(DT, input ? { ...neutralControls(), ...input } : null);
  const run = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) step();
  };
  const count = (type: string) => events.filter((e) => e.type === type).length;
  return { ships, player, bus, events, items, bag, used, drops, step, run, count };
}

describe('ItemSystem: the player', () => {
  it('cycles the selection over held kinds only, and moves on when the selected kind runs out', () => {
    const w = world({ bag: { emp: 1, mine: 2 } });
    expect(w.items.selected).toBe('emp');
    w.step({ itemCycle: 1 });
    expect(w.items.selected).toBe('mine'); // no shields held: skipped
    w.step({ itemCycle: 1 });
    expect(w.items.selected).toBe('emp');
    w.step({ itemCycle: -1 });
    expect(w.items.selected).toBe('mine');
    w.step({ itemCycle: 1 });
    w.step({ fire: true });
    expect(w.used).toEqual(['emp']);
    expect(w.items.selected).toBe('mine');
  });

  it('fires the EMP at the racer directly ahead at once', () => {
    const w = world({ bag: { emp: 1 } });
    w.step({ fire: true });
    const ahead = w.ships[w.ships.length - 2];
    expect(ahead.empSlow).toBeCloseTo(CONFIG.EMP_SLOW_TIME, 1);
    expect(ahead.empLock).toBeCloseTo(CONFIG.EMP_LOCK_TIME, 1);
    expect(w.count('item:emp')).toBe(1);
    expect(w.count('item:warn')).toBe(0);
  });

  it('drops a mine through physics', () => {
    const w = world({ bag: { mine: 1 } });
    w.step({ fire: true });
    expect(w.drops).toEqual([w.player.def.id]);
    expect(w.bag.mine).toBe(0);
  });

  it('raises a shield that blocks one EMP and then pops', () => {
    const w = world({ playerAt: 0, bag: { shield: 1 } });
    w.step({ fire: true });
    expect(w.player.shield).toBeCloseTo(SHIELD_TIME, 1);
    // A second use while it is up spends nothing.
    w.bag.shield = 1;
    w.step({ fire: true });
    expect(w.bag.shield).toBe(1);
    // An EMP from behind lands on the shield.
    (w.items as unknown as { hit(a: ShipState, b: ShipState): void }).hit(w.ships[1], w.player);
    expect(w.player.shield).toBe(0);
    expect(w.player.empSlow).toBe(0);
    expect(w.count('item:shield')).toBe(1);
    (w.items as unknown as { hit(a: ShipState, b: ShipState): void }).hit(w.ships[1], w.player);
    expect(w.player.empSlow).toBeGreaterThan(0);
  });

  it('lets the shield expire at 8 s', () => {
    const w = world({ bag: { shield: 1 } });
    w.step({ fire: true });
    w.run(SHIELD_TIME - 0.1);
    expect(w.player.shield).toBeGreaterThan(0);
    w.run(0.2);
    expect(w.player.shield).toBe(0);
  });

  it('reports an empty bag and a missing target without spending', () => {
    const w = world({ playerAt: 0, bag: { emp: 1 } });
    w.step({ fire: true }); // leading: nobody ahead
    expect(w.bag.emp).toBe(1);
    w.bag.emp = 0;
    w.step({ fire: true });
    const fails = w.events.filter((e) => e.type === 'item:fail').map((e) => (e.payload as { reason: string }).reason);
    expect(fails).toEqual(['noTarget', 'empty']);
  });
});

describe('ItemSystem: CPU items', () => {
  it('gives Rookie CPUs nothing, Pilot CPUs one item and Ace/Legend CPUs two', () => {
    for (const [tier, n] of [['rookie', 0], ['pilot', 1], ['ace', 2], ['legend', 2]] as const) {
      const w = world({ tier });
      for (const s of w.ships) {
        if (s === w.player) continue;
        const b = w.items.cpuBag(s.def.id)!;
        expect(b.emp + b.shield + b.mine, `${tier}`).toBe(n);
      }
      if (tier === 'rookie') {
        w.run(60);
        expect(w.count('item:warn') + w.count('item:use')).toBe(0);
      }
    }
  });

  it('draws and uses items the same way for the same seed (and a restart replays them)', () => {
    const trace = (seed: number) => {
      const w = world({ tier: 'legend', n: 8, seed });
      w.run(40);
      return w.events.filter((e) => e.type.startsWith('item:')).map((e) => `${e.type}:${JSON.stringify(e.payload, (k, v) => (k === 'point' ? undefined : v))}`);
    };
    const a = trace(99);
    expect(a.length).toBeGreaterThan(0);
    expect(trace(99)).toEqual(a);
    const w = world({ tier: 'legend', n: 8, seed: 99 });
    const before = w.ships.map((s) => ({ ...w.items.cpuBag(s.def.id) }));
    w.run(40);
    w.items.reset();
    expect(w.ships.map((s) => ({ ...w.items.cpuBag(s.def.id) }))).toEqual(before);
  });

  it('warns the target 0.5 s before a CPU EMP lands, and never EMPs the same racer twice within 10 s', () => {
    const w = world({ tier: 'legend', n: 2, playerAt: 0 });
    const cpu = w.ships[1];
    // Give the CPU EMPs only, so its choices are EMPs at the player.
    const bag = w.items.cpuBag(cpu.def.id) as ItemBag;
    Object.assign(bag, { emp: 5, shield: 0, mine: 0 });
    const warns: number[] = [];
    const hits: number[] = [];
    let clock = 0;
    w.bus.on('item:warn', (e) => {
      expect(e.target).toBe(w.player.def.id);
      warns.push(clock);
    });
    w.bus.on('item:emp', () => hits.push(clock));
    let incomingSeen = false;
    for (; clock < 60; clock += DT) {
      w.step();
      const v = w.items.playerView()!;
      if (v.incoming > 0) incomingSeen = true;
      if (w.player.empSlow > 0) w.player.empSlow = 0; // keep it racing as a target
    }
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expect(incomingSeen).toBe(true);
    for (let i = 0; i < warns.length; i++) expect(hits[i] - warns[i]).toBeCloseTo(CONFIG.EMP_WARN_TIME, 1);
    for (let i = 1; i < warns.length; i++) expect(warns[i] - warns[i - 1]).toBeGreaterThanOrEqual(CONFIG.EMP_RETARGET_TIME - 1e-6);
  });

  it('a CPU with a shield raises it against an incoming EMP (Legend always)', () => {
    const w = world({ tier: 'legend', n: 2, playerAt: 1 });
    const cpu = w.ships[0];
    const cpuBag = w.items.cpuBag(cpu.def.id) as ItemBag;
    Object.assign(cpuBag, { emp: 0, shield: 1, mine: 0 });
    // An EMP from behind, sent the CPU way (warning first) through the private path.
    (w.items as unknown as { use(s: ShipState, k: ItemKind, p: boolean): boolean }).use(w.player, 'emp', false);
    expect(cpu.shield).toBeGreaterThan(0);
    expect(cpuBag.shield).toBe(0);
    w.run(1);
    expect(cpu.empSlow).toBe(0);
    expect(w.count('item:shield')).toBe(1);
  });
});

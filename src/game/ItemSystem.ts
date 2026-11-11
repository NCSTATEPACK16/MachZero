/**
 * Race items in play (IMPLEMENTATION §P): the player's selection and use, the CPU rivals' seeded items, raised
 * shields, and CPU EMPs in flight. Game-side and Node-safe; RaceSession owns one per race and calls `fixed` once
 * per fixed step, before physics.
 *
 *  - EMP: the racer directly ahead runs at EMP_SLOW for EMP_SLOW_TIME and can't boost for EMP_LOCK_TIME. The
 *    player's lands at once; a CPU's lands EMP_WARN_TIME after an `item:warn`, so the target can raise a shield,
 *    and a CPU never EMPs the same racer twice within EMP_RETARGET_TIME.
 *  - Shield: up for SHIELD_TIME or until it blocks one EMP (here) or mine (physics), whichever comes first.
 *  - Drop Mine: PhysicsSystem.dropMine leaves it behind the ship.
 *
 * CPU items: CPU_ITEM_COUNT per rival by tier, drawn and used on a mulberry32 stream seeded from the race seed
 * and the ship, so a race replays the same (never Math.random in the fixed step).
 */
import { CONFIG } from '../core/config';
import type { ControlInput, ShipId, ShipState, TrackData, TrackSample } from '../core/contracts';
import type { GameBus } from '../core/events';
import { Rng } from '../core/rng';
import { CPU_ITEM_COUNT, ITEM_KINDS, SHIELD_TIME, emptyBag, nextHeldKind, type ItemBag, type ItemKind } from '../content/items';
import type { RaceManager } from './RaceManager';

/** The player's stock: the active profile's bag (`use` spends one from the save at once). */
export interface PlayerItems {
  counts(): Readonly<ItemBag>;
  use(kind: ItemKind): void;
}

/** What the item system needs from the race around it. */
export interface ItemHost {
  ships: readonly ShipState[];
  player: ShipState;
  race: Pick<RaceManager, 'racerAhead' | 'racerBehind' | 'gapMetres' | 'state'>;
  bus: GameBus;
  physics: { dropMine(owner: ShipId): number | null };
  track: TrackData;
}

/** The player's items as the HUD shows them. */
export interface ItemView {
  selected: ItemKind;
  counts: Readonly<ItemBag>;
  /** Seconds of shield left (0 = down). */
  shield: number;
  /** Seconds until a CPU EMP aimed at the player lands (0 = none). */
  incoming: number;
}

/** CPU decisions: seconds between looks, the quiet start, and the windows each item is used in. */
const CPU_THINK = 0.25;
const CPU_QUIET_START = 4;
const CPU_EMP_RANGE: readonly [number, number] = [5, 70];
const CPU_EMP_CHANCE = 0.25;
const CPU_SHIELD_BEHIND = 12;
const CPU_SHIELD_CHANCE = 0.3;
const CPU_MINE_BEHIND: readonly [number, number] = [15, 60];
const CPU_MINE_CHANCE = 0.35;
/** A straight: the road's heading CPU_STRAIGHT_AHEAD m on is within acos(CPU_STRAIGHT_DOT) of here. */
const CPU_STRAIGHT_AHEAD = 80;
const CPU_STRAIGHT_DOT = 0.985;
/** Chance a CPU raises a shield it holds against an incoming EMP, by tier. */
const CPU_SHIELD_REACT: Readonly<Record<string, number>> = { rookie: 0, pilot: 0.5, ace: 0.8, legend: 1 };

interface CpuItems {
  ship: ShipState;
  rng: Rng;
  /** The race's draw (a restart restores it). */
  drawn: ItemBag;
  bag: ItemBag;
  nextThink: number;
  react: number;
}

interface EmpInFlight {
  from: ShipState;
  target: ShipState;
  landsAt: number;
}

export class ItemSystem {
  private selectedKind: ItemKind = 'emp';
  private readonly cpus: CpuItems[] = [];
  private readonly inFlight: EmpInFlight[] = [];
  /** `from * 1024 + target` → race clock of the last CPU EMP. */
  private readonly lastEmp = new Map<number, number>();
  private clock = 0;
  private readonly view: ItemView = { selected: 'emp', counts: emptyBag(), shield: 0, incoming: 0 };
  private sa: TrackSample | undefined;
  private sb: TrackSample | undefined;

  constructor(
    private readonly host: ItemHost,
    seed: number,
    private readonly playerItems?: PlayerItems,
  ) {
    for (const ship of host.ships) {
      if (ship === host.player) continue;
      const rng = new Rng(((seed ^ 0x5eed17e5) + ship.def.id * 7919) >>> 0);
      const drawn = emptyBag();
      const tier = ship.def.tier ?? 'rookie';
      for (let i = 0; i < CPU_ITEM_COUNT[tier]; i++) drawn[rng.pick(ITEM_KINDS)]++;
      this.cpus.push({ ship, rng, drawn, bag: { ...drawn }, nextThink: CPU_QUIET_START, react: CPU_SHIELD_REACT[tier] ?? 0 });
    }
    this.syncSelection();
  }

  /** The kind the player's use button fires. */
  get selected(): ItemKind {
    return this.selectedKind;
  }

  /** A CPU's items left (tests, debug). */
  cpuBag(id: ShipId): Readonly<ItemBag> | null {
    return this.cpus.find((c) => c.ship.def.id === id)?.bag ?? null;
  }

  /** Back to the grid: CPUs get their draw back, nothing in flight. The player's stock is the save's. */
  reset(): void {
    this.clock = 0;
    this.inFlight.length = 0;
    this.lastEmp.clear();
    for (const c of this.cpus) {
      c.bag = { ...c.drawn };
      c.nextThink = CPU_QUIET_START;
    }
    this.syncSelection();
  }

  /** One fixed step, before physics. `human` is the player's input when the player is driving. */
  fixed(dt: number, human: ControlInput | null): void {
    if (this.host.race.state !== 'racing') return;
    this.clock += dt;
    for (const s of this.host.ships) if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
    this.land();
    const player = this.host.player;
    if (human && player.status === 'racing') {
      if (human.itemCycle) this.cycle(human.itemCycle > 0 ? 1 : -1);
      if (human.fire) this.usePlayer();
    }
    for (const c of this.cpus) this.think(c);
  }

  /** The player's items for the HUD (the same object every call). */
  playerView(): ItemView | null {
    if (!this.playerItems) return null;
    this.syncSelection();
    const v = this.view;
    v.selected = this.selectedKind;
    v.counts = this.playerItems.counts();
    v.shield = this.host.player.shield;
    v.incoming = 0;
    for (const f of this.inFlight) if (f.target === this.host.player) v.incoming = Math.max(v.incoming, f.landsAt - this.clock);
    return v;
  }

  /** Select the next (+1) or previous (−1) kind the player holds. */
  cycle(dir: 1 | -1): void {
    if (!this.playerItems) return;
    this.selectedKind = nextHeldKind(this.playerItems.counts(), this.selectedKind, dir);
  }

  private syncSelection(): void {
    const items = this.playerItems;
    if (!items) return;
    const counts = items.counts();
    if (counts[this.selectedKind] <= 0) this.selectedKind = nextHeldKind(counts, this.selectedKind);
  }

  private usePlayer(): void {
    const items = this.playerItems;
    const id = this.host.player.def.id;
    this.syncSelection();
    const kind = this.selectedKind;
    if (!items || items.counts()[kind] <= 0) {
      this.host.bus.emit('item:fail', { shipId: id, reason: 'empty', kind });
      return;
    }
    if (this.use(this.host.player, kind, true)) {
      items.use(kind);
      this.syncSelection();
    }
  }

  /** Use `kind` for `ship`; false when it can't be used now (nothing spent). */
  private use(ship: ShipState, kind: ItemKind, isPlayer: boolean): boolean {
    const bus = this.host.bus;
    const id = ship.def.id;
    if (kind === 'emp') {
      const target = this.host.race.racerAhead(id);
      if (!target) {
        if (isPlayer) bus.emit('item:fail', { shipId: id, reason: 'noTarget', kind });
        return false;
      }
      if (isPlayer) this.hit(ship, target);
      else {
        this.inFlight.push({ from: ship, target, landsAt: this.clock + CONFIG.EMP_WARN_TIME });
        this.lastEmp.set(id * 1024 + target.def.id, this.clock);
        bus.emit('item:warn', { from: id, target: target.def.id });
        const cpu = this.cpus.find((c) => c.ship === target);
        if (cpu && cpu.bag.shield > 0 && target.shield <= 0 && cpu.rng.next() < cpu.react) this.raiseShield(cpu.ship, cpu.bag);
      }
      return true;
    }
    if (kind === 'shield') {
      if (ship.shield > 0) return false;
      ship.shield = SHIELD_TIME;
      bus.emit('item:use', { shipId: id, kind });
      return true;
    }
    if (this.host.physics.dropMine(id) === null) return false;
    bus.emit('item:use', { shipId: id, kind });
    return true;
  }

  private raiseShield(ship: ShipState, bag: ItemBag): void {
    if (this.use(ship, 'shield', false)) bag.shield--;
  }

  /** Land the CPU EMPs whose warning has run out. */
  private land(): void {
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const f = this.inFlight[i];
      if (this.clock < f.landsAt) continue;
      this.inFlight.splice(i, 1);
      if (f.target.status === 'racing') this.hit(f.from, f.target);
    }
  }

  private hit(from: ShipState, target: ShipState): void {
    if (target.shield > 0) {
      target.shield = 0;
      this.host.bus.emit('item:shield', { shipId: target.def.id, blocked: 'emp', point: target.position.clone() });
      return;
    }
    target.empSlow = CONFIG.EMP_SLOW_TIME;
    target.empLock = CONFIG.EMP_LOCK_TIME;
    this.host.bus.emit('item:emp', { from: from.def.id, target: target.def.id, targetName: target.def.name });
  }

  private think(c: CpuItems): void {
    const ship = c.ship;
    if (ship.status !== 'racing' || this.clock < c.nextThink) return;
    c.nextThink = this.clock + CPU_THINK;
    const bag = c.bag;
    if (bag.emp + bag.shield + bag.mine === 0) return;
    const race = this.host.race;
    const id = ship.def.id;

    if (bag.emp > 0) {
      const target = race.racerAhead(id);
      if (target && !this.inFlight.some((f) => f.from === ship)) {
        const gap = race.gapMetres(target.def.id, id);
        const last = this.lastEmp.get(id * 1024 + target.def.id) ?? -Infinity;
        if (gap >= CPU_EMP_RANGE[0] && gap <= CPU_EMP_RANGE[1] && this.clock - last >= CONFIG.EMP_RETARGET_TIME && c.rng.next() < CPU_EMP_CHANCE) {
          if (this.use(ship, 'emp', false)) bag.emp--;
          return;
        }
      }
    }
    const behind = race.racerBehind(id);
    const gapBehind = behind ? race.gapMetres(id, behind.def.id) : Infinity;
    if (bag.shield > 0 && ship.shield <= 0 && gapBehind <= CPU_SHIELD_BEHIND && c.rng.next() < CPU_SHIELD_CHANCE) {
      this.raiseShield(ship, bag);
      return;
    }
    if (bag.mine > 0 && gapBehind >= CPU_MINE_BEHIND[0] && gapBehind <= CPU_MINE_BEHIND[1] && this.onStraight(ship) && c.rng.next() < CPU_MINE_CHANCE) {
      if (this.use(ship, 'mine', false)) bag.mine--;
    }
  }

  private onStraight(ship: ShipState): boolean {
    if (ship.path !== null || ship.airborne) return false;
    const track = this.host.track;
    const a = (this.sa = track.sampleAt(ship.trackU, this.sa));
    const b = (this.sb = track.sampleAt(ship.trackU + CPU_STRAIGHT_AHEAD / track.length, this.sb));
    return a.forward.dot(b.forward) >= CPU_STRAIGHT_DOT;
  }
}

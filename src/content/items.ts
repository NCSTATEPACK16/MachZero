/**
 * Race items bought in the garage before a race (SPEC §4.4a, IMPLEMENTATION §P). Three kinds share one set of
 * slots: the EMP (fired at the racer directly ahead: CONFIG.EMP_*), the Shield (blocks one EMP or mine for up to
 * SHIELD_TIME) and the Drop Mine (left behind the ship: CONFIG.DROP_MINE_*). Pilots carry up to `itemSlots` items
 * in any mix; more slots unlock with wins, and unused items carry over to the next race. Pure, like economy.ts.
 */
import type { AITier } from '../core/contracts';

export type ItemKind = 'emp' | 'shield' | 'mine';

/** Every kind, in selection and display order. */
export const ITEM_KINDS: readonly ItemKind[] = ['emp', 'shield', 'mine'];

export const ITEM_PRICES: Readonly<Record<ItemKind, number>> = { emp: 400, shield: 300, mine: 350 };
export const ITEM_NAMES: Readonly<Record<ItemKind, string>> = { emp: 'EMP', shield: 'SHIELD', mine: 'DROP MINE' };
export const ITEM_ICONS: Readonly<Record<ItemKind, string>> = { emp: '⚡', shield: '🛡', mine: '✷' };

/** Seconds a raised shield lasts if nothing hits it. */
export const SHIELD_TIME = 8;

/** Slots at the start, and the win counts that unlock one more each. */
export const ITEM_BASE_SLOTS = 2;
export const ITEM_SLOT_UNLOCK_WINS: readonly number[] = [3, 10];

export type ItemBag = Record<ItemKind, number>;

export function emptyBag(): ItemBag {
  return { emp: 0, shield: 0, mine: 0 };
}

export function bagTotal(bag: Readonly<ItemBag>): number {
  return bag.emp + bag.shield + bag.mine;
}

export interface ItemHolder {
  credits: number;
  items: ItemBag;
  stats: { wins: number };
}

/** How many items (of any kind, in total) this pilot can carry. */
export function itemSlots(p: { stats: { wins: number } }): number {
  return ITEM_BASE_SLOTS + ITEM_SLOT_UNLOCK_WINS.filter((w) => p.stats.wins >= w).length;
}

/** Wins needed for the next slot, or null when every slot is unlocked. */
export function nextItemSlotAt(p: { stats: { wins: number } }): number | null {
  return ITEM_SLOT_UNLOCK_WINS.find((w) => p.stats.wins < w) ?? null;
}

export type ItemPurchase = 'bought' | 'full' | 'short';

/** Buy one item of `kind`. Mutates `p` only on 'bought'. */
export function buyItem(p: ItemHolder, kind: ItemKind): ItemPurchase {
  if (bagTotal(p.items) >= itemSlots(p)) return 'full';
  if (p.credits < ITEM_PRICES[kind]) return 'short';
  p.credits -= ITEM_PRICES[kind];
  p.items[kind]++;
  return 'bought';
}

/**
 * Clamp a bag to the slot count: non-negative whole counts, total at most `slots`, keeping kinds in ITEM_KINDS
 * order (EMPs first) when it has to drop some.
 */
export function clampBag(raw: Partial<Record<ItemKind, unknown>>, slots: number): ItemBag {
  const out = emptyBag();
  let left = Math.max(0, slots);
  for (const k of ITEM_KINDS) {
    const v = raw[k];
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    out[k] = Math.min(n, left);
    left -= out[k];
  }
  return out;
}

/** The next kind after `from` (wrapping) that the bag holds, or `from` when it holds nothing else. */
export function nextHeldKind(bag: Readonly<ItemBag>, from: ItemKind, dir: 1 | -1 = 1): ItemKind {
  const n = ITEM_KINDS.length;
  const i = ITEM_KINDS.indexOf(from);
  for (let step = 1; step <= n; step++) {
    const k = ITEM_KINDS[(((i + dir * step) % n) + n) % n];
    if (bag[k] > 0) return k;
  }
  return from;
}

/** CPU items per rival by tier (SPEC §4.4a): none on Rookie, 1 on Pilot, 2 on Ace and Legend. */
export const CPU_ITEM_COUNT: Readonly<Record<AITier, number>> = { rookie: 0, pilot: 1, ace: 2, legend: 2 };

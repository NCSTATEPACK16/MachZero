/**
 * Race items bought in the garage before a race. One kind so far: the EMP, fired at the racer directly ahead
 * (CONFIG.EMP_*: slowed for a moment and unable to boost for longer). Pilots carry up to `empSlots` EMPs;
 * more slots unlock with wins, and unused EMPs carry over to the next race. Pure, like economy.ts.
 */

export const EMP_PRICE = 400;
/** Slots at the start, and the win counts that unlock one more each. */
export const EMP_BASE_SLOTS = 2;
export const EMP_SLOT_UNLOCK_WINS: readonly number[] = [3, 10];

export interface ItemBag {
  emp: number;
}

export interface ItemHolder {
  credits: number;
  items: ItemBag;
  stats: { wins: number };
}

/** How many EMPs this pilot can carry. */
export function empSlots(p: { stats: { wins: number } }): number {
  return EMP_BASE_SLOTS + EMP_SLOT_UNLOCK_WINS.filter((w) => p.stats.wins >= w).length;
}

/** Wins needed for the next slot, or null when every slot is unlocked. */
export function nextEmpSlotAt(p: { stats: { wins: number } }): number | null {
  return EMP_SLOT_UNLOCK_WINS.find((w) => p.stats.wins < w) ?? null;
}

export type ItemPurchase = 'bought' | 'full' | 'short';

/** Buy one EMP. Mutates `p` only on 'bought'. */
export function buyEmp(p: ItemHolder): ItemPurchase {
  if (p.items.emp >= empSlots(p)) return 'full';
  if (p.credits < EMP_PRICE) return 'short';
  p.credits -= EMP_PRICE;
  p.items.emp++;
  return 'bought';
}

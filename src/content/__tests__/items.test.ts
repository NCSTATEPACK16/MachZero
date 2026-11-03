import { describe, expect, it } from 'vitest';
import { createProfile } from '../../save/schema';
import { ITEM_PRICES, bagTotal, buyItem, clampBag, itemSlots, nextHeldKind, nextItemSlotAt } from '../items';

describe('items', () => {
  it('starts with 2 slots; wins unlock a 3rd at 3 and a 4th at 10', () => {
    const p = createProfile('T', 0, 'rookie');
    expect(itemSlots(p)).toBe(2);
    expect(nextItemSlotAt(p)).toBe(3);
    p.stats.wins = 3;
    expect(itemSlots(p)).toBe(3);
    expect(nextItemSlotAt(p)).toBe(10);
    p.stats.wins = 12;
    expect(itemSlots(p)).toBe(4);
    expect(nextItemSlotAt(p)).toBeNull();
  });

  it('prices: EMP 400, Shield 300, Drop Mine 350', () => {
    expect(ITEM_PRICES).toEqual({ emp: 400, shield: 300, mine: 350 });
  });

  it('every kind shares the slots; buying pays the price and stops when short or full', () => {
    const p = createProfile('T', 0, 'rookie');
    p.credits = ITEM_PRICES.shield + ITEM_PRICES.mine + ITEM_PRICES.emp - 1;
    expect(buyItem(p, 'shield')).toBe('bought');
    expect(buyItem(p, 'mine')).toBe('bought');
    expect(p.items).toEqual({ emp: 0, shield: 1, mine: 1 });
    expect(buyItem(p, 'emp')).toBe('full');
    p.stats.wins = 3;
    expect(buyItem(p, 'emp')).toBe('short');
    expect(bagTotal(p.items)).toBe(2);
    expect(p.credits).toBe(ITEM_PRICES.emp - 1);
  });

  it('clamps a bag to the slots, keeping EMPs first', () => {
    expect(clampBag({ emp: 3, shield: 2, mine: 1 }, 4)).toEqual({ emp: 3, shield: 1, mine: 0 });
    expect(clampBag({ emp: -1, shield: 1.7, mine: 'x' as unknown as number }, 4)).toEqual({ emp: 0, shield: 1, mine: 0 });
    expect(clampBag({}, 2)).toEqual({ emp: 0, shield: 0, mine: 0 });
  });

  it('cycles to the next held kind, either way, and stays put when nothing else is held', () => {
    const bag = { emp: 1, shield: 0, mine: 2 };
    expect(nextHeldKind(bag, 'emp')).toBe('mine');
    expect(nextHeldKind(bag, 'mine')).toBe('emp');
    expect(nextHeldKind(bag, 'emp', -1)).toBe('mine');
    expect(nextHeldKind({ emp: 0, shield: 1, mine: 0 }, 'shield')).toBe('shield');
    expect(nextHeldKind({ emp: 0, shield: 0, mine: 0 }, 'emp')).toBe('emp');
  });
});

import { describe, expect, it } from 'vitest';
import { createProfile } from '../../save/schema';
import { EMP_PRICE, buyEmp, empSlots, nextEmpSlotAt } from '../items';

describe('EMP items', () => {
  it('starts with 2 slots; wins unlock a 3rd at 3 and a 4th at 10', () => {
    const p = createProfile('T', 0, 'rookie');
    expect(empSlots(p)).toBe(2);
    expect(nextEmpSlotAt(p)).toBe(3);
    p.stats.wins = 3;
    expect(empSlots(p)).toBe(3);
    expect(nextEmpSlotAt(p)).toBe(10);
    p.stats.wins = 12;
    expect(empSlots(p)).toBe(4);
    expect(nextEmpSlotAt(p)).toBeNull();
  });

  it('buying pays the price, and stops when short or full', () => {
    const p = createProfile('T', 0, 'rookie');
    p.credits = EMP_PRICE * 3 - 1;
    expect(buyEmp(p)).toBe('bought');
    expect(buyEmp(p)).toBe('bought');
    expect(p.items.emp).toBe(2);
    expect(p.credits).toBe(EMP_PRICE - 1);
    expect(buyEmp(p)).toBe('full');
    p.stats.wins = 3;
    expect(buyEmp(p)).toBe('short');
    expect(p.items.emp).toBe(2);
    expect(p.credits).toBe(EMP_PRICE - 1);
  });
});

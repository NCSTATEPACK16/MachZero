import { describe, expect, it } from 'vitest';
import type { RacerStanding } from '../../../core/contracts';
import { racePayout } from '../../../content/economy';
import { raceTally, winnerQuote } from '../raceResult';

const me = (position: number, status: RacerStanding['status'] = 'finished', id = 0): RacerStanding => ({ id, name: id ? `R${id}` : 'ME', position, lap: 3, progress: 3, totalTime: 90, bestLap: 30, status });
const sum = (lines: { amount: number }[]) => lines.reduce((a, l) => a + l.amount, 0);

describe('results tally (IMPLEMENTATION §M8a)', () => {
  it('a Rookie win is one line', () => {
    expect(raceTally(me(1), 'rookie')).toEqual([{ label: '1ST PLACE', amount: 1000 }]);
  });

  it('2nd at Pilot: the place and the tier extra add up to the payout', () => {
    const t = raceTally(me(2), 'pilot');
    expect(t).toEqual([
      { label: '2ND PLACE', amount: 750 },
      { label: 'PILOT ×1.3', amount: racePayout(2, 'pilot') - 750 },
    ]);
    expect(sum(t)).toBe(racePayout(2, 'pilot'));
  });

  it('first clear and cup bonus lines follow, in that order', () => {
    const t = raceTally(me(3), 'legend', { firstClear: 1000, cup: 6600 });
    expect(t.map((l) => l.label)).toEqual(['3RD PLACE', 'LEGEND ×2.2', 'FIRST CLEAR', 'CUP BONUS']);
    expect(sum(t)).toBe(racePayout(3, 'legend') + 1000 + 6600);
  });

  it('a retired ship still shows what its position paid; no standing gives no lines', () => {
    expect(raceTally(me(8, 'retired'), 'rookie')).toEqual([{ label: 'RETIRED', amount: racePayout(8, 'rookie') }]);
    expect(raceTally(undefined, 'ace')).toEqual([]);
  });

  it('the quote is the winning rival\'s catchphrase, never the player\'s', () => {
    const roster = [
      { id: 0, name: 'ME', gridIndex: 0, ship: 'COMET', catchphrase: null, portrait: '' },
      { id: 3, name: 'R3', gridIndex: 1, ship: 'COMET', catchphrase: 'Too slow!', portrait: '' },
    ];
    expect(winnerQuote([me(2), me(1, 'finished', 3)], roster, 0)).toEqual({ pilot: 'R3', text: 'Too slow!' });
    expect(winnerQuote([me(1), me(2, 'finished', 3)], roster, 0)).toBeNull();
  });
});

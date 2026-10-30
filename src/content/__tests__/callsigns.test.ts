import { describe, expect, it } from 'vitest';
import { PROFILE_NAME_MAX, cleanName } from '../../save/schema';
import { CALLSIGNS, randomCallsign } from '../callsigns';

describe('randomCallsign', () => {
  it('every callsign is a valid profile name as generated', () => {
    for (const c of CALLSIGNS) {
      const longest = `${c}-99`;
      expect(longest.length).toBeLessThanOrEqual(PROFILE_NAME_MAX);
      expect(cleanName(longest)).toBe(longest);
    }
  });

  it('covers the whole list and number range, and rolls a different name when asked', () => {
    expect(randomCallsign(() => 0)).toBe(`${CALLSIGNS[0]}-10`);
    expect(randomCallsign(() => 0.9999)).toBe(`${CALLSIGNS[CALLSIGNS.length - 1]}-99`);
    let i = 0;
    const seq = [0, 0, 0, 0, 0.5, 0.5];
    const rolled = randomCallsign(() => seq[i++ % seq.length], `${CALLSIGNS[0]}-10`);
    expect(rolled).not.toBe(`${CALLSIGNS[0]}-10`);
  });
});

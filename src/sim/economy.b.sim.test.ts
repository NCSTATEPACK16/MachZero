/** Economy guard, part 2 (IMPLEMENTATION §M8d step 1; shared cases in economy.cases.ts): Ace on stock and a Mk II kit. */
import { describeEconomy } from './economy.cases';

// A stock ship is near the back on Ace (SPEC §4.4), and a Mk II kit is not yet enough to race the Ace rivals (they fit
// Mk III engines and boosters): measured 286 and 359 a race.
describeEconomy([
  { tier: 'ace', kit: 0, min: 0, max: 450 },
  { tier: 'ace', kit: 1, min: 250, max: 600 },
]);

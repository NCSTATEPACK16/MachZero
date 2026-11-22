/**
 * Economy guard, part 3 (IMPLEMENTATION §M8d step 1; shared cases in economy.cases.ts): Ace on a Mk III and a
 * Prototype kit, the kits a player races Ace on while saving for the Prototype kit (measured 706 and 970 a race).
 */
import { describeEconomy } from './economy.cases';

describeEconomy([
  { tier: 'ace', kit: 2, min: 550, max: 900 },
  { tier: 'ace', kit: 3, min: 750, max: 1150 },
]);

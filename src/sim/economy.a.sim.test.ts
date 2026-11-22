/** Economy guard, part 1 (IMPLEMENTATION §M8d step 1; shared cases in economy.cases.ts): Rookie, Pilot and Legend. */
import { describeEconomy, describeRookieFirstRace } from './economy.cases';

describeRookieFirstRace();
describeEconomy([
  { tier: 'pilot', kit: 0, min: 650, max: 1000 },
  { tier: 'legend', kit: 0, min: 0, max: 400 },
]);

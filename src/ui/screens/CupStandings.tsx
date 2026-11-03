/**
 * Cup standings between Grand Prix races (and after the last): the points table with each racer's movement
 * since the race before, the next world, the Garage, and QUIT CUP. Back (Ⓑ) goes to the menu; the cup stays
 * saved and the menu offers CONTINUE CUP.
 */
import type { App } from '../../app/App';
import { RIVALS } from '../../content/pilots';
import { worldById } from '../../content/worlds';
import { GP_RACES, cupStandings, cupWorld, racesDone, type CupStanding, type CupState } from '../../game/modes/GrandPrix';
import { Screen } from '../components';
import { QuitCup, TIER_NAMES, Trophies } from './GrandPrix';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'ST' : n % 10 === 2 && n !== 12 ? 'ND' : n % 10 === 3 && n !== 13 ? 'RD' : 'TH'}`;

function Table({ cup, playerName }: { cup: CupState; playerName: string }) {
  const rows = cupStandings(cup);
  const name = (r: CupStanding) => (r.id === 0 ? playerName : (RIVALS[r.id - 1]?.name ?? `RIVAL ${r.id}`));
  const played = racesDone(cup) > 0;
  return (
    <div class="mzu-cup-table" role="table" aria-label="Cup standings">
      <div class="mzu-cup-row head" role="row">
        <span role="columnheader">POS</span>
        <span role="columnheader" aria-label="Movement" />
        <span role="columnheader">PILOT</span>
        <span role="columnheader">LAST</span>
        <span role="columnheader">PTS</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} class={`mzu-cup-row${r.id === 0 ? ' me' : ''}`} role="row" data-ship={r.id}>
          <span role="cell" class="pos">
            {r.rank}
          </span>
          <span role="cell" class={`move${r.moved > 0 ? ' up' : r.moved < 0 ? ' down' : ''}`} aria-label={r.moved ? `${r.moved > 0 ? 'up' : 'down'} ${Math.abs(r.moved)}` : 'no change'}>
            {r.moved > 0 ? `▲${r.moved}` : r.moved < 0 ? `▼${-r.moved}` : '–'}
          </span>
          <span role="cell" class="name">
            {name(r)}
          </span>
          <span role="cell" class="last">
            {played ? `+${r.last}` : ''}
          </span>
          <span role="cell" class="pts">
            {r.points}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CupStandings({ app }: { app: App }) {
  const p = app.activeProfile.value;
  const cup = p?.cup ?? null;
  const final = !cup ? app.lastCup.value : null;
  const toMenu = () => (app.route.value = { name: 'menu' });
  if (!p || (!cup && !final)) {
    return (
      <Screen id="cup" title="GRAND PRIX" kicker="NO CUP IN PROGRESS" onBack={toMenu} backLabel="MENU">
        <button type="button" class="mzu-chip go" data-autofocus onClick={() => app.openGrandPrix()}>
          GRAND PRIX
        </button>
      </Screen>
    );
  }
  if (final) {
    const { award } = final;
    return (
      <Screen id="cup" title={award.position === 1 ? 'CUP WON' : 'CUP COMPLETE'} kicker={`${TIER_NAMES[final.cup.tier]} CUP · FINAL STANDINGS`} onBack={toMenu} backLabel="MENU" wide>
        <div class="mzu-cup" data-cup-final={award.position}>
          <Table cup={final.cup} playerName={p.name} />
          <div class="mzu-cup-side">
            {award.trophy ? (
              <>
                <p class="mzu-lead gold">You won the {TIER_NAMES[award.trophy]} cup!</p>
                <p class="mzu-note">+{award.bonus.toLocaleString('en-US')} credits cup bonus.</p>
              </>
            ) : (
              <p class="mzu-lead">You finished the cup {ordinal(award.position).toLowerCase()}.</p>
            )}
            <Trophies won={p.trophies} />
            <div class="mzu-actions">
              <button type="button" class="mzu-chip go" data-autofocus onClick={toMenu}>
                DONE
              </button>
              <button type="button" class="mzu-chip" onClick={() => app.openGrandPrix()}>
                GRAND PRIX
              </button>
            </div>
          </div>
        </div>
      </Screen>
    );
  }
  const live = cup!;
  const done = racesDone(live);
  const next = worldById(cupWorld(live) ?? '');
  return (
    <Screen id="cup" title="CUP STANDINGS" kicker={`${TIER_NAMES[live.tier]} CUP · ${done === 0 ? 'NO RACES YET' : `AFTER RACE ${done} OF ${GP_RACES}`}`} onBack={toMenu} backLabel="MENU" wide>
      <div class="mzu-cup" data-cup-done={done}>
        <Table cup={live} playerName={p.name} />
        <div class="mzu-cup-side">
          <div class="mzu-kicker">
            RACE {done + 1} OF {GP_RACES}
          </div>
          <p class="mzu-lead">{next?.name ?? ''}</p>
          <p class="mzu-note">{done === 0 ? 'Your normal grid slot for the difficulty.' : 'Reverse grid: the cup leader starts last.'}</p>
          <div class="mzu-actions vertical">
            <button type="button" class="mzu-chip go" data-autofocus data-cup-next onClick={() => void app.startCupRace()}>
              NEXT RACE
            </button>
            {app.features.garage ? (
              <button type="button" class="mzu-chip" data-cup-garage onClick={() => app.openGarage('cup')}>
                GARAGE · {p.credits.toLocaleString('en-US')} CR
              </button>
            ) : null}
            <QuitCup app={app} />
          </div>
        </div>
      </div>
    </Screen>
  );
}

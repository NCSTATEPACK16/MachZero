/**
 * Cup standings between Grand Prix races (and after the last): the points table with each racer's movement
 * since the race before, the next world, the Garage, and QUIT CUP. Back (Ⓑ) goes to the menu; the cup stays
 * saved and the menu offers CONTINUE CUP.
 */
import { useEffect, useState } from 'preact/hooks';
import type { App } from '../../app/App';
import type { Loadout } from '../../core/contracts';
import { RIVALS, buildRaceField } from '../../content/pilots';
import { seasonStandings } from '../../game/modes/Championship';
import { rosterOf } from '../../game/pilotPortrait';
import type { SeasonState } from '../../save/schema';
import { worldById } from '../../content/worlds';
import { cupById } from '../../content/cups';
import { cupRaces, cupStandings, cupWorld, racesDone, trophiesOf, type CupStanding, type CupState } from '../../game/modes/GrandPrix';
import { Screen } from '../components';
import { Crowns, QuitCup, QuitSeason, TIER_NAMES, Trophies } from './GrandPrix';

/** "NEON CUP · PILOT": which cup, and the CPU tier it runs at. */
const cupTitle = (cup: CupState) => `${cupById(cup.cupId)?.name ?? 'CUP'} · ${TIER_NAMES[cup.tier]}`;

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

/** The season table (IMPLEMENTATION §M8c): rank, portrait, name, points and cups won, over the cups done. */
function SeasonTable({ season, playerName, loadout }: { season: SeasonState; playerName: string; loadout: Loadout }) {
  const rows = seasonStandings(season.done);
  // Portraits: the player in their livery, the rivals in theirs (constant recipe markup).
  const roster = rosterOf(buildRaceField({ playerName, playerLoadout: loadout, tier: season.tier }));
  return (
    <div class="mzu-cup-table mzu-season-table" role="table" aria-label="Season standings" data-season-table={season.done.length}>
      <div class="mzu-cup-row head" role="row">
        <span role="columnheader">POS</span>
        <span role="columnheader" aria-label="Portrait" />
        <span role="columnheader">PILOT</span>
        <span role="columnheader">WINS</span>
        <span role="columnheader">PTS</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} class={`mzu-cup-row${r.id === 0 ? ' me' : ''}`} role="row" data-ship={r.id}>
          <span role="cell" class="pos">
            {r.rank}
          </span>
          <span role="cell" class="face" aria-hidden="true" dangerouslySetInnerHTML={{ __html: roster.find((x) => x.id === r.id)?.portrait ?? '' }} />
          <span role="cell" class="name">
            {r.id === 0 ? playerName : (RIVALS[r.id - 1]?.name ?? `RIVAL ${r.id}`)}
          </span>
          <span role="cell" class="last" aria-label={`${r.cupsWon} cups won`}>
            {r.cupsWon ? '🏆'.repeat(r.cupsWon) : '–'}
          </span>
          <span role="cell" class="pts">
            {r.points}
          </span>
        </div>
      ))}
    </div>
  );
}

/** After a season cup: the season table, then NEXT CUP, or at the season's end the champion card. */
function SeasonView({ app, playerName }: { app: App; playerName: string }) {
  const p = app.activeProfile.value!;
  const ended = !p.season ? app.lastSeason.value : null;
  const season = p.season ?? ended?.season ?? null;
  const champion = ended?.champion === 0;
  useEffect(() => {
    if (champion && ended) app.events.emit('results:champion', { tier: ended.season.tier });
  }, [champion]);
  if (!season) return null;
  const cups = app.seasonCups();
  const toMenu = () => (app.route.value = { name: 'menu' });
  const winner = ended && ended.champion !== null && ended.champion !== 0 ? (RIVALS[ended.champion - 1]?.name ?? 'A RIVAL') : null;
  return (
    <Screen id="cup" title={ended ? (champion ? 'CHAMPION' : 'SEASON OVER') : 'SEASON STANDINGS'} kicker={`SEASON · ${TIER_NAMES[season.tier]} · AFTER CUP ${season.done.length} OF ${cups.length}`} onBack={toMenu} backLabel="MENU" wide>
      <div class="mzu-cup" data-season-view={ended ? 'end' : 'between'}>
        <SeasonTable season={season} playerName={playerName} loadout={p.loadout} />
        <div class="mzu-cup-side">
          {ended ? (
            champion ? (
              <div class="mzu-champion" data-champion={season.tier}>
                <p class="mzu-lead gold">You are the {TIER_NAMES[season.tier]} champion!</p>
                {ended.bonus > 0 ? <p class="mzu-note">+{ended.bonus.toLocaleString('en-US')} credits champion bonus.</p> : <p class="mzu-note">You already held this crown: no bonus this time.</p>}
                <Crowns held={p.champion} />
              </div>
            ) : (
              <p class="mzu-lead">{winner} takes the championship. Try again!</p>
            )
          ) : (
            <>
              <div class="mzu-kicker">NEXT</div>
              <p class="mzu-lead">{cupById(p.cup?.cupId ?? '')?.name ?? ''}</p>
            </>
          )}
          <div class="mzu-actions vertical">
            {ended ? (
              <button type="button" class="mzu-chip go" data-autofocus data-season-done onClick={toMenu}>
                DONE
              </button>
            ) : (
              <>
                <button type="button" class="mzu-chip go" data-autofocus data-season-next onClick={() => app.nextSeasonCup()}>
                  NEXT CUP
                </button>
                <QuitSeason app={app} />
              </>
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}

export function CupStandings({ app }: { app: App }) {
  const p = app.activeProfile.value;
  const cup = p?.cup ?? null;
  // A season cup just finished: its final standings first, then the season table (local step), then the next cup.
  const final = !cup || app.seasonBreak.value ? app.lastCup.value : null;
  const [seasonStep, setSeasonStep] = useState(false);
  const inSeason = app.seasonBreak.value && (p?.season != null || app.lastSeason.value != null);
  if (p && final && inSeason && seasonStep) return <SeasonView app={app} playerName={p.name} />;
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
      <Screen id="cup" title={award.position === 1 ? 'CUP WON' : 'CUP COMPLETE'} kicker={`${cupTitle(final.cup)} · FINAL STANDINGS`} onBack={toMenu} backLabel="MENU" wide>
        <div class="mzu-cup" data-cup-final={award.position}>
          <Table cup={final.cup} playerName={p.name} />
          <div class="mzu-cup-side">
            {award.trophy ? (
              <>
                <p class="mzu-lead gold">
                  You won the {cupById(final.cup.cupId)?.name ?? 'cup'} on {TIER_NAMES[award.trophy]}!
                </p>
                <p class="mzu-note">+{award.bonus.toLocaleString('en-US')} credits cup bonus.</p>
              </>
            ) : (
              <p class="mzu-lead">You finished the cup {ordinal(award.position).toLowerCase()}.</p>
            )}
            <Trophies won={trophiesOf(p.trophies, final.cup.cupId)} />
            <div class="mzu-actions">
              {inSeason ? (
                <button type="button" class="mzu-chip go" data-autofocus data-season-table-open onClick={() => setSeasonStep(true)}>
                  SEASON TABLE
                </button>
              ) : (
                <>
                  <button type="button" class="mzu-chip go" data-autofocus onClick={toMenu}>
                    DONE
                  </button>
                  <button type="button" class="mzu-chip" onClick={() => app.openGrandPrix()}>
                    GRAND PRIX
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Screen>
    );
  }
  const live = cup!;
  const done = racesDone(live);
  const next = worldById(cupWorld(live) ?? '');
  const season = p.season;
  const seasonTag = season ? `SEASON · CUP ${season.done.length + 1} OF ${app.seasonCups().length} · ` : '';
  return (
    <Screen id="cup" title="CUP STANDINGS" kicker={`${seasonTag}${cupTitle(live)} · ${done === 0 ? 'NO RACES YET' : `AFTER RACE ${done} OF ${cupRaces(live)}`}`} onBack={toMenu} backLabel="MENU" wide>
      <div class="mzu-cup" data-cup-done={done}>
        <Table cup={live} playerName={p.name} />
        <div class="mzu-cup-side">
          <div class="mzu-kicker">
            RACE {done + 1} OF {cupRaces(live)}
          </div>
          <p class="mzu-lead">{next?.name ?? ''}</p>
          <p class="mzu-note">{done === 0 ? 'Your normal grid slot for the difficulty.' : 'Reverse grid: the cup leader starts last.'}</p>
          <div class="mzu-actions vertical">
            <button type="button" class="mzu-chip go" data-autofocus data-cup-next onClick={() => void app.startCupRace()}>
              NEXT RACE
            </button>
            <button type="button" class="mzu-chip" data-cup-garage onClick={() => app.openGarage('cup')}>
              GARAGE · {p.credits.toLocaleString('en-US')} CR
            </button>
            {season ? <QuitSeason app={app} /> : <QuitCup app={app} />}
          </div>
        </div>
      </div>
    </Screen>
  );
}

/**
 * Grand Prix (IMPLEMENTATION §GP and §X1): the cups that can be played, each with its five worlds and the
 * trophies won per CPU tier, and START CUP (or, with a cup in progress, CONTINUE CUP and QUIT CUP). A cup
 * runs at the profile's CPU difficulty. With one cup available the screen shows that cup alone.
 */
import { useState } from 'preact/hooks';
import type { App } from '../../app/App';
import type { AITier } from '../../core/contracts';
import { availableCups, cupById, cupUnlocked, type CupDef } from '../../content/cups';
import { GP_POINTS, cupBonus, cupRaces, racesDone, trophiesOf } from '../../game/modes/GrandPrix';
import { championBonus, seasonCup } from '../../game/modes/Championship';
import { TierPicker } from './WorldSelect';
import { worldById, worldsFor } from '../../content/worlds';
import { AI_TIERS } from '../../save/schema';
import { Screen } from '../components';

export const TIER_NAMES: Readonly<Record<AITier, string>> = { rookie: 'ROOKIE', pilot: 'PILOT', ace: 'ACE', legend: 'LEGEND' };

/** One trophy per tier for one cup: won ones lit. `cup` names the cup for screen readers and tooltips. */
export function Trophies({ won, small, cup = 'CUP' }: { won: readonly AITier[]; small?: boolean; cup?: string }) {
  return (
    <span class={`mzu-trophies${small ? ' small' : ''}`} aria-label={won.length ? `${cup} trophies: ${won.map((t) => TIER_NAMES[t]).join(', ')}` : `No ${cup} trophies yet`}>
      {AI_TIERS.map((t) => (
        <span key={t} class={`mzu-trophy${won.includes(t) ? ' won' : ''}`} data-tier={t} title={`${cup} · ${TIER_NAMES[t]}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4 H17 V9 a5 5 0 0 1 -10 0 Z M7 6 H4 a3 3 0 0 0 3 4 M17 6 H20 a3 3 0 0 1 -3 4 M12 14 V17 M8 20 H16 L15 17 H9 Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
          </svg>
          {small ? null : <span class="mzu-trophy-name">{TIER_NAMES[t]}</span>}
        </span>
      ))}
    </span>
  );
}

/** A small padlock (locked cups and worlds). */
export function Padlock({ class: cls = 'mzu-padlock' }: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" class={cls} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="1.5" fill="currentColor" />
      <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" fill="none" stroke="currentColor" stroke-width="2.2" />
    </svg>
  );
}

/** The Champion trophies (IMPLEMENTATION §M8c): a crown per tier, lit when held, with the tier's initial. */
export function Crowns({ held, small }: { held: readonly AITier[]; small?: boolean }) {
  return (
    <span class={`mzu-crowns${small ? ' small' : ''}`} aria-label={held.length ? `Champion: ${held.map((t) => TIER_NAMES[t]).join(', ')}` : 'No championship won yet'}>
      {AI_TIERS.map((t) => (
        <span key={t} class={`mzu-crown${held.includes(t) ? ' won' : ''}`} data-tier={t} title={`CHAMPION · ${TIER_NAMES[t]}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M3 18 L5 7 L9.5 12 L12 5 L14.5 12 L19 7 L21 18 Z" fill="currentColor" />
          </svg>
          <span class="mzu-crown-tier">{TIER_NAMES[t][0]}</span>
        </span>
      ))}
    </span>
  );
}

/** Abandon the season in progress, after a confirmation. */
export function QuitSeason({ app }: { app: App }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" class="mzu-chip danger" data-quit-season onClick={() => setAsking(true)}>
        QUIT SEASON
      </button>
    );
  }
  return (
    <span class="mzu-confirm" role="group" aria-label="Quit the season?">
      <span class="mzu-confirm-q">QUIT THE SEASON? ITS POINTS ARE LOST; CREDITS AND TROPHIES STAY.</span>
      <button type="button" class="mzu-chip danger" data-autofocus data-quit-yes onClick={() => app.quitSeason()}>
        YES, QUIT
      </button>
      <button type="button" class="mzu-chip" onClick={() => setAsking(false)}>
        KEEP RACING
      </button>
    </span>
  );
}

/** The CHAMPIONSHIP card (IMPLEMENTATION §M8c): every cup in order at one tier. */
function Championship({ app, cups }: { app: App; cups: readonly CupDef[] }) {
  const p = app.activeProfile.value;
  if (!p) return null;
  const season = p.season;
  const tier = season?.tier ?? p.aiTier;
  const current = season ? seasonCup(season, cups) : null;
  const bonus = championBonus(tier, p.champion);
  return (
    <div class="mzu-gp mzu-season-card" data-championship>
      <ol class="mzu-gp-tracks">
        {cups.map((c, i) => {
          const done = season?.done.some((d) => d.cupId === c.id) ?? false;
          const now = current?.id === c.id;
          return (
            <li key={c.id} class={done ? 'done' : now ? 'next' : ''} data-season-cup={c.id}>
              <span class="mzu-gp-num">{i + 1}</span>
              <span class="mzu-gp-name">{c.name}</span>
              <span class="mzu-gp-state">{done ? 'DONE' : now && p.cup ? `RACE ${racesDone(p.cup) + 1} OF ${cupRaces(p.cup)}` : `${c.worlds.length} RACES`}</span>
            </li>
          );
        })}
      </ol>
      <div class="mzu-gp-side">
        <p class="mzu-lead">Every cup, back to back, at one difficulty. Cup points add up over the season.</p>
        <p class="mzu-note">
          {bonus > 0 ? `Win the season for the ${TIER_NAMES[tier]} Champion trophy and +${bonus.toLocaleString('en-US')} credits.` : `You are already ${TIER_NAMES[tier]} champion: a season win pays no more.`} Each cup still pays its own bonus and trophy.
        </p>
        <div class="mzu-gp-trophies">
          <div class="mzu-kicker">CHAMPION TROPHIES</div>
          <Crowns held={p.champion} />
        </div>
        {!season && !p.cup && app.seasonOpen ? <TierPicker app={app} /> : null}
        <div class="mzu-actions">
          {season ? (
            <>
              <button type="button" class="mzu-chip go" data-autofocus data-season-continue onClick={() => app.openCupStandings()}>
                CONTINUE SEASON · CUP {season.done.length + 1} OF {cups.length}
              </button>
              <QuitSeason app={app} />
            </>
          ) : p.cup ? (
            <p class="mzu-gp-locked" role="note">
              FINISH OR QUIT THE {cupById(p.cup.cupId)?.name ?? 'CUP'} FIRST
            </p>
          ) : !app.seasonOpen ? (
            <p class="mzu-gp-locked" data-season-locked role="note">
              <Padlock />
              WIN EVERY CUP TO UNLOCK
            </p>
          ) : (
            <button type="button" class="mzu-chip go" data-autofocus data-season-start onClick={() => app.startSeason()}>
              START CHAMPIONSHIP · {TIER_NAMES[tier]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Quit the cup in progress, after a confirmation (two buttons in place of one). */
export function QuitCup({ app }: { app: App }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" class="mzu-chip danger" data-quit-cup onClick={() => setAsking(true)}>
        QUIT CUP
      </button>
    );
  }
  return (
    <span class="mzu-confirm" role="group" aria-label="Quit the cup?">
      <span class="mzu-confirm-q">QUIT THE CUP? ITS POINTS ARE LOST.</span>
      <button type="button" class="mzu-chip danger" data-autofocus data-quit-yes onClick={() => app.quitCup()}>
        YES, QUIT
      </button>
      <button type="button" class="mzu-chip" onClick={() => setAsking(false)}>
        KEEP RACING
      </button>
    </span>
  );
}

export function GrandPrix({ app }: { app: App }) {
  const p = app.activeProfile.value;
  const cup = p?.cup ?? null;
  // A cup with a world behind the `expansion` flag stays hidden while that flag is off.
  const cups = availableCups(worldsFor(app.features));
  // The championship (M8c, with `modes`) needs two cups or more; a season in progress shows it first.
  const champTab = app.features.modes && cups.length >= 2;
  const season = champTab ? (p?.season ?? null) : null;
  // The cup in progress is always the one shown; otherwise the last one picked here.
  const [picked, setPicked] = useState(season ? 'championship' : (cups[0]?.id ?? ''));
  const showSeason = champTab && (season !== null || (picked === 'championship' && !cup));
  const def: CupDef | undefined = (cup ? cupById(cup.cupId) : cupById(picked)) ?? cups[0];
  const tier = cup?.tier ?? p?.aiTier ?? 'rookie';
  const done = cup ? racesDone(cup) : 0;
  // With `modes` on a cup opens once its World Tour world is cleared (IMPLEMENTATION §M8a).
  const locked = !cup && !!def && !!p && !cupUnlocked(def, p, app.features.modes);
  if (!def) {
    return (
      <Screen id="gp" title="GRAND PRIX" kicker="NO CUPS YET" onBack={() => (app.route.value = { name: 'menu' })} backLabel="MENU">
        <p class="mzu-note">No cup can be played yet.</p>
      </Screen>
    );
  }
  const kicker = showSeason ? `${cups.length} CUPS · ${cups.reduce((n, c) => n + c.worlds.length, 0)} RACES · ${TIER_NAMES[season?.tier ?? p?.aiTier ?? 'rookie']} RIVALS` : `${def.worlds.length} RACES · ${TIER_NAMES[tier]} RIVALS · POINTS ${GP_POINTS.join('-')}`;
  return (
    <Screen id="gp" title="GRAND PRIX" kicker={kicker} onBack={() => (app.route.value = { name: 'menu' })} backLabel="MENU" wide>
      {cups.length > 1 ? (
        <div class="mzu-gp-cups" role="tablist" aria-label="Cups">
          {cups.map((c) => (
            <button key={c.id} type="button" role="tab" class="mzu-chip" aria-selected={!showSeason && c.id === def.id} disabled={(!!cup && c.id !== def.id) || season !== null} data-cup={c.id} onClick={() => setPicked(c.id)}>
              {p && !cupUnlocked(c, p, app.features.modes) ? <Padlock /> : null}
              {c.name}
            </button>
          ))}
          {champTab ? (
            <button type="button" role="tab" class="mzu-chip" aria-selected={showSeason} disabled={!!cup && season === null} data-cup="championship" onClick={() => setPicked('championship')}>
              {app.seasonOpen ? null : <Padlock />}
              CHAMPIONSHIP
            </button>
          ) : null}
        </div>
      ) : null}
      {showSeason ? <Championship app={app} cups={cups} /> : null}
      {showSeason ? null : (
      <div class={`mzu-gp${locked ? ' locked' : ''}`} data-cup-shown={def.id}>
        <ol class="mzu-gp-tracks">
          {def.worlds.map((id, i) => {
            const w = worldById(id);
            const state = i < done ? 'done' : i === done && cup ? 'next' : '';
            return (
              <li key={id} class={state} data-world={id} style={{ '--w-from': w?.ui.from, '--w-to': w?.ui.to } as Record<string, string>}>
                <span class="mzu-gp-num">{i + 1}</span>
                <span class="mzu-gp-name">{w?.name ?? id}</span>
                <span class="mzu-gp-state">{state === 'done' ? 'DONE' : state === 'next' ? 'NEXT' : ''}</span>
              </li>
            );
          })}
        </ol>
        <div class="mzu-gp-side">
          <p class="mzu-lead">
            {def.name}: {def.tagline.toLowerCase()}. The leader starts each race from the back.
          </p>
          <p class="mzu-note">
            Every race pays its credits. Win the cup for +{cupBonus(tier).toLocaleString('en-US')} credits and its {TIER_NAMES[tier]} trophy.
            {cup ? '' : ' Change the difficulty in Settings → Race.'} No restarts: retiring scores no points.
          </p>
          <div class="mzu-gp-trophies">
            <div class="mzu-kicker">{def.name} TROPHIES</div>
            <Trophies won={trophiesOf(p?.trophies ?? {}, def.id)} cup={def.name} />
          </div>
          <div class="mzu-actions">
            {cup ? (
              <>
                <button type="button" class="mzu-chip go" data-autofocus data-gp-continue onClick={() => app.openCupStandings()}>
                  CONTINUE CUP · RACE {done + 1}
                </button>
                <QuitCup app={app} />
              </>
            ) : locked ? (
              <p class="mzu-gp-locked" data-cup-locked role="note">
                <Padlock />
                CLEAR {worldById(def.requires)?.name ?? def.requires} TO UNLOCK
              </p>
            ) : (
              <button type="button" class="mzu-chip go" data-autofocus data-gp-start onClick={() => app.startCup(def.id)}>
                START {def.name} · {TIER_NAMES[tier]}
              </button>
            )}
          </div>
        </div>
      </div>
      )}
    </Screen>
  );
}

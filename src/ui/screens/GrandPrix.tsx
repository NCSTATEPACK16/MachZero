/**
 * Grand Prix (IMPLEMENTATION §GP and §X1): the cups that can be played, each with its five worlds and the
 * trophies won per CPU tier, and START CUP (or, with a cup in progress, CONTINUE CUP and QUIT CUP). A cup
 * runs at the profile's CPU difficulty. With one cup available the screen shows that cup alone.
 */
import { useState } from 'preact/hooks';
import type { App } from '../../app/App';
import type { AITier } from '../../core/contracts';
import { availableCups, cupById, type CupDef } from '../../content/cups';
import { GP_POINTS, cupBonus, racesDone, trophiesOf } from '../../game/modes/GrandPrix';
import { worldById } from '../../content/worlds';
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
  const cups = availableCups();
  // The cup in progress is always the one shown; otherwise the last one picked here.
  const [picked, setPicked] = useState(cups[0]?.id ?? '');
  const def: CupDef | undefined = (cup ? cupById(cup.cupId) : cupById(picked)) ?? cups[0];
  const tier = cup?.tier ?? p?.aiTier ?? 'rookie';
  const done = cup ? racesDone(cup) : 0;
  if (!def) {
    return (
      <Screen id="gp" title="GRAND PRIX" kicker="NO CUPS YET" onBack={() => (app.route.value = { name: 'menu' })} backLabel="MENU">
        <p class="mzu-note">No cup can be played yet.</p>
      </Screen>
    );
  }
  return (
    <Screen id="gp" title="GRAND PRIX" kicker={`${def.worlds.length} RACES · ${TIER_NAMES[tier]} RIVALS · POINTS ${GP_POINTS.join('-')}`} onBack={() => (app.route.value = { name: 'menu' })} backLabel="MENU" wide>
      {cups.length > 1 ? (
        <div class="mzu-gp-cups" role="tablist" aria-label="Cups">
          {cups.map((c) => (
            <button key={c.id} type="button" role="tab" class="mzu-chip" aria-selected={c.id === def.id} disabled={!!cup && c.id !== def.id} data-cup={c.id} onClick={() => setPicked(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      <div class="mzu-gp" data-cup-shown={def.id}>
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
            ) : (
              <button type="button" class="mzu-chip go" data-autofocus data-gp-start onClick={() => app.startCup(def.id)}>
                START {def.name} · {TIER_NAMES[tier]}
              </button>
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}

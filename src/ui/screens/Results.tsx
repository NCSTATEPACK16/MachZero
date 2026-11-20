/**
 * The results screen (IMPLEMENTATION §M8a step 6, feature `modes`): a menu screen in place of the HUD's results
 * panel. The standings on the left; on the right the credit tally line by line (0.35 s apart) with a counter that
 * runs up to the total, then any unlock and trophies, then the winner's quote. Any input shows everything at once,
 * and with reduced motion everything shows from the start.
 *
 * Buttons: NEXT WORLD (when one was just unlocked), RACE AGAIN, GARAGE, WORLD MAP; in a cup race STANDINGS only.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { App } from '../../app/App';
import { formatTime, ordinal } from '../../core/math';
import { TIERS } from '../../content/tiers';
import { worldById } from '../../content/worlds';
import type { RaceResult } from '../../game/modes/raceResult';
import { Screen } from '../components';
import { TierPips } from './WorldMap';

/** Seconds between tally lines. */
export const TALLY_STEP = 0.35;
/** The window event the UI root sends before a gamepad menu action (so the screen can treat it as "any input"). */
export const NAV_EVENT = 'mz-nav';

function heading(r: RaceResult): string {
  const me = r.standings.find((s) => s.id === r.playerId);
  if (!me) return 'RACE OVER';
  if (me.status === 'retired') return 'RETIRED';
  return me.position === 1 ? 'VICTORY' : `${ordinal(me.position).toUpperCase()} PLACE`;
}

function Standings({ r }: { r: RaceResult }) {
  return (
    <ol class="mzu-res-table" aria-label="Final standings">
      {r.standings.map((s) => {
        const entry = r.roster.find((x) => x.id === s.id);
        const time = s.status === 'finished' ? formatTime(s.totalTime) : s.status === 'retired' ? 'DNF' : s.totalTime !== null ? `~${formatTime(s.totalTime)}` : 'DNF';
        return (
          <li key={s.id} class={s.id === r.playerId ? 'me' : ''}>
            <span class="pos">{s.position}</span>
            {/* Constant recipe markup (game/pilotPortrait.ts), as the HUD draws it. */}
            {entry ? <span class="face" aria-hidden="true" dangerouslySetInnerHTML={{ __html: entry.portrait }} /> : null}
            <span class="name">{s.name}</span>
            <span class="tm">{time}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Results({ app }: { app: App }) {
  const r = app.lastResult.value;
  if (!r) {
    return (
      <Screen id="results" title="RESULTS" onBack={() => app.leaveResults({ name: 'tour' })} backLabel="MAP">
        <p class="mzu-note">No race to show.</p>
      </Screen>
    );
  }
  return <ResultsBody key={r.standings.map((s) => s.totalTime).join()} app={app} r={r} />;
}

function ResultsBody({ app, r }: { app: App; r: RaceResult }) {
  const n = r.tally.length;
  const total = r.tally.reduce((a, l) => a + l.amount, 0);
  const start = r.credits - total;
  const reduced = app.settings.reducedMotion.value;
  // `step` lines are shown; past n the counter has reached the total and the unlock, trophies and quote show.
  const [step, setStep] = useState(reduced ? n + 1 : 0);
  const done = step > n;
  const [counter, setCounter] = useState(reduced ? r.credits : start);
  const doneRef = useRef(done);
  doneRef.current = done;

  // The tally: one line every TALLY_STEP seconds, then the end.
  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setStep((s) => s + 1), (step === 0 ? 0.45 : TALLY_STEP) * 1000);
    return () => clearTimeout(id);
  }, [step, done]);

  // The counter runs up to what the shown lines add to.
  const target = done ? r.credits : start + r.tally.slice(0, step).reduce((a, l) => a + l.amount, 0);
  useEffect(() => {
    if (reduced || done) {
      setCounter(target);
      return;
    }
    const from = counter;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / (TALLY_STEP * 900));
      setCounter(Math.round(from + (target - from) * k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // Sound hooks (M6 plays them): each line, then the total, the unlock and each trophy.
  useEffect(() => {
    if (step >= 1 && step <= n && !reduced) app.events.emit('results:tally', { amount: r.tally[step - 1].amount });
  }, [step]);
  useEffect(() => {
    if (!done) return;
    app.events.emit('results:total', { credits: r.credits });
    if (r.unlocked) app.events.emit('results:unlock', { worldId: r.unlocked });
    for (const tier of r.newTrophies) app.events.emit('results:trophy', { tier });
  }, [done]);

  // Any input while the tally runs shows everything at once (and does nothing else). A layout effect, so it holds
  // from the screen's first frame.
  useLayoutEffect(() => {
    if (done) return;
    let swallowClick = false;
    const reveal = (e: Event) => {
      if (doneRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'pointerdown') swallowClick = true;
      setStep(n + 1);
    };
    const click = (e: Event) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', reveal, true);
    window.addEventListener('pointerdown', reveal, true);
    window.addEventListener('click', click, true);
    window.addEventListener(NAV_EVENT, reveal);
    return () => {
      window.removeEventListener('keydown', reveal, true);
      window.removeEventListener('pointerdown', reveal, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener(NAV_EVENT, reveal);
    };
  }, [done]);

  const world = worldById(r.worldId);
  const unlocked = r.unlocked ? worldById(r.unlocked) : undefined;
  const cup = r.mode === 'cup';
  const tierName = TIERS[r.tier].label;
  const onBack = cup ? () => app.resultsStandings() : () => app.leaveResults({ name: 'tour' });
  return (
    <Screen id="results" title={heading(r)} kicker={`${world?.name ?? ''} · ${tierName} RIVALS${cup ? ' · GRAND PRIX' : ''}`} onBack={onBack} backLabel={cup ? 'STANDINGS' : 'MAP'} wide>
      <div class={`mzu-res${done ? ' done' : ''}`} data-results-done={done ? '' : undefined}>
        <Standings r={r} />
        <div class="mzu-res-side">
          <ul class="mzu-res-tally" aria-label="Credits earned">
            {r.tally.slice(0, done ? n : step).map((l) => (
              <li key={l.label} data-tally={l.label}>
                <span>{l.label}</span>
                <span class="amt">+{l.amount.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
          <div class="mzu-res-total" aria-live="polite">
            <span>CREDITS</span>
            <span class="amt" data-credits={done ? r.credits : undefined}>
              {counter.toLocaleString('en-US')}
            </span>
          </div>
          {done && unlocked ? (
            <div class="mzu-res-unlock" data-unlocked={unlocked.id} style={{ '--w-from': unlocked.ui.from, '--w-to': unlocked.ui.to } as Record<string, string>}>
              <span class="planet" aria-hidden="true">
                {unlocked.order}
              </span>
              <span>{unlocked.name} UNLOCKED</span>
            </div>
          ) : null}
          {done && r.newTrophies.length ? (
            <div class="mzu-res-trophies" data-new-trophies={r.newTrophies.join(',')}>
              <span class="mzu-kicker">{world?.name} TROPHIES</span>
              <TierPips held={r.newTrophies} label={world?.name ?? ''} />
            </div>
          ) : null}
          {done && r.quote ? (
            <p class="mzu-res-quote">
              “{r.quote.text}” — {r.quote.pilot}
            </p>
          ) : null}
          <div class="mzu-actions">
            {cup ? (
              <button type="button" class="mzu-chip go" data-autofocus data-res-standings onClick={() => app.resultsStandings()}>
                STANDINGS
              </button>
            ) : (
              <>
                {unlocked ? (
                  <button type="button" class="mzu-chip go" data-autofocus data-res-next onClick={() => app.resultsNextWorld()}>
                    NEXT WORLD
                  </button>
                ) : null}
                <button type="button" class={`mzu-chip${unlocked ? '' : ' go'}`} data-autofocus={unlocked ? undefined : ''} data-res-again onClick={() => app.raceAgain()}>
                  RACE AGAIN
                </button>
                <button type="button" class="mzu-chip" data-res-garage onClick={() => app.leaveResults({ name: 'garage', back: 'menu' })}>
                  GARAGE
                </button>
                <button type="button" class="mzu-chip" data-res-map onClick={() => app.leaveResults({ name: 'tour' })}>
                  WORLD MAP
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}

/**
 * The Time Trial screen (IMPLEMENTATION §M8b step 8; route `trial`, feature `modes`): one row per visible world
 * (its name, mini map, your best time and medal, and the three medal times). Picking an unlocked world starts a
 * trial on its track; a locked world's row says what opens it. Two toggles show or hide the ghosts.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { App } from '../../app/App';
import { formatTime } from '../../core/math';
import { DEV_TIMES } from '../../content/devTimes';
import { MEDAL_NAMES, medalTimes } from '../../game/modes/TimeTrial';
import { tourWorlds, worldUnlocked } from '../../game/modes/WorldTour';
import { MEDALS, emptyTour, type Medal } from '../../save/schema';
import { Screen, Toggle } from '../components';
import { focusFirst } from '../nav';
import { miniMap } from '../miniMap';
import { Padlock } from './GrandPrix';
import { lockLine } from './WorldMap';

/** A medal badge: its name's initial in the medal's colour (the name is in the label, so colour is not the only cue). */
export function MedalBadge({ medal, label }: { medal: Medal | null; label?: string }) {
  if (!medal) return <span class="mzu-medal none" aria-label={label ?? 'No medal yet'}>—</span>;
  return (
    <span class="mzu-medal" data-medal={medal} aria-label={label ?? `${MEDAL_NAMES[medal]} medal`}>
      {MEDAL_NAMES[medal][0]}
    </span>
  );
}

export function TimeTrial({ app }: { app: App }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = app.activeProfile.value;
  const tour = p?.tour ?? emptyTour();
  const worlds = tourWorlds(app.features);
  const ghosts = app.settings.ghosts.value;
  useLayoutEffect(() => {
    if (ref.current) focusFirst(ref.current);
  }, []);
  const medals = worlds.reduce((n, w) => n + (p?.records[w.trackId]?.medal ? MEDALS.indexOf(p.records[w.trackId].medal!) + 1 : 0), 0);
  return (
    <Screen id="trial" title="TIME TRIAL" kicker={`SOLO · 3 LAPS · ${medals} OF ${worlds.length * 3} MEDALS`} onBack={() => (app.route.value = { name: 'menu' })} backLabel="MENU" wide>
      <div ref={ref} class="mzu-trial">
        <ul class="mzu-trial-list" aria-label="Tracks">
          {worlds.map((w) => {
            const open = worldUnlocked(tour, w.id, worlds);
            const rec = p?.records[w.trackId];
            const dev = DEV_TIMES[w.trackId];
            const times = dev ? medalTimes(dev) : null;
            const map = miniMap(w.trackId);
            const style = { '--w-from': w.ui.from, '--w-to': w.ui.to } as Record<string, string>;
            const best = rec?.trialTime;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  class={`mzu-trial-row${open ? '' : ' locked'}`}
                  style={style}
                  data-trial-world={w.id}
                  data-locked={open ? undefined : ''}
                  data-autofocus={w.id === (p?.world ?? worlds[0].id) ? '' : undefined}
                  aria-label={`${w.name}. ${open ? `${best !== undefined ? `Best ${formatTime(best)}` : 'No time yet'}. ${rec?.medal ? `${MEDAL_NAMES[rec.medal]} medal` : 'No medal'}` : lockLine(worlds, w)}`}
                  onClick={() => (open ? void app.startTrial(w.id) : app.events.emit('ui:locked', {}))}
                >
                  <span class="mzu-world-num" aria-hidden="true">
                    {w.order}
                  </span>
                  <span class="mzu-trial-name">{w.name}</span>
                  {map && open ? (
                    <svg class="mzu-trial-map" viewBox="0 0 120 72" aria-hidden="true">
                      <polygon points={map} fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round" />
                    </svg>
                  ) : (
                    <span class="mzu-trial-map" aria-hidden="true" />
                  )}
                  {open ? (
                    <>
                      <span class="mzu-trial-best" data-best={best ?? undefined}>
                        <span class="mzu-kicker">BEST</span>
                        <span class="mzu-num">{best !== undefined ? formatTime(best) : '—'}</span>
                      </span>
                      <MedalBadge medal={rec?.medal ?? null} />
                      <span class="mzu-trial-times" aria-hidden="true">
                        {times
                          ? (['gold', 'silver', 'bronze'] as const).map((m) => (
                              <span key={m} class="mzu-trial-time">
                                <span class="mzu-medal small" data-medal={m}>
                                  {MEDAL_NAMES[m][0]}
                                </span>
                                {formatTime(times[m])}
                              </span>
                            ))
                          : null}
                      </span>
                    </>
                  ) : (
                    <span class="mzu-trial-locked">
                      <Padlock />
                      {lockLine(worlds, w)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div class="mzu-trial-toggles">
          <Toggle label="MY BEST GHOST" hint="Your fastest run on the track" value={ghosts.best} onChange={(v) => (app.settings.ghosts.value = { ...ghosts, best: v })} />
          <Toggle label="DEV GHOST" hint="The gold-medal pace setter" value={ghosts.dev} onChange={(v) => (app.settings.ghosts.value = { ...ghosts, dev: v })} />
        </div>
      </div>
    </Screen>
  );
}

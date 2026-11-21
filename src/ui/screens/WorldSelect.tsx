/**
 * World select (feature `worlds`): the five worlds in tour order. Built worlds race on click; the rest are
 * locked "coming soon" cards. Each card shows a mini map of its track, the gimmick and your best lap there.
 */
import type { App } from '../../app/App';
import { worldsFor, type WorldDef } from '../../content/worlds';
import { formatTime } from '../../core/math';
import { TIER_OPTIONS, TIERS } from '../../content/tiers';
import { Screen, Segmented } from '../components';
import { miniMap } from '../miniMap';

/** The CPU difficulty for the next race (SPEC §2: the AI dial), saved to the profile. */
export function TierPicker({ app }: { app: App }) {
  const p = app.activeProfile.value;
  if (!p) return null;
  return (
    <div class="mzu-section mzu-tier">
      <Segmented label="CPU DIFFICULTY" options={TIER_OPTIONS} value={p.aiTier} onChange={(v) => app.setAiTier(v)} />
      <p class="mzu-note">{TIERS[p.aiTier].hint}</p>
    </div>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 24 24" class="mzu-world-lock" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="1.5" fill="currentColor" />
      <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" fill="none" stroke="currentColor" stroke-width="2.2" />
    </svg>
  );
}

function WorldCard({ app, w, current }: { app: App; w: WorldDef; current: boolean }) {
  const best = app.activeProfile.value?.records[w.trackId]?.bestLap ?? null;
  const map = w.built ? miniMap(w.trackId) : null;
  const style = { '--w-from': w.ui.from, '--w-to': w.ui.to } as Record<string, string>;
  return (
    <button
      type="button"
      class={`mzu-world${w.built ? '' : ' locked'}${current ? ' current' : ''}`}
      style={style}
      disabled={!w.built}
      data-autofocus={current ? '' : undefined}
      data-world={w.id}
      aria-label={w.built ? `${w.name}. ${w.gimmick}. ${best ? `Best lap ${formatTime(best)}` : 'No lap yet'}` : `${w.name}, coming soon`}
      onClick={() => app.selectWorld(w.id)}
    >
      <span class="mzu-world-num" aria-hidden="true">
        {w.order}
      </span>
      <span class="mzu-world-art" aria-hidden="true">
        {map ? (
          <svg viewBox="0 0 120 72">
            <polygon points={map} fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round" />
          </svg>
        ) : (
          <Lock />
        )}
      </span>
      <span class="mzu-world-text">
        <span class="mzu-world-name">{w.name}</span>
        <span class="mzu-world-tag">{w.tagline}</span>
        <span class="mzu-world-chips">
          <span class="mzu-chip">{w.gimmick}</span>
          {w.built ? <span class="mzu-world-best">{best ? `BEST ${formatTime(best)}` : 'NO LAP YET'}</span> : <span class="mzu-world-best">COMING SOON</span>}
        </span>
      </span>
    </button>
  );
}

export function WorldSelect({ app }: { app: App }) {
  const current = app.currentWorld?.id;
  return (
    <Screen id="worlds" title="WORLDS" kicker="PICK A WORLD · 3 LAPS · 7 RIVALS" onBack={() => (app.route.value = { name: 'menu' })} backLabel="MENU" wide>
      <TierPicker app={app} />
      <div class="mzu-worlds">
        {worldsFor(app.features).map((w) => (
          <WorldCard key={w.id} app={app} w={w} current={w.id === current} />
        ))}
      </div>
    </Screen>
  );
}

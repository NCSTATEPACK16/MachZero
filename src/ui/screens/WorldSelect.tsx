/**
 * World select (feature `worlds`): the five worlds in tour order. Built worlds race on click; the rest are
 * locked "coming soon" cards. Each card shows a mini map of its track, the gimmick and your best lap there.
 */
import type { App } from '../../app/App';
import { TRACK_DEFS } from '../../content/tracks';
import { WORLDS, type WorldDef } from '../../content/worlds';
import { formatTime } from '../../core/math';
import { Screen } from '../components';

/** Plan-view outline of a track definition as an SVG polyline in a 120 × 72 box. */
function miniMap(trackId: string): string | null {
  const def = TRACK_DEFS[trackId];
  if (!def) return null;
  const xs = def.points.map((p) => p[0]);
  const zs = def.points.map((p) => p[2]);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...zs) - minZ;
  const s = Math.min(112 / w, 64 / h);
  const ox = (120 - w * s) / 2;
  const oz = (72 - h * s) / 2;
  return def.points.map((p) => `${(ox + (p[0] - minX) * s).toFixed(1)},${(oz + (p[2] - minZ) * s).toFixed(1)}`).join(' ');
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
      <div class="mzu-worlds">
        {WORLDS.map((w) => (
          <WorldCard key={w.id} app={app} w={w} current={w.id === current} />
        ))}
      </div>
    </Screen>
  );
}

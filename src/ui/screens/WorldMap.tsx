/**
 * The world map (IMPLEMENTATION §M8a): World Tour is a starmap of the visible worlds, joined by a
 * path in tour order. Each planet shows its lock, its four tier trophies and the best lap. Picking a world opens
 * its card (a side panel, or a bottom sheet on a short screen): the tier picker and RACE, or for a locked world the
 * line that says what opens it.
 *
 * DOM and SVG only (no draw calls). The planets are HTML buttons laid over the SVG at the same coordinates, so
 * pad, keyboard and touch all reach them; left and right follow the chain (`data-nav-left/right`).
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { App } from '../../app/App';
import type { AITier } from '../../core/contracts';
import { formatTime } from '../../core/math';
import type { WorldDef, WorldId } from '../../content/worlds';
import { clearedCount, tourTrophies, tourWorlds, worldCleared, worldUnlocked } from '../../game/modes/WorldTour';
import { AI_TIERS, emptyTour } from '../../save/schema';
import { Screen } from '../components';
import { focusFirst } from '../nav';
import { miniMap } from '../miniMap';
import { Padlock, TIER_NAMES } from './GrandPrix';
import { TierPicker } from './TierPicker';
import { MedalBadge } from './TimeTrial';

/** Planet centres in the 1000 × 480 map, in tour order. */
export const PLANET_XY: ReadonlyArray<readonly [number, number]> = [
  [90, 330],
  [230, 170],
  [380, 300],
  [520, 130],
  [650, 310],
  [770, 150],
  [870, 300],
  [940, 110],
];
const MAP_W = 1000;
const MAP_H = 480;
const R = 34;
const R_PICKED = 42;

/** The four tier pips: filled for a held tier, in the tier's colour and with its initial (colour alone tells nothing). */
export function TierPips({ held, label }: { held: readonly AITier[]; label: string }) {
  return (
    <span class="mzu-pips" aria-label={held.length ? `${label} trophies: ${held.map((t) => TIER_NAMES[t]).join(', ')}` : `No ${label} trophies yet`}>
      {AI_TIERS.map((t) => (
        <span key={t} class={`mzu-pip${held.includes(t) ? ' won' : ''}`} data-tier={t} aria-hidden="true">
          {TIER_NAMES[t][0]}
        </span>
      ))}
    </span>
  );
}

export function lockLine(worlds: readonly WorldDef[], w: WorldDef): string {
  const i = worlds.indexOf(w);
  const prev = i > 0 ? worlds[i - 1] : null;
  return prev ? `FINISH TOP 3 ON ${prev.name} TO UNLOCK` : 'LOCKED';
}

function WorldCard({ app, w, worlds, onClose }: { app: App; w: WorldDef; worlds: readonly WorldDef[]; onClose: () => void }) {
  const p = app.activeProfile.value;
  const tour = p?.tour ?? emptyTour();
  const open = worldUnlocked(tour, w.id, worlds);
  const best = p?.records[w.trackId]?.bestLap ?? null;
  const map = miniMap(w.trackId);
  const style = { '--w-from': w.ui.from, '--w-to': w.ui.to } as Record<string, string>;
  return (
    <div class={`mzu-tour-card${open ? '' : ' locked'}`} style={style} role="dialog" aria-label={`${w.name} card`} data-world-card={w.id}>
      <div class="mzu-tour-card-head">
        <span class="mzu-world-num" aria-hidden="true">
          {w.order}
        </span>
        <div class="mzu-tour-card-titles">
          <div class="mzu-world-name">{w.name}</div>
          <div class="mzu-world-tag">{w.tagline}</div>
        </div>
        {map && open ? (
          <svg class="mzu-tour-card-map" viewBox="0 0 120 72" aria-hidden="true">
            <polygon points={map} fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round" />
          </svg>
        ) : null}
      </div>
      <div class="mzu-world-chips">
        <span class="mzu-chip">{w.gimmick}</span>
        {open ? <span class="mzu-world-best">{best ? `BEST LAP ${formatTime(best)}` : 'NO LAP YET'}</span> : null}
      </div>
      {open ? (
        <>
          <TierPips held={tourTrophies(tour, w.id)} label={w.name} />
          <TierPicker app={app} />
          <div class="mzu-actions">
            <button type="button" class="mzu-chip go" data-autofocus data-tour-race onClick={() => app.selectWorld(w.id)}>
              RACE {w.name}
            </button>
            <button type="button" class="mzu-chip" data-tour-trial onClick={() => void app.startTrial(w.id)}>
              TIME TRIAL
            </button>
            <button type="button" class="mzu-chip" data-tour-close onClick={onClose}>
              MAP
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="mzu-tour-locked" role="note">
            <Padlock />
            {lockLine(worlds, w)}
          </p>
          <div class="mzu-actions">
            <button type="button" class="mzu-chip" data-autofocus data-tour-close onClick={onClose}>
              MAP
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function WorldMap({ app }: { app: App }) {
  const p = app.activeProfile.value;
  const tour = p?.tour ?? emptyTour();
  const worlds = tourWorlds(app.features);
  const shown = worlds.slice(0, PLANET_XY.length);
  // The world card opens on entry when the results screen's NEXT WORLD asked for it.
  const [card, setCard] = useState<WorldId | null>(() => app.takeTourCard());
  const [focus, setFocus] = useState<WorldId>(() => card ?? (worlds.some((w) => w.id === p?.world) ? (p!.world as WorldId) : worlds[0].id));
  const mapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardWorld = card ? (shown.find((w) => w.id === card) ?? null) : null;

  // Focus follows the card: into it when it opens, back to its planet when it closes.
  useLayoutEffect(() => {
    if (cardWorld && cardRef.current) focusFirst(cardRef.current);
    else mapRef.current?.querySelector<HTMLElement>(`[data-planet="${focus}"]`)?.focus();
  }, [card]);

  const pick = (w: WorldDef) => {
    setFocus(w.id);
    setCard(w.id);
    if (!worldUnlocked(tour, w.id, worlds)) app.events.emit('ui:locked', {});
  };
  const close = () => setCard(null);
  // The last unlocked world: the path is bright up to it.
  let lastOpen = 0;
  shown.forEach((w, i) => {
    if (worldUnlocked(tour, w.id, worlds)) lastOpen = i;
  });
  const pts = shown.map((_, i) => PLANET_XY[i]);
  const line = (a: number, b: number) =>
    pts
      .slice(a, b + 1)
      .map(([x, y]) => `${x},${y}`)
      .join(' ');

  return (
    <Screen
      id="tour"
      title="WORLD TOUR"
      kicker={`${clearedCount(tour, worlds)} OF ${worlds.length} WORLDS CLEARED · TOP 3 OPENS THE NEXT WORLD`}
      onBack={() => (cardWorld ? close() : (app.route.value = { name: 'menu' }))}
      backLabel={cardWorld ? 'MAP' : 'MENU'}
      wide
    >
      <div class={`mzu-tour${cardWorld ? ' card-open' : ''}`}>
        <div ref={mapRef} class="mzu-tour-map" inert={cardWorld ? true : undefined} style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} aria-hidden="true" class="mzu-tour-svg">
            <defs>
              {shown.map((w) => (
                <linearGradient key={w.id} id={`mzu-planet-${w.id}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color={w.ui.from} />
                  <stop offset="1" stop-color={w.ui.to} />
                </linearGradient>
              ))}
            </defs>
            {pts.length > 1 ? <polyline class="mzu-tour-path" points={line(0, pts.length - 1)} /> : null}
            {lastOpen > 0 ? <polyline class="mzu-tour-path lit" points={line(0, lastOpen)} /> : null}
            {shown.map((w, i) => {
              const [x, y] = pts[i];
              const open = worldUnlocked(tour, w.id, worlds);
              const r = w.id === focus ? R_PICKED : R;
              return (
                <g key={w.id} class={`mzu-planet${open ? '' : ' locked'}${worldCleared(tour, w.id) ? ' cleared' : ''}`}>
                  {w.id === focus ? <circle cx={x} cy={y} r={r + 8} class="mzu-planet-ring" /> : null}
                  <circle cx={x} cy={y} r={r} fill={open ? `url(#mzu-planet-${w.id})` : '#3a3d4a'} class="mzu-planet-disc" />
                  {open ? (
                    <text x={x} y={y + 11} text-anchor="middle" class="mzu-planet-num">
                      {w.order}
                    </text>
                  ) : (
                    <g transform={`translate(${x - 14} ${y - 15}) scale(1.15)`} class="mzu-planet-lock">
                      <rect x="5" y="11" width="14" height="10" rx="1.5" fill="currentColor" />
                      <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" fill="none" stroke="currentColor" stroke-width="2.2" />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {shown.map((w, i) => {
            const [x, y] = pts[i];
            const open = worldUnlocked(tour, w.id, worlds);
            const best = open ? (p?.records[w.trackId]?.bestLap ?? null) : null;
            const prev = shown[i - 1];
            const next = shown[i + 1];
            return (
              <div key={w.id} class="mzu-planet-slot" style={{ left: `${(x / MAP_W) * 100}%`, top: `${(y / MAP_H) * 100}%` }}>
                <button
                  type="button"
                  class={`mzu-planet-btn${open ? '' : ' locked'}`}
                  data-planet={w.id}
                  data-locked={open ? undefined : ''}
                  data-autofocus={w.id === focus ? '' : undefined}
                  data-nav-left={prev ? `[data-planet="${prev.id}"]` : undefined}
                  data-nav-right={next ? `[data-planet="${next.id}"]` : undefined}
                  aria-label={`${w.order}. ${w.name}. ${open ? (worldCleared(tour, w.id) ? 'Cleared' : 'Open') : 'Locked'}${best ? `. Best lap ${formatTime(best)}` : ''}`}
                  onFocus={() => setFocus(w.id)}
                  onClick={() => pick(w)}
                />
                <span class="mzu-planet-label" aria-hidden="true">
                  <span class="mzu-planet-name">{w.name}</span>
                  {open ? <TierPips held={tourTrophies(tour, w.id)} label={w.name} /> : null}
                  {best ? <span class="mzu-planet-best">{formatTime(best)}</span> : null}
                  {open && p?.records[w.trackId]?.medal ? <MedalBadge medal={p.records[w.trackId].medal!} /> : null}
                </span>
              </div>
            );
          })}
        </div>
        {cardWorld ? (
          <div ref={cardRef} class="mzu-tour-sheet">
            <WorldCard app={app} w={cardWorld} worlds={worlds} onClose={close} />
          </div>
        ) : (
          <p class="mzu-tour-hint">PICK A WORLD</p>
        )}
      </div>
    </Screen>
  );
}

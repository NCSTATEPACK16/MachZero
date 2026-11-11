/** Main menu: race, the flag-gated 2.0 modes, settings and profile switching. */
import type { App } from '../../app/App';
import { MENU_PLACEHOLDERS } from '../../app/routes';
import { Badge } from '../badges';
import { MenuButton } from '../components';
import { chassisById } from '../../content/ships';
import { focusFirst, onUiKeyDown } from '../nav';
import { CUPS, cupById } from '../../content/cups';
import { cupRaces, cupWorld, racesDone, trophiesOf, trophyCount } from '../../game/modes/GrandPrix';
import { worldById } from '../../content/worlds';
import { TIER_NAMES, Trophies } from './GrandPrix';
import { useRef, useLayoutEffect } from 'preact/hooks';

const Icon = {
  race: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 17 L9 7 H15 L21 17 Z M8 14 H16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
  ),
  worlds: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M4 12 H20 M12 4 C8 8 8 16 12 20 C16 16 16 8 12 4" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  ),
  modes: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M12 13 L15 10 M10 3 H14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  ),
  cup: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4 H17 V9 a5 5 0 0 1 -10 0 Z M7 6 H4 a3 3 0 0 0 3 4 M17 6 H20 a3 3 0 0 1 -3 4 M12 14 V17 M8 20 H16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
  ),
  garage: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20 V10 L12 5 L20 10 V20 M8 20 V14 H16 V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7 H19 M5 12 H19 M5 17 H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <circle cx="9" cy="7" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="8" cy="17" r="2" fill="currentColor" />
    </svg>
  ),
} as const;

export function MainMenu({ app }: { app: App }) {
  const ref = useRef<HTMLElement>(null);
  // Layout effect: focus lands with the first paint, so keys pressed right away reach the screen (not <body>).
  useLayoutEffect(() => {
    if (ref.current) focusFirst(ref.current);
  }, []);
  const p = app.activeProfile.value;
  const cup = p?.cup ?? null;
  return (
    <section ref={ref} class="mzu-screen mzu-main" data-screen="menu" aria-label="Main menu" onKeyDown={(e) => ref.current && onUiKeyDown(ref.current, e)}>
      <div class="mzu-brand">
        <div class="mzu-logo">MACHZERO</div>
        <div class="mzu-tag">ANTI-GRAVITY RACING</div>
      </div>
      <div class="mzu-menu">
        {cup ? (
          <MenuButton
            big
            autofocus
            icon={Icon.cup}
            label="CONTINUE CUP"
            sub={`${cupById(cup.cupId)?.name ?? 'CUP'} · ${TIER_NAMES[cup.tier]} · RACE ${racesDone(cup) + 1} OF ${cupRaces(cup)} · ${worldById(cupWorld(cup) ?? '')?.name ?? ''}`}
            onClick={() => app.openCupStandings()}
          />
        ) : null}
        <MenuButton big={!cup} autofocus={!cup} icon={Icon.race} label="RACE" sub={`${app.raceLabel} · 3 LAPS · 7 RIVALS`} onClick={() => void app.startRace()} />
        {app.features.worlds ? <MenuButton icon={Icon.worlds} label="WORLDS" sub="Neon Bay, Sunset Mesa and more to come" onClick={() => app.openWorlds()} /> : null}
        {app.features.worlds && p && !cup ? <MenuButton icon={Icon.cup} label="GRAND PRIX" sub="Five races, every world, one cup" onClick={() => app.openGrandPrix()} /> : null}
        {MENU_PLACEHOLDERS.filter((m) => app.features[m.feature]).map((m) => (
          <MenuButton icon={Icon[m.feature as keyof typeof Icon]} label={m.title} sub={m.blurb} onClick={() => app.openSoon(m.feature, m.title)} />
        ))}
        {app.features.garage && p ? (
          <MenuButton icon={Icon.garage} label="GARAGE" sub={`${chassisById(p.loadout.chassisId).name} · ${p.credits.toLocaleString('en-US')} CREDITS`} onClick={() => app.openGarage()} />
        ) : null}
        <MenuButton icon={Icon.settings} label="SETTINGS" sub="Sound, comfort, controls, saves" onClick={() => app.openSettings('menu')} />
      </div>
      {p ? (
        <button type="button" class="mzu-pilot" onClick={() => app.showProfiles()} aria-label={`Pilot ${p.name}. Switch pilot`} data-back>
          <Badge index={p.badge} size={40} />
          <span class="mzu-pilot-text">
            <span class="mzu-pilot-name">{p.name}</span>
            <span class="mzu-pilot-sub">SWITCH PILOT</span>
          </span>
          {trophyCount(p.trophies) ? CUPS.filter((c) => trophiesOf(p.trophies, c.id).length).map((c) => <Trophies key={c.id} won={trophiesOf(p.trophies, c.id)} cup={c.name} small />) : null}
        </button>
      ) : null}
      <div class="mzu-hints" aria-hidden="true">
        <span>↑↓ MOVE</span>
        <span>ENTER / Ⓐ SELECT</span>
        <span>ESC / Ⓑ PILOTS</span>
      </div>
    </section>
  );
}

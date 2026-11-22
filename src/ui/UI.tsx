/**
 * Menu UI root (Preact). Renders the screen for the App's current route over the live 3D backdrop, plus
 * toasts. The in-race HUD stays v1 direct DOM (game/HUD).
 */
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { App } from '../app/App';
import { navigate } from './nav';
import { CupStandings } from './screens/CupStandings';
import { Garage } from './screens/Garage';
import { GrandPrix } from './screens/GrandPrix';
import { MainMenu } from './screens/MainMenu';
import { ProfileSelect } from './screens/ProfileSelect';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorldMap } from './screens/WorldMap';
import { TimeTrial } from './screens/TimeTrial';
import { NAV_EVENT, Results } from './screens/Results';
import './tokens.css';
import './ui.css';

function Loading() {
  return (
    <div class="mzu-loading" role="status" aria-live="polite">
      <div class="mzu-spinner" aria-hidden="true" />
      GET READY
    </div>
  );
}

function Toasts({ app }: { app: App }) {
  return (
    <div class="mzu-toasts" role="status" aria-live="polite">
      {app.toasts.value.map((t) => (
        <div key={t.id} class={`mzu-toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Root({ app }: { app: App }) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    app.navHandler = (action) => {
      // A screen may take a pad action for itself first (the results screen: any input shows the whole tally).
      if (!window.dispatchEvent(new Event(NAV_EVENT, { cancelable: true }))) return;
      const screen = layer.current?.querySelector<HTMLElement>('[data-screen]');
      if (screen) navigate(screen, action);
    };
    return () => {
      app.navHandler = null;
    };
  }, []);
  const r = app.route.value;
  let screen = null;
  if (r.name === 'profiles') screen = <ProfileSelect app={app} />;
  else if (r.name === 'menu') screen = <MainMenu app={app} />;
  else if (r.name === 'settings') screen = <SettingsScreen app={app} />;
  else if (r.name === 'garage') screen = <Garage app={app} />;
  else if (r.name === 'tour') screen = <WorldMap app={app} />;
  else if (r.name === 'results') screen = <Results app={app} />;
  else if (r.name === 'trial') screen = <TimeTrial app={app} />;
  else if (r.name === 'gp') screen = <GrandPrix app={app} />;
  else if (r.name === 'cup') screen = <CupStandings app={app} />;
  else if (r.name === 'loading') screen = <Loading />;
  return (
    <>
      <div ref={layer} class={`mzu-layer${screen ? ' on' : ''}${r.name === 'settings' && r.back === 'pause' ? ' over-race' : ''}${r.name === 'garage' ? ' bare' : ''}`}>
        {screen}
      </div>
      <Toasts app={app} />
    </>
  );
}

export function mountUI(root: HTMLElement, app: App): void {
  root.setAttribute('data-ui-root', '');
  render(<Root app={app} />, root);
}

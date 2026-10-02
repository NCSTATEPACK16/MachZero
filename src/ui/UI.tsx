/**
 * Menu UI root (Preact). Renders the screen for the App's current route over the live 3D backdrop, plus
 * toasts. The in-race HUD stays v1 direct DOM (game/HUD).
 */
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { App } from '../app/App';
import { MENU_PLACEHOLDERS } from '../app/routes';
import { Screen } from './components';
import { navigate } from './nav';
import { Garage } from './screens/Garage';
import { MainMenu } from './screens/MainMenu';
import { ProfileSelect } from './screens/ProfileSelect';
import { SettingsScreen } from './screens/SettingsScreen';
import './tokens.css';
import './ui.css';

function ComingSoon({ app }: { app: App }) {
  const r = app.route.value;
  const info = r.name === 'soon' ? MENU_PLACEHOLDERS.find((m) => m.feature === r.feature) : undefined;
  return (
    <Screen id={`soon-${r.name === 'soon' ? r.feature : ''}`} title={info?.title ?? 'COMING SOON'} kicker="COMING SOON" onBack={() => (app.route.value = { name: 'menu' })} backLabel="MENU">
      <p class="mzu-lead">{info?.blurb}</p>
      <p class="mzu-note">This part of MachZero 2.0 is still being built{info ? ` (milestone ${info.milestone})` : ''}.</p>
    </Screen>
  );
}

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
  else if (r.name === 'soon') screen = <ComingSoon app={app} />;
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

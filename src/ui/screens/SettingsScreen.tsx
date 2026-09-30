/** Settings: audio, comfort, controls (key rebinding) and save data. Every change applies live. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { App } from '../../app/App';
import type { KeyControl } from '../../core/contracts';
import { KEY_CONTROLS } from '../../save/schema';
import { Screen, Slider, Toggle, keyName } from '../components';

type Tab = 'audio' | 'comfort' | 'controls' | 'data';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'audio', label: 'SOUND' },
  { id: 'comfort', label: 'COMFORT' },
  { id: 'controls', label: 'CONTROLS' },
  { id: 'data', label: 'SAVES' },
];

const CONTROL_LABEL: Record<KeyControl, string> = {
  throttle: 'ACCELERATE',
  brake: 'BRAKE',
  left: 'STEER LEFT',
  right: 'STEER RIGHT',
  airLeft: 'AIR-BRAKE LEFT',
  airRight: 'AIR-BRAKE RIGHT',
  boost: 'BOOST',
};

const PAD_LAYOUT: ReadonlyArray<[string, string]> = [
  ['LEFT STICK', 'STEER'],
  ['RT / Ⓐ', 'ACCELERATE'],
  ['LT / Ⓑ', 'BRAKE'],
  ['LB  RB', 'AIR-BRAKES'],
  ['Ⓧ / Ⓨ', 'BOOST'],
  ['START', 'PAUSE'],
];

function Controls({ app }: { app: App }) {
  const s = app.settings;
  const [capture, setCapture] = useState<{ control: KeyControl; slot: number } | null>(null);
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return setCapture(null);
      if (!e.code) return;
      if (!s.bindKey(capture.control, capture.slot, e.code)) app.toast(`${keyName(e.code)} is reserved for menus. Pick another key.`, 'warn');
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capture]);
  const b = s.keyBindings.value;
  return (
    <div class="mzu-section">
      <div class="mzu-binds" role="table" aria-label="Keyboard controls">
        {KEY_CONTROLS.map((c) => (
          <div class="mzu-bind" role="row">
            <span class="mzu-bind-label" role="rowheader">
              {CONTROL_LABEL[c]}
            </span>
            <span class="mzu-bind-keys" role="cell">
              {[...b[c], null].slice(0, 3).map((code, slot) => {
                const listening = capture?.control === c && capture.slot === slot;
                return (
                  <button
                    type="button"
                    class={`mzu-key${code ? '' : ' add'}${listening ? ' listening' : ''}`}
                    aria-label={code ? `${CONTROL_LABEL[c]}: ${keyName(code)}. Change` : `Add a key for ${CONTROL_LABEL[c]}`}
                    onClick={() => setCapture(listening ? null : { control: c, slot })}
                  >
                    {listening ? 'PRESS A KEY…' : code ? keyName(code) : '+'}
                  </button>
                );
              })}
            </span>
          </div>
        ))}
      </div>
      <div class="mzu-actions">
        <button type="button" class="mzu-chip" onClick={() => (s.resetKeyBindings(), app.toast('Keyboard reset to the default layout.'))}>
          RESET KEYS
        </button>
      </div>
      <div class="mzu-subhead">GAMEPAD</div>
      <div class="mzu-padmap">
        {PAD_LAYOUT.map(([k, v]) => (
          <div>
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <p class="mzu-note">ESC / P pause · M mute · R restart are fixed.</p>
    </div>
  );
}

function Data({ app }: { app: App }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setError(app.importSave(await file.text()) ?? '');
  };
  const n = app.save.value.profiles.length;
  return (
    <div class="mzu-section">
      <p class="mzu-note">
        Saves stay in this browser ({n} profile{n === 1 ? '' : 's'}). Export a backup file to keep it safe or to move to another device.
      </p>
      <div class="mzu-actions">
        <button type="button" class="mzu-chip" onClick={() => app.exportSave()}>
          EXPORT SAVE
        </button>
        <button type="button" class="mzu-chip" onClick={() => fileRef.current?.click()}>
          IMPORT SAVE…
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} tabIndex={-1} />
      </div>
      {error ? (
        <p class="mzu-error" role="alert">
          {error}
        </p>
      ) : null}
      <p class="mzu-note dim">Importing replaces every profile on this device.</p>
    </div>
  );
}

export function SettingsScreen({ app }: { app: App }) {
  const [tab, setTab] = useState<Tab>('audio');
  const s = app.settings;
  const route = app.route.value;
  const fromPause = route.name === 'settings' && route.back === 'pause';
  return (
    <Screen id="settings" title="SETTINGS" kicker={fromPause ? 'PAUSED' : 'MACHZERO'} onBack={() => app.closeSettings()} backLabel={fromPause ? 'RACE' : 'MENU'} wide>
      <div class="mzu-tabs" role="tablist">
        {TABS.map((t) => (
          <button type="button" role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'audio' ? (
        <div class="mzu-section">
          <Slider label="MASTER" value={s.masterVolume.value} onChange={(v) => (s.masterVolume.value = v)} />
          <Slider label="EFFECTS" value={s.sfxVolume.value} onChange={(v) => (s.sfxVolume.value = v)} />
          {app.features.music ? <Slider label="MUSIC" value={s.musicVolume.value} onChange={(v) => (s.musicVolume.value = v)} /> : null}
          <Toggle label="MUTE" hint="Also M on the keyboard" value={s.muted.value} onChange={(v) => (s.muted.value = v)} />
        </div>
      ) : null}
      {tab === 'comfort' ? (
        <div class="mzu-section">
          <Toggle label="REDUCED MOTION" hint="No motion blur, camera shake, colour fringing or speed lines; a calmer field of view." value={s.reducedMotion.value} onChange={(v) => (s.reducedMotion.value = v)} />
          <Toggle label="COLOUR-BLIND-SAFE HUD" hint="Blue-to-orange energy bar with a warning marker." value={s.colorBlind.value} onChange={(v) => (s.colorBlind.value = v)} />
          <Toggle label="LARGE TEXT" hint="Bigger HUD and menus." value={s.largeText.value} onChange={(v) => (s.largeText.value = v)} />
        </div>
      ) : null}
      {tab === 'controls' ? <Controls app={app} /> : null}
      {tab === 'data' ? <Data app={app} /> : null}
    </Screen>
  );
}

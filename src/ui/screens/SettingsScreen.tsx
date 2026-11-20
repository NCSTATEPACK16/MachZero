/** Settings: race difficulty, audio, comfort, controls (key rebinding) and save data. Every change applies live. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { App } from '../../app/App';
import type { KeyControl } from '../../core/contracts';
import { TIER_OPTIONS, TIERS } from '../../content/tiers';
import { KEY_CONTROLS, NO_ASSISTS, ROOKIE_ASSISTS } from '../../save/schema';
import type { QualitySetting } from '../../save/schema';
import { Screen, Segmented, Slider, Toggle, keyName } from '../components';

type Tab = 'race' | 'assists' | 'audio' | 'graphics' | 'comfort' | 'controls' | 'data';
const TABS: ReadonlyArray<{ id: Tab; label: string; profile?: true }> = [
  { id: 'race', label: 'RACE' },
  { id: 'assists', label: 'ASSISTS', profile: true },
  { id: 'audio', label: 'SOUND' },
  { id: 'graphics', label: 'GRAPHICS' },
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
  item: 'USE ITEM',
  itemNext: 'NEXT ITEM',
};

const PAD_LAYOUT: ReadonlyArray<[string, string]> = [
  ['LEFT STICK', 'STEER'],
  ['RT / Ⓐ', 'ACCELERATE'],
  ['LT / Ⓑ', 'BRAKE'],
  ['LB  RB', 'AIR-BRAKES'],
  ['Ⓧ', 'BOOST'],
  ['Ⓨ', 'USE ITEM'],
  ['D-PAD ◀ ▶', 'PICK ITEM'],
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

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
/** Assist icons (SPEC §2: icon-first). */
const AssistIcon = {
  accel: svg('M5 19 L12 5 L19 19 M8.5 13 H15.5 M12 2 V5'),
  steer: svg('M12 3 A9 9 0 1 0 12.01 3 M12 9 A3 3 0 1 0 12.01 9 M3.5 10 L9 11 M15 11 L20.5 10 M12 15 V21'),
  noKO: svg('M12 3 L19 6 V11 C19 16 15.5 19.5 12 21 C8.5 19.5 5 16 5 11 V6 Z M9 12 L11 14 L15 10'),
  boost: svg('M13 2 L5 13 H11 L10 22 L19 10 H13 Z'),
};
const STEERING_OPTIONS: ReadonlyArray<{ value: '0' | '1' | '2'; label: string }> = [
  { value: '0', label: 'OFF' },
  { value: '1', label: 'LIGHT' },
  { value: '2', label: 'STRONG' },
];

/** Per-profile assists (IMPLEMENTATION §M7a). They act at once, mid-race too; they never cost anything. */
function AssistsTab({ app }: { app: App }) {
  const p = app.activeProfile.value;
  if (!p) return <p class="mzu-note">Pick a pilot to set the assists.</p>;
  const a = p.assists;
  return (
    <div class="mzu-section">
      <Toggle icon={AssistIcon.accel} label="AUTO-ACCELERATE" hint="The ship accelerates by itself. Hold the brake to slow down." value={a.autoAccelerate} onChange={(v) => app.setAssists({ autoAccelerate: v })} />
      <Segmented
        icon={AssistIcon.steer}
        label="STEERING HELP"
        hint="Guides you along the road and away from the rails. You stay in control."
        options={STEERING_OPTIONS}
        value={String(a.steering) as '0' | '1' | '2'}
        onChange={(v) => app.setAssists({ steering: Number(v) as 0 | 1 | 2 })}
      />
      <Toggle icon={AssistIcon.noKO} label="NO KNOCK-OUTS" hint="Half damage, and you can't explode. Hazards warn earlier and only slow you down (from the next race)." value={a.noKO} onChange={(v) => app.setAssists({ noKO: v })} />
      <Toggle icon={AssistIcon.boost} label="BOOST FROM LAP 1" hint="Your boost is ready when the lights go out, not on lap 2." value={a.earlyBoost} onChange={(v) => app.setAssists({ earlyBoost: v })} />
      <div class="mzu-actions">
        <button type="button" class="mzu-chip" onClick={() => (app.setAssists({ ...ROOKIE_ASSISTS }), app.toast('Rookie preset: every assist on.'))}>
          ROOKIE PRESET
        </button>
        <button type="button" class="mzu-chip" onClick={() => (app.setAssists({ ...NO_ASSISTS }), app.toast('Classic preset: every assist off.'))}>
          CLASSIC PRESET
        </button>
      </div>
      <p class="mzu-note dim">Assists never cost credits or trophies.</p>
    </div>
  );
}

function Race({ app }: { app: App }) {
  const p = app.activeProfile.value;
  if (!p) return <p class="mzu-note">Pick a pilot to set the difficulty.</p>;
  return (
    <div class="mzu-section">
      <Segmented label="CPU DIFFICULTY" options={TIER_OPTIONS} value={p.aiTier} onChange={(v) => app.setAiTier(v)} />
      <p class="mzu-note">{TIERS[p.aiTier].hint} Applies from the next race; also on the world select.</p>
    </div>
  );
}

const QUALITY_OPTIONS: ReadonlyArray<{ value: QualitySetting; label: string }> = [
  { value: 'auto', label: 'AUTO' },
  { value: 'low', label: 'LOW' },
  { value: 'med', label: 'MED' },
  { value: 'high', label: 'HIGH' },
];
const LEVEL_NAME = { low: 'LOW', med: 'MEDIUM', high: 'HIGH' } as const;

function Graphics({ app }: { app: App }) {
  const s = app.settings;
  const auto = s.quality.value === 'auto';
  const forced = app.flags.quality !== null;
  return (
    <div class="mzu-section">
      <Segmented label="QUALITY" options={QUALITY_OPTIONS} value={s.quality.value} onChange={(v) => (s.quality.value = v)} />
      <p class="mzu-note">
        {forced
          ? `Forced to ${LEVEL_NAME[app.qualityLevel.value]} by the page address.`
          : app.benchmarking.value
            ? 'Checking what this device can do…'
            : auto
              ? `Auto picked ${LEVEL_NAME[app.qualityLevel.value]} for this device.`
              : `Using ${LEVEL_NAME[app.qualityLevel.value]}.`}{' '}
        Lower quality runs smoother on phones and older computers: less blur, fewer buildings and particles, shorter view distance.
      </p>
      {auto && !forced ? (
        <div class="mzu-actions">
          <button type="button" class="mzu-chip" disabled={app.benchmarking.value} onClick={() => app.redetectQuality()}>
            CHECK AGAIN
          </button>
        </div>
      ) : null}
      <Toggle label="PERFORMANCE PANEL" hint="Frame times and missed frames in the corner, with a summary after each race." value={s.perfPanel.value} onChange={(v) => (s.perfPanel.value = v)} />
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
  const [tab, setTab] = useState<Tab>('race');
  const s = app.settings;
  const route = app.route.value;
  const fromPause = route.name === 'settings' && route.back === 'pause';
  return (
    <Screen id="settings" title="SETTINGS" kicker={fromPause ? 'PAUSED' : 'MACHZERO'} onBack={() => app.closeSettings()} backLabel={fromPause ? 'RACE' : 'MENU'} wide>
      <div class="mzu-tabs" role="tablist">
        {TABS.filter((t) => !t.profile || app.activeProfile.value).map((t) => (
          <button type="button" role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'race' ? <Race app={app} /> : null}
      {tab === 'assists' ? <AssistsTab app={app} /> : null}
      {tab === 'audio' ? (
        <div class="mzu-section">
          <Slider label="MASTER" value={s.masterVolume.value} onChange={(v) => (s.masterVolume.value = v)} />
          <Slider label="EFFECTS" value={s.sfxVolume.value} onChange={(v) => (s.sfxVolume.value = v)} />
          {app.features.music ? <Slider label="MUSIC" value={s.musicVolume.value} onChange={(v) => (s.musicVolume.value = v)} /> : null}
          <Toggle label="MUTE" hint="Also M on the keyboard" value={s.muted.value} onChange={(v) => (s.muted.value = v)} />
        </div>
      ) : null}
      {tab === 'graphics' ? <Graphics app={app} /> : null}
      {tab === 'comfort' ? (
        <div class="mzu-section">
          <Toggle label="REDUCED MOTION" hint="No motion blur, camera shake, colour fringing or speed lines; a calmer field of view." value={s.reducedMotion.value} onChange={(v) => (s.reducedMotion.value = v)} />
          <Toggle label="COLOUR-BLIND-SAFE HUD" hint="Blue-to-orange energy bar with a warning marker." value={s.colorBlind.value} onChange={(v) => (s.colorBlind.value = v)} />
          <Toggle label="LARGE TEXT" hint="Bigger HUD and menus." value={s.hudSize.value !== 'normal'} onChange={(v) => (s.hudSize.value = v ? 'large' : 'normal')} />
        </div>
      ) : null}
      {tab === 'controls' ? <Controls app={app} /> : null}
      {tab === 'data' ? <Data app={app} /> : null}
    </Screen>
  );
}

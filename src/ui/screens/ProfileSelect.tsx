/** Who's racing? Pick a profile, create one (name, badge, experience preset) or delete one. */
import { useState } from 'preact/hooks';
import type { App } from '../../app/App';
import { BADGE_COUNT, PROFILE_NAME_MAX, cleanName, type Profile, type ProfilePreset } from '../../save/schema';
import { BADGE_NAMES, Badge } from '../badges';
import { Screen } from '../components';

function ProfileCard({ p, onPick, onDelete }: { p: Profile; onPick: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const assisted = p.assists.autoAccelerate || p.assists.steering > 0 || p.assists.noKO;
  const best = p.records.classic?.bestLap;
  if (confirm) {
    return (
      <div class="mzu-card confirm" role="group" aria-label={`Delete ${p.name}?`}>
        <div class="mzu-card-q">
          DELETE <b>{p.name}</b>?<small>Their records and progress are removed.</small>
        </div>
        <div class="mzu-card-actions">
          <button type="button" class="mzu-chip danger" data-autofocus onClick={onDelete}>
            DELETE
          </button>
          <button type="button" class="mzu-chip" onClick={() => setConfirm(false)}>
            KEEP
          </button>
        </div>
      </div>
    );
  }
  return (
    <div class="mzu-card">
      <button type="button" class="mzu-card-main" onClick={onPick}>
        <Badge index={p.badge} size={56} />
        <span class="mzu-card-text">
          <span class="mzu-card-name">{p.name}</span>
          <span class="mzu-card-meta">
            {assisted ? 'ROOKIE ASSISTS' : 'NO ASSISTS'} · {p.stats.wins} WIN{p.stats.wins === 1 ? '' : 'S'}
            {best ? ` · BEST ${best.toFixed(2)}s` : ''}
          </span>
        </span>
      </button>
      <button type="button" class="mzu-card-del" aria-label={`Delete ${p.name}`} onClick={() => setConfirm(true)}>
        ✕
      </button>
    </div>
  );
}

function CreateForm({ app, onCancel }: { app: App; onCancel: (() => void) | null }) {
  const [name, setName] = useState('');
  const [badge, setBadge] = useState(Math.floor(Math.random() * BADGE_COUNT));
  const [preset, setPreset] = useState<ProfilePreset | null>(null);
  const [error, setError] = useState('');
  const submit = (e?: Event) => {
    e?.preventDefault();
    if (!cleanName(name)) return setError('Type a name first.');
    if (!preset) return setError('Pick how much racing you’ve done.');
    app.createProfile(name, badge, preset);
  };
  return (
    <Screen id="create" title="NEW PILOT" kicker="WHO'S RACING?" onBack={onCancel ?? undefined}>
      <form class="mzu-create" onSubmit={submit}>
        <label class="mzu-field">
          <span class="mzu-field-label">NAME</span>
          <input
            type="text"
            data-autofocus
            maxLength={PROFILE_NAME_MAX}
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            placeholder="YOUR NAME"
            value={name}
            onInput={(e) => {
              setName((e.currentTarget as HTMLInputElement).value.toUpperCase());
              setError('');
            }}
          />
        </label>
        <div class="mzu-field">
          <span class="mzu-field-label">BADGE</span>
          <div class="mzu-badges" role="radiogroup" aria-label="Badge">
            {Array.from({ length: BADGE_COUNT }, (_, i) => (
              <button type="button" role="radio" aria-checked={badge === i} aria-label={BADGE_NAMES[i]} class={badge === i ? 'on' : ''} onClick={() => setBadge(i)}>
                <Badge index={i} size={44} />
              </button>
            ))}
          </div>
        </div>
        <div class="mzu-field">
          <span class="mzu-field-label">RACING EXPERIENCE</span>
          <div class="mzu-presets" role="radiogroup" aria-label="Racing experience">
            <button type="button" role="radio" aria-checked={preset === 'rookie'} class={`mzu-preset${preset === 'rookie' ? ' on' : ''}`} onClick={() => (setPreset('rookie'), setError(''))}>
              <span class="mzu-preset-title">I'M NEW TO RACING GAMES</span>
              <span class="mzu-preset-sub">Auto-accelerate, steering help, you can't crash out, boost from lap 1. Easy rivals.</span>
            </button>
            <button type="button" role="radio" aria-checked={preset === 'classic'} class={`mzu-preset${preset === 'classic' ? ' on' : ''}`} onClick={() => (setPreset('classic'), setError(''))}>
              <span class="mzu-preset-title">I'VE RACED BEFORE</span>
              <span class="mzu-preset-sub">No assists. Pilot rivals. You can change this later.</span>
            </button>
          </div>
        </div>
        {error ? (
          <p class="mzu-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" class="mzu-item big go">
          <span class="mzu-item-text">
            <span class="mzu-item-label">LET'S RACE</span>
          </span>
        </button>
      </form>
    </Screen>
  );
}

export function ProfileSelect({ app }: { app: App }) {
  const save = app.save.value;
  const [creating, setCreating] = useState(save.profiles.length === 0);
  if (creating || save.profiles.length === 0) {
    return <CreateForm app={app} onCancel={save.profiles.length > 0 ? () => setCreating(false) : null} />;
  }
  const active = app.activeProfile.value;
  return (
    <Screen id="profiles" title="WHO'S RACING?" kicker="MACHZERO" onBack={active ? () => app.selectProfile(active.id) : undefined} backLabel="MENU">
      <div class="mzu-cards">
        {save.profiles.map((p) => (
          <ProfileCard key={p.id} p={p} onPick={() => app.selectProfile(p.id)} onDelete={() => app.deleteProfile(p.id)} />
        ))}
        {app.canAddProfile ? (
          <button type="button" class="mzu-card mzu-card-new" onClick={() => setCreating(true)}>
            <span class="mzu-plus" aria-hidden="true">
              +
            </span>
            NEW PILOT
          </button>
        ) : null}
      </div>
    </Screen>
  );
}

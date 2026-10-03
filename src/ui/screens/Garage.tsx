/**
 * Garage (feature `garage`): pick a chassis, buy and fit parts, paint the ship. The turntable is WebGL,
 * drawn by GraphicsSystem into the transparent stage element; hovering or focusing an option previews it on
 * the turntable and as ghost stat bars. Chassis are free, parts cost credits, nothing can be sold.
 */
import { useEffect, useRef, useState, useLayoutEffect } from 'preact/hooks';
import type { App } from '../../app/App';
import type { Loadout, PartSlot, PartTier } from '../../core/contracts';
import { owns, partPrice } from '../../content/economy';
import { PART_EFFECTS, PART_SLOTS, PART_TIERS, SLOT_BLURBS, SLOT_NAMES, TIER_NAMES } from '../../content/parts';
import { CHASSIS, CLASS_LABEL, chassisById } from '../../content/ships';
import { focusFirst, onUiKeyDown } from '../nav';
import { statBars } from '../garageModel';

type Tab = 'ship' | PartSlot | 'paint';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'ship', label: 'SHIP' },
  ...PART_SLOTS.map((s) => ({ id: s as Tab, label: SLOT_NAMES[s].toUpperCase() })),
  { id: 'paint', label: 'PAINT' },
];

const fmt = (n: number) => n.toLocaleString('en-US');

/** What a tier adds, in words a kid can scan. */
function effectText(slot: PartSlot, t: PartTier): string {
  if (t === 0) return 'Factory fit';
  switch (slot) {
    case 'engine':
      return `+${PART_EFFECTS.engine.topSpeed[t]} speed · +${PART_EFFECTS.engine.thrustAccel[t]} accel`;
    case 'booster':
      return `+${PART_EFFECTS.booster.boostTopSpeed[t]} boost speed · ${PART_EFFECTS.booster.boostTime[t]} s boosts`;
    case 'stabilizer':
      return `+${Math.round((PART_EFFECTS.stabilizer.steerScale[t] - 1) * 100)}% steering · more grip`;
    case 'hull':
      return `+${PART_EFFECTS.hull.energyMax[t]} energy · −${Math.round((1 - PART_EFFECTS.hull.damageScale[t]) * 100)}% damage`;
  }
}

function withPart(l: Loadout, slot: PartSlot, tier: PartTier): Loadout {
  return { ...l, parts: { ...l.parts, [slot]: tier } };
}

function Credits({ value }: { value: number }) {
  return (
    <div class="mzu-credits" aria-label={`${fmt(value)} credits`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M9 9 H15 M9 12 H15 M9 15 H15" stroke="currentColor" stroke-width="1.8" />
      </svg>
      {fmt(value)}
    </div>
  );
}

function StatBars({ current, preview }: { current: Loadout; preview: Loadout | null }) {
  const now = statBars(current);
  const next = preview ? statBars(preview) : null;
  return (
    <div class="mzu-stats" aria-label="Ship stats">
      {now.map((b, i) => {
        const n = next?.[i].value ?? b.value;
        const up = n > b.value + 1e-6;
        const down = n < b.value - 1e-6;
        return (
          <div class={`mzu-stat${up ? ' up' : ''}${down ? ' down' : ''}`} key={b.key}>
            <span class="mzu-stat-label">{b.label}</span>
            <span class="mzu-stat-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.value * 100)} aria-label={b.label}>
              {/* The ghost shows the previewed value: longer (green) for a gain, the lost part (red) for a loss. */}
              <span class="mzu-stat-ghost" style={{ width: `${Math.max(n, b.value) * 100}%` }} />
              <span class="mzu-stat-fill" style={{ width: `${Math.min(n, b.value) * 100}%` }} />
            </span>
            <span class="mzu-stat-arrow" aria-hidden="true">
              {up ? '▲' : down ? '▼' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Hover / focus preview handlers for an option. */
function previewProps(set: (l: Loadout | null) => void, l: Loadout) {
  return { onMouseEnter: () => set(l), onMouseLeave: () => set(null), onFocus: () => set(l), onBlur: () => set(null) };
}

function ShipTab({ app, loadout, setPreview }: { app: App; loadout: Loadout; setPreview: (l: Loadout | null) => void }) {
  return (
    <div class="mzu-choices" role="radiogroup" aria-label="Ships">
      {CHASSIS.map((c) => {
        const on = c.id === loadout.chassisId;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={on}
            class={`mzu-choice${on ? ' on' : ''}`}
            onClick={() => app.selectChassis(c.id)}
            {...previewProps(setPreview, { ...loadout, chassisId: c.id })}
          >
            <span class="mzu-choice-head">
              <span class="mzu-choice-name">{c.name}</span>
              <span class={`mzu-tagpill ${c.cls}`}>{CLASS_LABEL[c.cls].toUpperCase()}</span>
            </span>
            <span class="mzu-choice-sub">{c.blurb}</span>
            <span class="mzu-choice-state">{on ? 'IN USE' : 'FREE'}</span>
          </button>
        );
      })}
    </div>
  );
}

function PartTab(props: { app: App; slot: PartSlot; setPreview: (l: Loadout | null) => void; onBuy: (slot: PartSlot, tier: PartTier) => void }) {
  const { app, slot, setPreview, onBuy } = props;
  const p = app.activeProfile.value!;
  const fitted = p.loadout.parts[slot];
  return (
    <>
      <p class="mzu-note">{SLOT_BLURBS[slot]}</p>
      <div class="mzu-choices" role="radiogroup" aria-label={SLOT_NAMES[slot]}>
        {PART_TIERS.map((t) => {
          const have = owns(p, slot, t);
          const on = fitted === t;
          const price = partPrice(t);
          const short = !have && p.credits < price;
          let state: string;
          if (on) state = 'FITTED';
          else if (have) state = 'OWNED · FIT';
          else if (short) state = `NEED ${fmt(price - p.credits)} MORE`;
          else state = `${fmt(price)} CREDITS`;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on}
              class={`mzu-choice tier-${t}${on ? ' on' : ''}${short ? ' locked' : ''}`}
              onClick={() => {
                if (on) return;
                if (have) app.equipPart(slot, t);
                else if (short) app.toast(`Win races to earn ${fmt(price - p.credits)} more credits.`, 'info');
                else onBuy(slot, t);
              }}
              {...previewProps(setPreview, withPart(p.loadout, slot, t))}
            >
              <span class="mzu-choice-head">
                <span class="mzu-choice-name">{TIER_NAMES[t].toUpperCase()}</span>
                {short ? (
                  <svg class="mzu-lock" viewBox="0 0 24 24" aria-label="Locked">
                    <path d="M7 11 V8 A5 5 0 0 1 17 8 V11 M5 11 H19 V21 H5 Z" fill="none" stroke="currentColor" stroke-width="2" />
                  </svg>
                ) : null}
              </span>
              <span class="mzu-choice-sub">{effectText(slot, t)}</span>
              <span class="mzu-choice-state">{state}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Curated neon swatches (body, trim and glow share them). */
const SWATCHES = [0xff2bd6, 0x19f0ff, 0x7dff3a, 0xffb319, 0xff5a2b, 0x8a4dff, 0xf4f7ff, 0x1a1d29];
const DECALS = ['STRIPES', 'CHEVRONS', 'TWO-TONE', 'FLAMES', 'CHECKER', 'BOLT'];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** HSL (s = 1, l = 0.55) → 0xRRGGBB: the hue slider covers the rainbow at full neon saturation. */
function hueColor(h: number): number {
  const l = 0.55;
  const a = 1 * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function hueOf(c: number): number {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return Math.round(h < 0 ? h + 360 : h);
}

function DecalIcon({ i }: { i: number }) {
  const paths = [
    'M2 9 H22 M2 15 H22',
    'M3 6 L9 12 L3 18 M10 6 L16 12 L10 18',
    'M2 12 H22',
    'M2 18 C6 10 8 16 11 8 C13 14 16 6 22 12',
    'M2 8 H6 V12 H10 V8 H14 V12 H18 V8 H22 M6 12 V16 H10 M14 12 V16 H18',
    'M13 2 L6 13 H12 L10 22 L18 10 H12 Z',
  ];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="3" fill="none" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.5" />
      <path d={paths[i]} fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: number; onChange: (c: number) => void }) {
  return (
    <div class="mzu-color">
      <span class="mzu-row-label">{label}</span>
      <span class="mzu-swatches" role="radiogroup" aria-label={`${label} colour`}>
        {SWATCHES.map((c) => (
          <button type="button" role="radio" aria-checked={c === value} aria-label={hex(c)} class={c === value ? 'on' : ''} style={{ '--c': hex(c) }} onClick={() => onChange(c)} />
        ))}
      </span>
      <input
        class="mzu-hue"
        type="range"
        min={0}
        max={359}
        step={3}
        value={hueOf(value)}
        aria-label={`${label} hue`}
        onInput={(e) => onChange(hueColor(Number((e.currentTarget as HTMLInputElement).value)))}
        style={{ '--c': hex(value) }}
      />
    </div>
  );
}

function PaintTab({ app }: { app: App }) {
  const l = app.activeProfile.value!.loadout.livery;
  const set = (patch: Partial<Loadout['livery']>) => app.setLivery({ ...l, ...patch });
  const factory = chassisById(app.activeProfile.value!.loadout.chassisId).livery;
  return (
    <div class="mzu-section">
      <ColorRow label="BODY" value={l.primary} onChange={(c) => set({ primary: c })} />
      <ColorRow label="TRIM" value={l.secondary} onChange={(c) => set({ secondary: c })} />
      <ColorRow label="GLOW" value={l.glow} onChange={(c) => set({ glow: c })} />
      <div class="mzu-color">
        <span class="mzu-row-label">DECAL</span>
        <span class="mzu-decals" role="radiogroup" aria-label="Decal">
          {DECALS.map((name, i) => (
            <button type="button" role="radio" aria-checked={l.decal === i} class={l.decal === i ? 'on' : ''} onClick={() => set({ decal: i })}>
              <DecalIcon i={i} />
              <span>{name}</span>
            </button>
          ))}
        </span>
      </div>
      <div class="mzu-actions">
        <button type="button" class="mzu-chip" onClick={() => set({ ...factory })}>
          FACTORY COLOURS
        </button>
      </div>
    </div>
  );
}

function ConfirmBuy({ slot, tier, credits, onYes, onNo }: { slot: PartSlot; tier: PartTier; credits: number; onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  const price = partPrice(tier);
  return (
    <div class="mzu-dialog-wrap">
      <div ref={ref} class="mzu-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mzu-buy-title">
        <div class="mzu-kicker">BUY PART</div>
        <h2 id="mzu-buy-title" class="mzu-dialog-title">
          {SLOT_NAMES[slot].toUpperCase()} · {TIER_NAMES[tier].toUpperCase()}
        </h2>
        <p class="mzu-note">{effectText(slot, tier)}</p>
        <p class="mzu-dialog-price">
          {fmt(price)} credits <span>· {fmt(credits - price)} left after</span>
        </p>
        <div class="mzu-actions">
          <button type="button" class="mzu-chip go" data-autofocus onClick={onYes}>
            BUY &amp; FIT
          </button>
          <button type="button" class="mzu-chip" data-back onClick={onNo}>
            NOT NOW
          </button>
        </div>
      </div>
    </div>
  );
}

export function Garage({ app }: { app: App }) {
  const ref = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('ship');
  const [preview, setPreview] = useState<Loadout | null>(null);
  const [buying, setBuying] = useState<{ slot: PartSlot; tier: PartTier } | null>(null);
  /** The card that opened the buy dialog gets focus back when it closes. */
  const opener = useRef<HTMLElement | null>(null);
  const p = app.activeProfile.value;
  const loadout = p?.loadout ?? null;
  const shown = preview ?? loadout;

  // Layout effect: focus lands with the first paint, so keys pressed right away reach the screen (not <body>).
  useLayoutEffect(() => {
    if (ref.current) focusFirst(ref.current);
  }, []);
  // The turntable follows the previewed (else the fitted) loadout; stop drawing it on the way out.
  useEffect(() => {
    app.showShipPreview(stage.current, shown);
  }, [shown]);
  useEffect(() => () => app.showShipPreview(null, null), []);
  // Leaving a tab drops its preview.
  useEffect(() => setPreview(null), [tab]);
  useEffect(() => {
    if (buying) return;
    opener.current?.focus();
    opener.current = null;
  }, [buying]);

  // Drag the turntable.
  const drag = useRef<{ id: number; x: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { id: e.pointerId, x: e.clientX };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    app.nudgeShipPreview((e.clientX - drag.current.x) * 0.012);
    drag.current.x = e.clientX;
  };
  const onPointerUp = () => (drag.current = null);

  if (!p || !loadout) {
    return (
      <section ref={ref} class="mzu-screen" data-screen="garage" aria-label="Garage">
        <div class="mzu-body">
          <p class="mzu-lead">Pick a pilot first.</p>
          <button type="button" class="mzu-chip" data-back onClick={() => app.showProfiles()}>
            PILOTS
          </button>
        </div>
      </section>
    );
  }

  const c = chassisById(shown!.chassisId);
  const confirmBuy = () => {
    if (!buying) return;
    const r = app.buyPart(buying.slot, buying.tier);
    if (r === 'bought') app.toast(`${TIER_NAMES[buying.tier]} ${SLOT_NAMES[buying.slot].toLowerCase()} fitted!`, 'good');
    else if (r === 'short') app.toast('Not enough credits yet.', 'warn');
    setBuying(null);
    setPreview(null);
  };

  return (
    <section ref={ref} class="mzu-garage" data-screen="garage" aria-label="Garage" onKeyDown={(e) => ref.current && onUiKeyDown(ref.current, e)}>
      <header class="mzu-garage-head" inert={buying !== null}>
        <button type="button" class="mzu-back" data-back={buying ? undefined : ''} onClick={() => app.closeGarage()} aria-label="Menu">
          <span aria-hidden="true">‹</span> MENU
        </button>
        <div class="mzu-titles">
          <div class="mzu-kicker">{p.name}</div>
          <h1 class="mzu-title">GARAGE</h1>
        </div>
        <Credits value={p.credits} />
      </header>
      <div class="mzu-garage-main" inert={buying !== null}>
        <div class="mzu-stage-col">
          <div ref={stage} class="mzu-stage" data-preview onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div class="mzu-stage-label">
              <span class="mzu-choice-name">{c.name}</span>
              <span class={`mzu-tagpill ${c.cls}`}>{CLASS_LABEL[c.cls].toUpperCase()}</span>
            </div>
          </div>
          <StatBars current={loadout} preview={preview} />
        </div>
        <div class="mzu-garage-panel">
          <div class="mzu-tabs" role="tablist">
            {TABS.map((t) => (
              <button type="button" role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div class="mzu-garage-body">
            {tab === 'ship' ? <ShipTab app={app} loadout={loadout} setPreview={setPreview} /> : null}
            {tab === 'paint' ? <PaintTab app={app} /> : null}
            {tab !== 'ship' && tab !== 'paint' ? <PartTab app={app} slot={tab} setPreview={setPreview} onBuy={(slot, tier) => {
                  opener.current = document.activeElement as HTMLElement | null;
                  setBuying({ slot, tier });
                }} /> : null}
          </div>
        </div>
      </div>
      {buying ? <ConfirmBuy slot={buying.slot} tier={buying.tier} credits={p.credits} onYes={confirmBuy} onNo={() => setBuying(null)} /> : null}
    </section>
  );
}

/**
 * Garage (feature `garage`): pick a chassis, buy and fit parts, paint the ship, stock up on items. The turntable is WebGL,
 * drawn by GraphicsSystem into the transparent stage element; hovering or focusing an option previews it on
 * the turntable and as ghost stat bars. Chassis are free, parts cost credits, nothing can be sold.
 */
import { useEffect, useRef, useState, useLayoutEffect } from 'preact/hooks';
import type { App } from '../../app/App';
import type { Loadout, PartSlot, PartTier, PartVariant } from '../../core/contracts';
import { owns, partPrice } from '../../content/economy';
import { AERO_EFFECTS, PART_SLOTS, PART_TIERS, PART_VARIANT_BLURBS, SLOT_BLURBS, SLOT_NAMES, STOCK_VARIANTS, hasVariants, partEffects, partName, variantOf } from '../../content/parts';
import { ITEM_ICONS, ITEM_KINDS, ITEM_NAMES, ITEM_PRICES, SHIELD_TIME, bagTotal, itemSlots, nextItemSlotAt, type ItemKind } from '../../content/items';
import { CHASSIS, CLASS_LABEL, chassisById } from '../../content/ships';
import { CONFIG } from '../../core/config';
import { focusFirst, onUiKeyDown } from '../nav';
import { statBars } from '../garageModel';

type Tab = 'ship' | PartSlot | 'paint' | 'items';
/** The Aero tab and the B variants belong to the 2.1 expansion (feature `expansion`). */
const tabsFor = (expansion: boolean): ReadonlyArray<{ id: Tab; label: string }> => [
  { id: 'ship', label: 'SHIP' },
  ...PART_SLOTS.filter((s) => expansion || s !== 'aero').map((s) => ({ id: s as Tab, label: SLOT_NAMES[s].toUpperCase() })),
  { id: 'paint', label: 'PAINT' },
  { id: 'items', label: 'ITEMS' },
];

/** A part on sale: a tier and, where the slot has two lines of parts, which one. */
interface Offer {
  tier: PartTier;
  variant: PartVariant;
}

/** Stock, then each tier (both variants side by side when the slot has them and the expansion is on). */
function offersFor(slot: PartSlot, expansion: boolean): Offer[] {
  return PART_TIERS.flatMap((tier): Offer[] => (expansion && hasVariants(slot, tier) ? [{ tier, variant: 'a' }, { tier, variant: 'b' }] : [{ tier, variant: 'a' }]));
}

const fmt = (n: number) => n.toLocaleString('en-US');

const pct = (scale: number) => Math.round(Math.abs(scale - 1) * 100);

/** What a part adds, in words a kid can scan. */
function effectText(slot: PartSlot, t: PartTier, variant: PartVariant = 'a'): string {
  if (t === 0) return 'Factory fit';
  const fx = partEffects(variantOf(slot, t, variant));
  switch (slot) {
    case 'engine':
      return `+${fx.engine.topSpeed[t]} speed · +${fx.engine.thrustAccel[t]} accel`;
    case 'booster':
      return `+${fx.booster.boostTopSpeed[t]} boost speed · ${fx.booster.boostTime[t]} s boosts`;
    case 'stabilizer':
      return `+${pct(fx.stabilizer.steerScale[t])}% steering · ${fx.stabilizer.lateralGrip[t] > 0 ? `+${fx.stabilizer.lateralGrip[t]} grip` : 'stock grip'}`;
    case 'hull':
      return `+${fx.hull.energyMax[t]} energy · −${pct(fx.hull.damageScale[t])}% damage${fx.hull.ramMass[t] > 1 ? ` · +${pct(fx.hull.ramMass[t])}% shove` : ''}`;
    case 'aero':
      return `+${pct(AERO_EFFECTS.draftScale[t])}% slipstream · −${pct(AERO_EFFECTS.pushScale[t])}% wind push · +${pct(AERO_EFFECTS.airSteerScale[t])}% air steering`;
  }
}

function withPart(l: Loadout, slot: PartSlot, tier: PartTier, variant: PartVariant = 'a'): Loadout {
  return { ...l, parts: { ...l.parts, [slot]: tier }, variants: { ...STOCK_VARIANTS, ...l.variants, [slot]: variantOf(slot, tier, variant) } };
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

function PartTab(props: { app: App; slot: PartSlot; setPreview: (l: Loadout | null) => void; onBuy: (slot: PartSlot, offer: Offer) => void }) {
  const { app, slot, setPreview, onBuy } = props;
  const p = app.activeProfile.value!;
  const fitted = p.loadout.parts[slot] ?? 0;
  const fittedVariant = variantOf(slot, fitted, p.loadout.variants?.[slot]);
  const expansion = app.features.expansion;
  return (
    <>
      <p class="mzu-note">{SLOT_BLURBS[slot]}</p>
      <div class="mzu-choices" role="radiogroup" aria-label={SLOT_NAMES[slot]}>
        {offersFor(slot, expansion).map((offer) => {
          const { tier: t, variant } = offer;
          const paired = expansion && hasVariants(slot, t);
          const have = owns(p, slot, t, variant);
          const on = fitted === t && fittedVariant === variant;
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
              data-part={`${t}${variant}`}
              class={`mzu-choice tier-${t}${paired ? ` variant-${variant}` : ''}${on ? ' on' : ''}${short ? ' locked' : ''}`}
              onClick={() => {
                if (on) return;
                if (have) app.equipPart(slot, t, variant);
                else if (short) app.toast(`Win races to earn ${fmt(price - p.credits)} more credits.`, 'info');
                else onBuy(slot, offer);
              }}
              {...previewProps(setPreview, withPart(p.loadout, slot, t, variant))}
            >
              <span class="mzu-choice-head">
                <span class="mzu-choice-name">{(paired ? partName(slot, t, variant) : partName(slot, t)).toUpperCase()}</span>
                {short ? (
                  <svg class="mzu-lock" viewBox="0 0 24 24" aria-label="Locked">
                    <path d="M7 11 V8 A5 5 0 0 1 17 8 V11 M5 11 H19 V21 H5 Z" fill="none" stroke="currentColor" stroke-width="2" />
                  </svg>
                ) : null}
              </span>
              <span class="mzu-choice-sub">{effectText(slot, t, variant)}</span>
              {paired ? <span class="mzu-choice-sub dim">{PART_VARIANT_BLURBS[slot][variant]}</span> : null}
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

/** What each item does, in words a kid can scan. */
function itemBlurb(kind: ItemKind): string {
  switch (kind) {
    case 'emp':
      return `Hits the racer directly ahead: ${Math.round((1 - CONFIG.EMP_SLOW) * 100)}% slower for ${CONFIG.EMP_SLOW_TIME} s, no boost for ${CONFIG.EMP_LOCK_TIME} s.`;
    case 'shield':
      return `Blocks one EMP or mine, for up to ${SHIELD_TIME} s.`;
    case 'mine':
      return `Leaves a mine behind you for ${CONFIG.DROP_MINE_LIFE} s.`;
  }
}

function ItemsTab({ app }: { app: App }) {
  const p = app.activeProfile.value!;
  const slots = itemSlots(p);
  const total = bagTotal(p.items);
  const full = total >= slots;
  const next = nextItemSlotAt(p);
  // Filled slots in kind order, so the pips show the mix.
  const filled = ITEM_KINDS.flatMap((k) => Array.from({ length: p.items[k] }, () => k));
  const buy = (kind: ItemKind) => {
    const r = app.buyItem(kind);
    if (r === 'bought') app.toast(`${ITEM_NAMES[kind]} ready (${total + 1}/${slots} slots).`, 'good');
    else if (r === 'full') app.toast('Every item slot is full.', 'info');
    else app.toast(`Win races to earn ${fmt(ITEM_PRICES[kind] - p.credits)} more credits.`, 'info');
  };
  return (
    <div class="mzu-section">
      <p class="mzu-note">
        Pick with ◀ ▶ on the d-pad (or C), use with Ⓨ (or F). Every item shares your slots; unused items carry over to your next race.
      </p>
      <div class="mzu-emp-pips mzu-item-slots" aria-label={`${total} of ${slots} slots filled`}>
        {Array.from({ length: slots }, (_, i) => (
          <span class={i < total ? 'on' : ''}>{i < total ? ITEM_ICONS[filled[i]] : ''}</span>
        ))}
      </div>
      {ITEM_KINDS.map((kind, i) => {
        const short = !full && p.credits < ITEM_PRICES[kind];
        return (
          <div class="mzu-emp" data-item={kind}>
            <span class="mzu-choice-name">
              {ITEM_ICONS[kind]} {ITEM_NAMES[kind]} <span class="mzu-item-have">×{p.items[kind]}</span>
            </span>
            <span class="mzu-note mzu-item-blurb">{itemBlurb(kind)}</span>
            <button type="button" class={`mzu-chip${full || short ? '' : ' go'}`} data-autofocus={i === 0 ? true : undefined} onClick={() => buy(kind)} aria-disabled={full || short}>
              {full ? 'SLOTS FULL' : `BUY · ${fmt(ITEM_PRICES[kind])}`}
            </button>
          </div>
        );
      })}
      <p class="mzu-note dim">{next === null ? 'All item slots unlocked.' : `Slot ${slots + 1} unlocks at ${next} wins (you have ${p.stats.wins}).`}</p>
    </div>
  );
}

function ConfirmBuy({ slot, tier, variant, credits, onYes, onNo }: { slot: PartSlot; tier: PartTier; variant: PartVariant; credits: number; onYes: () => void; onNo: () => void }) {
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
          {SLOT_NAMES[slot].toUpperCase()} · {partName(slot, tier, variant).toUpperCase()}
        </h2>
        <p class="mzu-note">{effectText(slot, tier, variant)}</p>
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
  const [buying, setBuying] = useState<{ slot: PartSlot; tier: PartTier; variant: PartVariant } | null>(null);
  const r = app.route.value;
  const fromCup = r.name === 'garage' && r.back === 'cup';
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

  // Drag the turntable (sideways turns, up and down tilts); the wheel zooms (§V.3).
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    app.orbitShipPreview((e.clientX - drag.current.x) * 0.012, (e.clientY - drag.current.y) * 0.006, 0);
    drag.current.x = e.clientX;
    drag.current.y = e.clientY;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    app.orbitShipPreview(0, 0, -Math.sign(e.deltaY) * 0.08);
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
    const r = app.buyPart(buying.slot, buying.tier, buying.variant);
    if (r === 'bought') app.toast(`${partName(buying.slot, buying.tier, buying.variant)} ${SLOT_NAMES[buying.slot].toLowerCase()} fitted!`, 'good');
    else if (r === 'short') app.toast('Not enough credits yet.', 'warn');
    setBuying(null);
    setPreview(null);
  };

  return (
    <section ref={ref} class="mzu-garage" data-screen="garage" aria-label="Garage" onKeyDown={(e) => ref.current && onUiKeyDown(ref.current, e)}>
      <header class="mzu-garage-head" inert={buying !== null}>
        <button type="button" class="mzu-back" data-back={buying ? undefined : ''} onClick={() => app.closeGarage()} aria-label={fromCup ? 'Cup standings' : 'Menu'}>
          <span aria-hidden="true">‹</span> {fromCup ? 'CUP' : 'MENU'}
        </button>
        <div class="mzu-titles">
          <div class="mzu-kicker">{p.name}</div>
          <h1 class="mzu-title">GARAGE</h1>
        </div>
        <Credits value={p.credits} />
      </header>
      <div class="mzu-garage-main" inert={buying !== null}>
        <div class="mzu-stage-col">
          <div ref={stage} class="mzu-stage" data-preview onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
            <div class="mzu-stage-label">
              <span class="mzu-choice-name">{c.name}</span>
              <span class={`mzu-tagpill ${c.cls}`}>{CLASS_LABEL[c.cls].toUpperCase()}</span>
            </div>
          </div>
          <StatBars current={loadout} preview={preview} />
        </div>
        <div class="mzu-garage-panel">
          <div class="mzu-tabs" role="tablist">
            {tabsFor(app.features.expansion).map((t) => (
              <button type="button" role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div class="mzu-garage-body">
            {tab === 'ship' ? <ShipTab app={app} loadout={loadout} setPreview={setPreview} /> : null}
            {tab === 'paint' ? <PaintTab app={app} /> : null}
            {tab === 'items' ? <ItemsTab app={app} /> : null}
            {tab !== 'ship' && tab !== 'paint' && tab !== 'items' ? <PartTab app={app} slot={tab} setPreview={setPreview} onBuy={(slot, offer) => {
                  opener.current = document.activeElement as HTMLElement | null;
                  setBuying({ slot, ...offer });
                }} /> : null}
          </div>
        </div>
      </div>
      {buying ? <ConfirmBuy slot={buying.slot} tier={buying.tier} variant={buying.variant} credits={p.credits} onYes={confirmBuy} onNo={() => setBuying(null)} /> : null}
    </section>
  );
}

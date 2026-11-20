/**
 * The touch controls (IMPLEMENTATION §M7b) as DOM inside the HUD: a floating steering slider in the left 45% of the
 * screen, BOOST and BRAKE under the right thumb, ITEM (with its next-item chip) above BOOST, an ACCELERATE button when
 * auto-accelerate is off, two air-brake buttons in the 'buttons' style, and PAUSE at the top. Pointer events go to
 * TouchInput; nothing here runs per frame except the first-race hint's clock. No draw calls.
 *
 * The layer is shown only while the HUD is counting down or racing and the last-used device is touch (`html.mz-touch`,
 * set by the App); CSS does that, and the HUD calls `release()` whenever the race leaves those states.
 */
import { ITEM_ICONS } from '../content/items';
import type { ItemView } from './ItemSystem';
import type { TouchControl, TouchInput } from '../physics/TouchInput';
import type { AirbrakeStyle } from '../save/schema';

export interface TouchLayoutConfig {
  buttonSize: 's' | 'm' | 'l';
  leftHanded: boolean;
  airbrake: AirbrakeStyle;
  /** The effective auto-accelerate while touch drives: off shows the ACCELERATE button. */
  autoAccelerate: boolean;
  /** Show the first-race hint (touch.hintSeen is false). */
  hint: boolean;
}

/** Scale of every touch control by `touch.buttonSize`. */
export const BUTTON_SCALE = { s: 0.85, m: 1, l: 1.2 } as const;
/** The first-race hint shows this long (wall clock) or until the first touch. */
export const HINT_MS = 4000;
/** The slider dot shows at most this far (points) from the ring. */
const DOT_CAP = 120;

/**
 * What the App hands a race's HUD: the touch input, the live layout settings and two callbacks. One per App; each
 * race's TouchControls subscribes to it and unsubscribes on dispose.
 */
export class TouchRig {
  private cfg: TouchLayoutConfig = { buttonSize: 'm', leftHanded: false, airbrake: 'slider', autoAccelerate: true, hint: false };
  private readonly listeners = new Set<(c: TouchLayoutConfig) => void>();
  /** A light haptic tick per button press (native/haptics.ts tapUi). */
  haptic: () => void = () => undefined;
  /** The first-race hint was shown (the App sets touch.hintSeen). */
  onHintSeen: () => void = () => undefined;
  /** Tilt steers right now (tilt chosen and its data fresh): no slider; the air-brakes go to the free corner (M7c). */
  tiltActive = false;
  /** Tilt is on but the screen lies too flat to read: "HOLD THE DEVICE UPRIGHT". */
  tiltFlat = false;

  constructor(readonly input: TouchInput) {}

  get config(): Readonly<TouchLayoutConfig> {
    return this.cfg;
  }

  setConfig(c: Readonly<TouchLayoutConfig>): void {
    this.cfg = { ...c };
    for (const fn of this.listeners) fn(this.cfg);
  }

  subscribe(fn: (c: TouchLayoutConfig) => void): () => void {
    this.listeners.add(fn);
    fn(this.cfg);
    return () => this.listeners.delete(fn);
  }
}

/** A button's place (right-handed, M size): size, distance from the near side edge and from the bottom, in points. */
interface Spot {
  size: number;
  side: number;
  bottom: number;
}
/** IMPLEMENTATION §M7b layout table. Distances are from the safe-area edge (the HUD's race box is already inset). */
export const TOUCH_LAYOUT: Readonly<Record<'boost' | 'brake' | 'throttle' | 'item' | 'itemNext' | 'airLeft' | 'airRight', Spot>> = {
  boost: { size: 88, side: 24, bottom: 24 },
  brake: { size: 64, side: 24 + 88 + 16, bottom: 16 },
  // Above BRAKE with a 12 gap, and moved left of the next-item chip (directly above BRAKE the two would overlap).
  throttle: { size: 72, side: 24 + 16 + 56 + 8 + 44 + 8, bottom: 16 + 64 + 12 },
  item: { size: 56, side: 24 + 16, bottom: 24 + 88 + 12 },
  itemNext: { size: 44, side: 24 + 16 + 56 + 8, bottom: 24 + 88 + 12 + 6 },
  // The air-brake pair sits above the BRAKE column, left of the next-item chip, 12 apart: above ITEM (the spec's place)
  // it would reach the minimap and the best times on a phone. `bottom` here is with ACCELERATE hidden; with it shown
  // the pair goes above ACCELERATE instead (AIR_ABOVE_THROTTLE).
  airRight: { size: 56, side: 24 + 16 + 56 + 8 + 44 + 8, bottom: 16 + 64 + 12 },
  airLeft: { size: 56, side: 24 + 16 + 56 + 8 + 44 + 8 + 56 + 12, bottom: 16 + 64 + 12 },
};
/** Tilt mode: the two air-brakes (72 round) in the corner the steering thumb has left free. */
const TILT_AIR = { size: 72, side: 24, gap: 16, bottom: 24 } as const;
/** The air-brake row's bottom while ACCELERATE shows: 12 above it. */
const AIR_ABOVE_THROTTLE = 16 + 64 + 12 + 72 + 12;

const LABEL: Record<Exclude<TouchControl, 'pause'>, string> = {
  boost: 'BOOST',
  brake: 'BRAKE',
  throttle: 'GO',
  item: '',
  itemNext: '▸',
  airLeft: '◂AIR',
  airRight: 'AIR▸',
};

export class TouchControls {
  readonly layer: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly dot: HTMLDivElement;
  private readonly buttons = new Map<TouchControl, HTMLButtonElement>();
  private readonly hintEl: HTMLDivElement;
  private readonly flatChip: HTMLDivElement;
  private tiltShown = false;
  private flatShown = false;
  private readonly unsub: () => void;
  private cfg: TouchLayoutConfig;
  private ringX = 0;
  private ringY = 0;
  private hintStart = 0;
  private hintDone = false;
  private shownItems = '';

  constructor(
    parent: HTMLElement,
    private readonly rig: TouchRig,
    private readonly now: () => number = () => performance.now(),
  ) {
    const doc = parent.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'mz-touch-layer';
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    this.layer = layer;

    const zone = doc.createElement('div');
    zone.className = 'mz-tz-steer';
    this.zone = zone;
    this.ring = doc.createElement('div');
    this.ring.className = 'mz-tz-ring';
    this.dot = doc.createElement('div');
    this.dot.className = 'mz-tz-dot';
    zone.append(this.ring, this.dot);
    layer.appendChild(zone);
    zone.addEventListener('pointerdown', this.onZoneDown);
    zone.addEventListener('pointermove', this.onZoneMove);
    zone.addEventListener('pointerup', this.onZoneUp);
    zone.addEventListener('pointercancel', this.onZoneUp);
    zone.addEventListener('lostpointercapture', this.onZoneUp);

    for (const c of ['boost', 'brake', 'throttle', 'item', 'itemNext', 'airLeft', 'airRight', 'pause'] as const) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `mz-tb mz-tb-${c}`;
      b.dataset.c = c;
      b.setAttribute('aria-label', c === 'pause' ? 'PAUSE' : c === 'item' ? 'USE ITEM' : c === 'itemNext' ? 'NEXT ITEM' : c === 'throttle' ? 'ACCELERATE' : c === 'airLeft' ? 'AIR-BRAKE LEFT' : c === 'airRight' ? 'AIR-BRAKE RIGHT' : LABEL[c]);
      b.textContent = c === 'pause' ? 'II' : LABEL[c];
      b.addEventListener('pointerdown', (e) => this.onButton(e, c, true));
      b.addEventListener('pointerup', (e) => this.onButton(e, c, false));
      b.addEventListener('pointercancel', (e) => this.onButton(e, c, false));
      b.addEventListener('lostpointercapture', () => this.rig.input.press(c, false));
      // Clicks (a mouse in QA, or a synthetic tap) are handled by pointer events already.
      b.addEventListener('click', (e) => e.preventDefault());
      layer.appendChild(b);
      this.buttons.set(c, b);
    }

    this.hintEl = doc.createElement('div');
    this.hintEl.className = 'mz-touch-hint';
    for (const [cls, text] of [
      ['steer', 'STEER: SLIDE YOUR THUMB'],
      ['boost', 'BOOST'],
      ['brake', 'BRAKE'],
      ['item', 'ITEM'],
    ] as const) {
      const t = doc.createElement('span');
      t.className = `mz-th-${cls}`;
      t.textContent = text;
      this.hintEl.appendChild(t);
    }
    this.hintEl.hidden = true;
    layer.appendChild(this.hintEl);
    layer.addEventListener('pointerdown', () => this.endHint(), true);
    this.flatChip = doc.createElement('div');
    this.flatChip.className = 'mz-tilt-flat';
    this.flatChip.setAttribute('role', 'status');
    this.flatChip.textContent = '⟲ HOLD THE DEVICE UPRIGHT';
    this.flatChip.hidden = true;
    layer.appendChild(this.flatChip);

    parent.appendChild(layer);
    this.cfg = rig.config;
    this.unsub = rig.subscribe((c) => this.apply(c));
  }

  /** Lay the controls out for a configuration (no rebuild; positions and visibility only). */
  private apply(c: TouchLayoutConfig): void {
    this.cfg = c;
    const k = BUTTON_SCALE[c.buttonSize];
    const side = c.leftHanded ? 'left' : 'right';
    const other = c.leftHanded ? 'right' : 'left';
    this.layer.classList.toggle('lh', c.leftHanded);
    this.layer.style.setProperty('--tb', String(k));
    for (const [name, spot] of Object.entries(TOUCH_LAYOUT) as [keyof typeof TOUCH_LAYOUT, Spot][]) {
      const b = this.buttons.get(name)!;
      // Left-handed mirrors the cluster: the air-brake pair keeps left on the left.
      const s = c.leftHanded && (name === 'airLeft' || name === 'airRight') ? TOUCH_LAYOUT[name === 'airLeft' ? 'airRight' : 'airLeft'] : spot;
      b.style.width = b.style.height = `${s.size * k}px`;
      b.style.setProperty(side, `${s.side * k}px`);
      b.style.setProperty(other, 'auto');
      const bottom = (name === 'airLeft' || name === 'airRight') && !c.autoAccelerate ? AIR_ABOVE_THROTTLE : s.bottom;
      b.style.bottom = `${bottom * k}px`;
    }
    this.buttons.get('throttle')!.hidden = c.autoAccelerate;
    this.layer.classList.toggle('tilt', this.tiltShown);
    if (this.tiltShown) {
      // The steering thumb's corner (left, or right when left-handed): left air-brake nearer the left edge.
      const near = c.leftHanded ? 'airRight' : 'airLeft';
      const far = c.leftHanded ? 'airLeft' : 'airRight';
      const edge = c.leftHanded ? 'right' : 'left';
      const away = c.leftHanded ? 'left' : 'right';
      for (const [name, sideOff] of [
        [near, TILT_AIR.side],
        [far, TILT_AIR.side + TILT_AIR.size + TILT_AIR.gap],
      ] as const) {
        const b = this.buttons.get(name)!;
        b.style.width = b.style.height = `${TILT_AIR.size * k}px`;
        b.style.setProperty(edge, `${sideOff * k}px`);
        b.style.setProperty(away, 'auto');
        b.style.bottom = `${TILT_AIR.bottom * k}px`;
        b.hidden = false;
      }
      if (!c.hint) this.hintDone = true;
      return;
    }
    const ab = c.airbrake === 'buttons';
    this.buttons.get('airLeft')!.hidden = !ab;
    this.buttons.get('airRight')!.hidden = !ab;
    if (!c.hint) this.hintDone = true;
  }

  /** The player's items: the ITEM button shows the selected item and its count; no items, no button. */
  setItems(v: ItemView | null): void {
    const key = v === null ? '' : `${v.selected}|${v.counts[v.selected]}|${v.counts.emp + v.counts.shield + v.counts.mine}`;
    if (key === this.shownItems) return;
    this.shownItems = key;
    const item = this.buttons.get('item')!;
    const next = this.buttons.get('itemNext')!;
    item.hidden = v === null;
    next.hidden = v === null;
    if (v === null) return;
    const n = v.counts[v.selected];
    item.textContent = `${ITEM_ICONS[v.selected]}${n}`;
    item.dataset.s = n > 0 ? 'ready' : 'empty';
  }

  /** Per frame from the HUD: follows tilt (mode and the flat chip) and runs the first-race hint's clock. */
  update(showing: boolean): void {
    const tilt = this.rig.tiltActive;
    if (tilt !== this.tiltShown) {
      this.tiltShown = tilt;
      if (tilt) this.layer.classList.remove('steering'); // the external steer replaces the slider
      this.apply(this.cfg);
    }
    const flat = tilt && this.rig.tiltFlat;
    if (flat !== this.flatShown) {
      this.flatShown = flat;
      this.flatChip.hidden = !flat;
    }
    if (this.hintDone || !this.cfg.hint) return;
    if (!showing) return;
    const t = this.now();
    if (this.hintStart === 0) {
      this.hintStart = t;
      this.hintEl.hidden = false;
      return;
    }
    if (t - this.hintStart >= HINT_MS) this.endHint();
  }

  private endHint(): void {
    if (this.hintDone || this.hintStart === 0) return;
    this.hintDone = true;
    this.hintEl.hidden = true;
    this.rig.onHintSeen();
  }

  /** Let go of everything (pause, results, intro, the device changed). */
  release(): void {
    this.rig.input.releaseAll();
    this.layer.classList.remove('steering');
    for (const b of this.buttons.values()) b.classList.remove('on');
  }

  dispose(): void {
    this.unsub();
    this.release();
    this.layer.remove();
  }

  // ---------------------------------------------------------------------

  private readonly onZoneDown = (e: PointerEvent): void => {
    e.preventDefault();
    const r = this.zone.getBoundingClientRect();
    if (!this.rig.input.steerStart(e.pointerId, e.clientX)) return;
    this.zone.setPointerCapture?.(e.pointerId);
    this.ringX = e.clientX - r.left;
    this.ringY = e.clientY - r.top;
    this.ring.style.transform = `translate(${this.ringX}px, ${this.ringY}px)`;
    this.dot.style.transform = `translate(${this.ringX}px, ${this.ringY}px)`;
    this.layer.classList.add('steering');
  };

  private readonly onZoneMove = (e: PointerEvent): void => {
    if (this.rig.input.steerOrigin === null) return;
    this.rig.input.steerMove(e.pointerId, e.clientX);
    // The dot follows the thumb across, capped a little past the air-brake overdrive so it stays near the ring.
    const shown = Math.max(-DOT_CAP, Math.min(DOT_CAP, this.rig.input.steerTravel));
    this.dot.style.transform = `translate(${this.ringX + shown}px, ${this.ringY}px)`;
  };

  private readonly onZoneUp = (e: PointerEvent): void => {
    this.rig.input.steerEnd(e.pointerId);
    if (this.rig.input.steerOrigin === null) this.layer.classList.remove('steering');
  };

  private onButton(e: PointerEvent, c: TouchControl, down: boolean): void {
    e.preventDefault();
    const b = this.buttons.get(c)!;
    if (down) {
      b.setPointerCapture?.(e.pointerId);
      if (!this.rig.input.isHeld(c)) this.rig.haptic();
    }
    b.classList.toggle('on', down);
    this.rig.input.press(c, down);
  }
}

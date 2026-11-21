import { CONFIG } from '../core/config';
import type { GhostFrame, HudActions, IHUD, RaceSnapshot, RaceState, RacerStanding, TrackData } from '../core/contracts';
import type { Medal } from '../save/schema';
import type { GameBus } from '../core/events';
import { clamp, damp, formatTime, ordinal } from '../core/math';
import { ITEM_ICONS, ITEM_KINDS, ITEM_NAMES } from '../content/items';
import type { ItemView } from './ItemSystem';
import { Minimap } from './Minimap';
import { TouchControls, type TouchRig } from './TouchControls';
import { HAZARD_ICONS, HAZARD_NAMES, buildCueSpots, hazardCue, type CueSpot } from './HazardCue';
import type { RosterEntry } from './pilotPortrait';
import '../ui/tokens.css';
import './hud.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PLAYER_ID = 0;
const MAX_TOASTS = 3;
const TOAST_MS = 2300;
/** Arc gauge tops out at boost top speed so the boost range is visible on the dial. */
const GAUGE_MAX_KMH = CONFIG.BOOST_TOP_SPEED * CONFIG.SPEED_DISPLAY_SCALE;
/** Seconds a Time Trial split stays up. */
export const SPLIT_SECONDS = 3;

/** The HUD of a Time Trial (IMPLEMENTATION §M8b step 7). */
export interface TrialHud {
  /** This track's medal times. */
  medalTimes: Readonly<Record<Medal, number>>;
  /** The best medal held before this run. */
  held: Medal | null;
  /** The best ghost's lap times (the splits are measured against them), or null when there is none. */
  bestLaps: readonly number[] | null;
}

/** The split at the end of lap `lap` (1-based): the player's elapsed time minus the best ghost's, or null. */
export function trialSplit(myLaps: readonly number[], bestLaps: readonly number[] | null, lap: number): number | null {
  if (!bestLaps || lap < 1 || lap > bestLaps.length || lap > myLaps.length) return null;
  let d = 0;
  for (let i = 0; i < lap; i++) d += myLaps[i] - bestLaps[i];
  return d;
}

/** The split as shown: ▲ −0.42 (ahead of the best) or ▼ +0.42 (behind), so colour is never the only cue. */
export function formatSplit(d: number): string {
  const a = Math.abs(d).toFixed(2);
  return d <= 0 ? `▲ −${a}` : `▼ +${a}`;
}

const MEDAL_NAME: Readonly<Record<Medal, string>> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };

type ToastKind = 'info' | 'good' | 'warn' | 'bad' | 'record';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
  parent?: Element,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * A prompt line with keyboard, gamepad and (optionally) touch wording; CSS shows the one for the last-used device
 * (tokens.css). A prompt with no touch wording is hidden while touch is in use.
 */
function prompt(cls: string, keyboard: string, pad: string, parent: Element, touch?: string): HTMLElement {
  const node = el('div', touch === undefined ? `${cls} mz-no-touch` : cls, undefined, parent);
  el('span', 'mz-k-kb', keyboard, node);
  el('span', 'mz-k-pad', pad, node);
  if (touch !== undefined) el('span', 'mz-k-touch', touch, node);
  return node;
}

/** A class on <html> (the App's device and comfort classes); false without a real document (tests). */
function rootHas(cls: string): boolean {
  return typeof document !== 'undefined' && document.documentElement?.classList?.contains(cls) === true;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

/** A skewed neon panel: outer element carries the skew, `.mz-in` counter-skews the content. */
function panel(cls: string, parent: Element): { outer: HTMLDivElement; inner: HTMLDivElement } {
  const outer = el('div', `mz-panel ${cls}`, undefined, parent);
  const inner = el('div', 'mz-in', undefined, outer);
  return { outer, inner };
}

/** textContent writer that only touches the DOM when the value changes. */
class Txt {
  private last = '';
  constructor(readonly node: HTMLElement) {}
  set(v: string): void {
    if (v !== this.last) {
      this.last = v;
      this.node.textContent = v;
    }
  }
}

function polar(cx: number, cy: number, r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
}

export class HUD implements IHUD {
  private readonly container: HTMLDivElement;
  private readonly minimap: Minimap;
  private readonly muteButtons: HTMLButtonElement[] = [];

  // race HUD nodes
  private readonly posNum: Txt;
  private readonly posSuf: Txt;
  private readonly posTotal: Txt;
  private readonly posEl: HTMLElement;
  private readonly lapNum: Txt;
  private readonly lapOf: Txt;
  private readonly raceTime: Txt;
  private readonly lapTime: Txt;
  private readonly lapList: HTMLElement;
  private readonly energyBox: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly energyVal: Txt;
  private readonly boostBox: HTMLElement;
  private readonly boostText: Txt;
  private readonly itemsBox: HTMLElement;
  private readonly itemsName: Txt;
  private readonly itemsVal: Txt;
  private readonly itemsShield: Txt;
  private readonly itemsKinds: { node: HTMLElement; txt: Txt }[] = [];
  private readonly warnBox: HTMLElement;
  private readonly draftBox: HTMLElement;
  private readonly windBox: HTMLElement;
  private readonly introEl: HTMLElement;
  private readonly roster: readonly RosterEntry[];
  private shownItems: string | null | undefined = undefined;
  private readonly speedBox: HTMLElement;
  private readonly speedArc: SVGPathElement;
  /** A wide faint copy of the arc under it: the glow, without a CSS filter re-rasterised every frame. */
  private readonly speedGlow: SVGPathElement;
  private readonly speedNum: Txt;
  /** The touch HUD's power-and-speed strip (shown under html.mz-touch instead of the power, boost and speed panels). */
  private readonly strip: HTMLElement;
  private readonly stripFill: HTMLElement;
  private readonly stripVal: Txt;
  private readonly stripSpeed: Txt;
  private readonly stripBoost: HTMLElement;
  private readonly touch: TouchControls | null = null;
  /** Colour-blind mode is on (html.mz-cb), read once per frame. */
  private cb = false;
  /** The hazard cue (M7c, colour-blind mode): spots built once per track, a chip shown while one is near. */
  private readonly cueSpots: readonly CueSpot[];
  private readonly cueEl: HTMLElement;
  private readonly cueIcon: Txt;
  private readonly cueText: Txt;
  private shownCue = '';
  private readonly trackLength: number;
  /** ENABLE TILT on the intro card (M7c). */
  private tiltBtn: HTMLButtonElement | null = null;
  private readonly countdownEl: HTMLElement;
  private readonly wrongEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly pauseEl: HTMLElement;
  private readonly titleEl: HTMLElement | null = null;
  /** Credits paid for this race (economy:credits), shown on the results screen. */
  private earned: { delta: number; total: number } | null = null;

  // cached values
  private shownState: RaceState | null = null;
  private shownCountdown = -2;
  private shownWrong = false;
  private shownPos = -1;
  private shownField = -1;
  private shownEnergyQ = -1;
  private shownEnergyHue = -1;
  private shownEnergyLow = false;
  private shownPit = false;
  private shownBoost = '';
  private shownBoosting = false;
  private shownArcQ = -1;
  private lapListKey = '';
  private speedDisp = 0;
  private muted = false;
  private readonly toastLast = new Map<string, number>();
  private readonly toastNodes: HTMLElement[] = [];
  private readonly offs: Array<() => void> = [];
  /** False when the App's results screen replaces the HUD's results panel (IMPLEMENTATION §M8a). */
  private readonly showResults: boolean;
  /** Time Trial (M8b): the target row, the split chip and the dev ghost's tag. */
  private readonly trial: TrialHud | null;
  private readonly targetEl: HTMLElement | null = null;
  private readonly targetMedal: HTMLElement | null = null;
  private readonly targetTime: Txt | null = null;
  private readonly splitEl: HTMLElement | null = null;
  private readonly splitTxt: Txt | null = null;
  private readonly tagEl: HTMLElement | null = null;
  private splitLeft = 0;
  private readonly myLaps: number[] = [];
  private shownTag = '';

  constructor(
    root: HTMLElement,
    bus: GameBus,
    track: TrackData,
    private readonly actions: HudActions,
    opts: { showTitle?: boolean; results?: boolean; roster?: readonly RosterEntry[]; touch?: TouchRig; trial?: TrialHud } = {},
  ) {
    this.roster = opts.roster ?? [];
    this.trial = opts.trial ?? null;
    this.showResults = opts.results !== false;
    const c = el('div', 'mz-hud');
    c.dataset.state = 'title';
    if (this.trial) c.dataset.mode = 'trial';
    root.appendChild(c);
    this.container = c;

    // ------------------------------------------------------------ title (v1 start screen; the menu UI replaces it)
    if (opts.showTitle !== false) {
      const title = el('section', 'mz-screen mz-title', undefined, c);
      this.titleEl = title;
      el('div', 'mz-logo', 'MACHZERO', title);
      el('p', 'mz-sub', 'ANTI-GRAVITY RACING', title);
      const controls = el('div', 'mz-controls', undefined, title);
      const kb = el('div', undefined, undefined, controls);
      el('h4', undefined, 'KEYBOARD', kb);
      for (const [k, v] of [
        ['W / ↑', 'THRUST'],
        ['S / ↓', 'BRAKE'],
        ['A D / ← →', 'STEER'],
        ['Q  E', 'AIR-BRAKES'],
        ['SPACE / SHIFT', 'BOOST (LAP 2+)'],
        this.actions.cup ? ['ESC  M', 'PAUSE  MUTE'] : ['ESC  M  R', 'PAUSE  MUTE  RESTART'],
      ]) {
        const row = el('div', 'row', undefined, kb);
        el('kbd', undefined, k, row);
        el('span', undefined, v, row);
      }
      const gp = el('div', undefined, undefined, controls);
      el('h4', undefined, 'GAMEPAD', gp);
      for (const [k, v] of [
        ['LEFT STICK', 'STEER'],
        ['RT / Ⓐ', 'THRUST'],
        ['LT / Ⓑ', 'BRAKE'],
        ['LB  RB', 'AIR-BRAKES'],
        ['Ⓧ / Ⓨ', 'BOOST (LAP 2+)'],
        ['START', 'PAUSE'],
      ]) {
        const row = el('div', 'row', undefined, gp);
        el('kbd', undefined, k, row);
        el('span', undefined, v, row);
      }
      const start = this.button('mz-btn big', 'PRESS ENTER / Ⓐ / CLICK TO RACE', () => this.actions.onStart(), title);
      start.addEventListener('click', (e) => e.stopPropagation());
      this.addMute(title);
      el('div', 'mz-start-hint', `${CONFIG.TOTAL_LAPS} LAPS  •  7 RIVALS  •  ONE TRACK`, title);
      title.addEventListener('click', () => this.actions.onStart());
    }

    // ------------------------------------------------------------ race HUD
    const race = el('section', 'mz-race', undefined, c);

    this.posEl = el('div', 'mz-pos', undefined, race);
    const pn = el('span', 'mz-num mz-pos-num', '-', this.posEl);
    const ps = el('span', 'mz-num mz-pos-suf', '', this.posEl);
    const pt = el('span', 'mz-num mz-pos-total', '', this.posEl);
    this.posNum = new Txt(pn);
    this.posSuf = new Txt(ps);
    this.posTotal = new Txt(pt);

    const lapBox = panel('mz-lapbox', race);
    const lapRow = el('div', 'mz-lap', undefined, lapBox.inner);
    el('span', 'mz-label', 'LAP', lapRow);
    const ln = el('span', 'mz-num mz-lap-num', '1', lapRow);
    const lo = el('span', 'mz-num mz-lap-of', `/${CONFIG.TOTAL_LAPS}`, lapRow);
    this.lapNum = new Txt(ln);
    this.lapOf = new Txt(lo);
    const tRow = el('div', 'mz-timerow', undefined, lapBox.inner);
    const t1 = el('div', undefined, undefined, tRow);
    el('span', 'mz-label', 'LAP ', t1);
    const lt = el('span', 'mz-num', formatTime(0), t1);
    const t2 = el('div', 'dim', undefined, tRow);
    el('span', 'mz-label', 'TIME ', t2);
    const rt = el('span', 'mz-num', formatTime(0), t2);
    this.lapTime = new Txt(lt);
    this.raceTime = new Txt(rt);
    if (this.trial) {
      // TARGET: the next medal's total time, with its name (not colour alone).
      this.targetEl = el('div', 'mz-target', undefined, lapBox.inner);
      el('span', 'mz-label', 'TARGET ', this.targetEl);
      this.targetMedal = el('span', 'mz-medal', '', this.targetEl);
      this.targetTime = new Txt(el('span', 'mz-num', '', this.targetEl));
      this.setTarget(this.trial.held);
      // Beside the lap box (the toasts use the space under it).
      this.splitEl = el('div', 'mz-split', undefined, lapBox.outer);
      this.splitEl.setAttribute('role', 'status');
      this.splitTxt = new Txt(el('span', 'mz-num', '', this.splitEl));
      this.splitEl.hidden = true;
      this.tagEl = el('div', 'mz-ghost-tag', 'DEV', c);
      this.tagEl.hidden = true;
    }

    const mapBox = panel('mz-mapbox', race);
    this.minimap = new Minimap(track, 180);
    mapBox.inner.appendChild(this.minimap.canvas);

    const laps = panel('mz-laps', race);
    this.lapList = laps.inner;

    const energy = panel('mz-energy', race);
    this.energyBox = energy.outer;
    const eh = el('div', 'mz-energy-head', undefined, energy.inner);
    el('span', 'mz-label', 'POWER', eh);
    el('span', 'mz-label mz-pit-tag', 'RECHARGING', eh);
    const ev = el('span', 'mz-num mz-energy-val', '100', eh);
    this.energyVal = new Txt(ev);
    const bar = el('div', 'mz-bar', undefined, energy.inner);
    this.energyFill = el('div', 'mz-bar-fill', undefined, bar);

    const boost = panel('mz-boost', race);
    this.boostBox = boost.outer;
    const bt = el('div', undefined, 'BOOST UNLOCKS LAP 2', boost.inner);
    this.boostText = new Txt(bt);
    this.boostBox.dataset.s = 'locked';

    const items = panel('mz-items', race);
    this.itemsBox = items.outer;
    const head = el('div', 'mz-items-head', undefined, items.inner);
    this.itemsName = new Txt(el('span', 'mz-label mz-items-name', '⚡ EMP', head));
    this.itemsVal = new Txt(el('span', 'mz-num mz-items-val', '0', head));
    prompt('mz-items-key', 'F', 'Ⓨ', head);
    this.itemsShield = new Txt(el('span', 'mz-num mz-items-shield', '', head));
    const kinds = el('div', 'mz-items-kinds', undefined, items.inner);
    for (const k of ITEM_KINDS) {
      const node = el('span', 'mz-items-kind', undefined, kinds);
      node.dataset.k = k;
      this.itemsKinds.push({ node, txt: new Txt(node) });
    }
    prompt('mz-items-key mz-items-pick', 'C', '◀ ▶', kinds);
    this.itemsBox.hidden = true;
    this.warnBox = el('div', 'mz-emp-warn', '⚠ EMP INCOMING', race);
    this.warnBox.hidden = true;
    // Slipstream: an icon-first chip while the player drafts (physics/Drafting.ts).
    this.draftBox = el('div', 'mz-draft', undefined, race);
    this.draftBox.setAttribute('role', 'status');
    el('span', 'mz-draft-icon', '≋', this.draftBox);
    el('span', 'mz-draft-text', 'DRAFT', this.draftBox);
    this.draftBox.hidden = true;
    // Crosswind: a chip with an arrow that points the way the gust pushes, while it pushes the player.
    this.windBox = el('div', 'mz-wind', undefined, race);
    this.windBox.setAttribute('role', 'status');
    el('span', 'mz-wind-icon', '➤', this.windBox);
    el('span', 'mz-wind-text', 'WIND', this.windBox);
    this.windBox.hidden = true;

    this.speedBox = el('div', 'mz-speed', undefined, race);
    const gauge = svg('svg', { viewBox: '0 0 200 200' }, this.speedBox);
    const defs = svg('defs', {}, gauge);
    const grad = svg('linearGradient', { id: 'mz-speed-grad', x1: '0', y1: '1', x2: '1', y2: '0' }, defs);
    svg('stop', { offset: '0%', 'stop-color': '#19f0ff' }, grad);
    svg('stop', { offset: '60%', 'stop-color': '#8a4dff' }, grad);
    svg('stop', { offset: '100%', 'stop-color': '#ff2bd6' }, grad);
    const r = 84;
    const d = `M ${polar(100, 100, r, 135)} A ${r} ${r} 0 1 1 ${polar(100, 100, r, 45)}`;
    svg('path', { class: 'arc-bg', d, pathLength: '100' }, gauge);
    this.speedGlow = svg('path', { class: 'arc-glow', d, pathLength: '100' }, gauge);
    this.speedArc = svg('path', { class: 'arc-fg', d, pathLength: '100' }, gauge);
    // tick at standard top speed (TOP_SPEED of BOOST_TOP_SPEED)
    const topPct = (CONFIG.TOP_SPEED / CONFIG.BOOST_TOP_SPEED) * 100;
    const tick = svg('path', { class: 'arc-tick', d, pathLength: '100' }, gauge);
    tick.style.strokeDasharray = `0.8 100`;
    tick.style.strokeDashoffset = String(-(topPct - 0.4));
    const read = el('div', 'mz-speed-read', undefined, this.speedBox);
    const sn = el('div', 'mz-num mz-speed-num', '0', read);
    el('div', 'mz-label mz-speed-unit', 'KM/H', read);
    this.speedNum = new Txt(sn);

    // Touch HUD (IMPLEMENTATION §M7b): power, speed and the boost state in one strip between the thumbs.
    this.strip = el('div', 'mz-strip', undefined, race);
    const sp = el('div', 'mz-strip-power', undefined, this.strip);
    const sph = el('div', 'mz-strip-head', undefined, sp);
    el('span', 'mz-label', 'POWER', sph);
    el('span', 'mz-label mz-pit-tag', 'RECHARGING', sph);
    this.stripVal = new Txt(el('span', 'mz-num mz-strip-val', '100', sph));
    const sbar = el('div', 'mz-bar', undefined, sp);
    this.stripFill = el('div', 'mz-bar-fill', undefined, sbar);
    const ss = el('div', 'mz-strip-speed', undefined, this.strip);
    this.stripSpeed = new Txt(el('span', 'mz-num', '0', ss));
    el('span', 'mz-label', 'KM/H', ss);
    this.stripBoost = el('div', 'mz-strip-boost', undefined, this.strip);
    el('span', 'mz-strip-lock', '🔒', this.stripBoost);
    el('span', 'mz-strip-boost-text', 'BOOST', this.stripBoost);
    this.stripBoost.dataset.s = 'locked';
    if (opts.touch) this.touch = new TouchControls(race, opts.touch);

    // Hazard cue (colour-blind mode): an icon and the way to the clear side.
    this.trackLength = track.length;
    this.cueSpots = buildCueSpots(track);
    this.cueEl = el('div', 'mz-hazard', undefined, race);
    this.cueEl.setAttribute('role', 'status');
    this.cueIcon = new Txt(el('span', 'mz-hazard-icon', '', this.cueEl));
    this.cueText = new Txt(el('span', 'mz-hazard-text', '', this.cueEl));
    this.cueEl.hidden = true;

    // ------------------------------------------------------------ overlays
    this.countdownEl = el('div', 'mz-countdown', undefined, c);
    this.wrongEl = el('div', 'mz-wrongway', undefined, c);
    el('span', undefined, 'WRONG WAY', this.wrongEl);
    this.toastsEl = el('div', 'mz-toasts', undefined, c);
    this.toastsEl.setAttribute('role', 'status');
    this.toastsEl.setAttribute('aria-live', 'polite');

    const pause = el('section', 'mz-screen mz-pause', undefined, c);
    this.pauseEl = pause;
    el('h1', 'mz-heading', 'PAUSED', pause);
    const prow = el('div', 'mz-btnrow', undefined, pause);
    // A Grand Prix cup race can't be restarted: RETIRE (no points from this race) replaces RESTART and MENU.
    const cup = this.actions.cup;
    this.button('mz-btn', 'RESUME', () => this.actions.onResume(), prow);
    if (!cup) this.button('mz-btn', 'RESTART', () => this.actions.onRestart(), prow);
    if (this.actions.onSettings) this.button('mz-btn', 'SETTINGS', () => this.actions.onSettings?.(), prow);
    if (cup) this.button('mz-btn danger', 'RETIRE', () => cup.onRetire(), prow);
    else if (this.actions.onMenu) this.button('mz-btn', 'MENU', () => this.actions.onMenu?.(), prow);
    this.addMute(prow);
    if (cup) prompt('mz-hint', 'ESC RESUME  •  M MUTE  •  RETIRE SCORES NO POINTS', 'Ⓐ / START RESUME  •  ✥ CHOOSE  •  RETIRE SCORES NO POINTS', pause, 'RETIRE SCORES NO POINTS');
    else prompt('mz-hint', 'ESC RESUME  •  R RESTART  •  M MUTE', `Ⓐ / START RESUME  •  ✥ CHOOSE${this.actions.onMenu ? '  •  Ⓑ MENU' : ''}`, pause);

    this.resultsEl = el('section', 'mz-screen mz-results', undefined, c);

    // ------------------------------------------------------------ pilot intro card (before the countdown)
    this.introEl = el('section', 'mz-intro', undefined, c);
    this.buildIntro(track.name);

    // ------------------------------------------------------------ events
    this.offs.push(
      bus.on('race:lap', (e) => {
        if (e.shipId !== PLAYER_ID) return;
        if (this.trial) this.showSplit(e.lap, e.lapTime);
        if (e.isRecord) this.toast('NEW RECORD', 'record');
        if (e.lap === 1) this.toast('BOOST UNLOCKED', 'good');
        if (e.lap === CONFIG.TOTAL_LAPS - 1) this.toast('FINAL LAP', 'warn');
      }),
      bus.on('race:finish', (e) => {
        if (e.shipId === PLAYER_ID) this.toast(this.trial ? `FINISH  ${formatTime(e.totalTime)}` : `FINISH  ${ordinal(e.position)}`, e.position === 1 ? 'good' : 'info');
      }),
      bus.on('ship:lowEnergy', (e) => {
        if (e.shipId === PLAYER_ID) this.toast('LOW POWER', 'bad', true);
      }),
      bus.on('ship:pit', (e) => {
        if (e.shipId === PLAYER_ID && e.active) this.toast('PIT', 'info', true);
      }),
      bus.on('ship:destroyed', (e) => {
        if (e.shipId === PLAYER_ID) this.toast('RETIRED', 'bad');
      }),
      bus.on('race:state', (e) => {
        if (e.state === 'title' || e.state === 'results' || e.prev === 'results') this.clearToasts();
        if (e.state === 'title' || e.state === 'countdown') this.earned = null;
        if (e.state === 'countdown' || e.state === 'title') this.resetTrial();
        if (e.state === 'title' || e.state === 'results') this.draftBox.hidden = this.windBox.hidden = true;
      }),
      bus.on('economy:credits', (e) => (this.earned = e)),
      bus.on('ship:draft', (e) => {
        if (e.shipId === PLAYER_ID) this.draftBox.hidden = !e.active;
      }),
      bus.on('ship:wind', (e) => {
        if (e.shipId !== PLAYER_ID) return;
        this.windBox.hidden = !e.active;
        this.windBox.classList.toggle('left', e.dir < 0);
        this.windBox.setAttribute('aria-label', e.dir < 0 ? 'Crosswind pushing left' : 'Crosswind pushing right');
      }),
      bus.on('hazard:lightning', (e) => {
        if (e.shipId === PLAYER_ID) this.toast('⚡ LIGHTNING STRIKE', 'bad');
      }),
      bus.on('hazard:geyser', (e) => {
        if (e.shipId === PLAYER_ID) this.toast('🌋 LAVA GEYSER', 'bad');
      }),
      bus.on('hazard:jet', (e) => {
        if (e.shipId === PLAYER_ID) this.toast('🫧 PRESSURE JET', 'bad');
      }),
      bus.on('item:emp', (e) => {
        if (e.from === PLAYER_ID) this.toast(`EMP → ${e.targetName}`, 'good');
        else if (e.target === PLAYER_ID) this.toast('EMP HIT', 'bad');
      }),
      bus.on('item:fail', (e) => {
        if (e.shipId === PLAYER_ID) this.toast(e.reason === 'empty' ? `NO ${ITEM_NAMES[e.kind]} LEFT` : 'NO TARGET AHEAD', 'warn', true);
      }),
      bus.on('item:use', (e) => {
        if (e.shipId === PLAYER_ID) this.toast(e.kind === 'shield' ? '🛡 SHIELD UP' : '✷ MINE DROPPED', 'good', true);
      }),
      bus.on('item:shield', (e) => {
        if (e.shipId === PLAYER_ID) this.toast(e.blocked === 'emp' ? '🛡 EMP BLOCKED' : e.blocked === 'mine' ? '🛡 MINE BLOCKED' : e.blocked === 'geyser' ? '🛡 GEYSER BLOCKED' : e.blocked === 'jet' ? '🛡 JET BLOCKED' : '🛡 LIGHTNING BLOCKED', 'good');
      }),
    );
    this.offs.push(bus.on('audio:mute', (e) => this.setMuted(e.muted)));
  }

  /** The player's items (selected kind, counts, shield, incoming EMP), or null when they carry none (chip hidden). */
  setItems(v: ItemView | null): void {
    const key = v === null ? null : `${v.selected}|${v.counts.emp},${v.counts.shield},${v.counts.mine}|${v.shield > 0 ? Math.ceil(v.shield) : 0}|${v.incoming > 0 ? 1 : 0}`;
    if (key === this.shownItems) return;
    this.shownItems = key;
    this.touch?.setItems(v);
    this.itemsBox.hidden = v === null;
    this.warnBox.hidden = v === null || v.incoming <= 0;
    if (v === null) return;
    const n = v.counts[v.selected];
    this.itemsName.set(`${ITEM_ICONS[v.selected]} ${ITEM_NAMES[v.selected]}`);
    this.itemsVal.set(`×${n}`);
    this.itemsShield.set(v.shield > 0 ? `🛡 ${Math.ceil(v.shield)}s` : '');
    ITEM_KINDS.forEach((k, i) => {
      const chip = this.itemsKinds[i];
      chip.txt.set(`${ITEM_ICONS[k]}${v.counts[k]}`);
      chip.node.dataset.sel = k === v.selected ? '1' : '0';
    });
    this.itemsBox.dataset.s = v.shield > 0 ? 'shield' : n > 0 ? 'ready' : 'empty';
  }

  /** Unsubscribe and remove the DOM (RaceSession.dispose). */
  dispose(): void {
    this.touch?.dispose();
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.clearToasts();
    this.container.remove?.();
  }

  update(snap: RaceSnapshot, dt: number, hazardTime = 0, ghosts?: readonly GhostFrame[], tag?: { readonly x: number; readonly y: number; readonly visible: boolean } | null): void {
    this.cb = rootHas('mz-cb');
    if (snap.state !== this.shownState) this.applyState(snap);
    this.updateCountdown(snap.countdown, snap.state);
    if (this.trial) this.updateTrial(dt, snap.state, tag ?? null);
    if (snap.state === 'title' || snap.state === 'results') return;
    if (this.touch) this.touch.update(!this.introShown && (snap.state === 'racing' || snap.state === 'countdown') && rootHas('mz-touch'));

    const p = snap.player;
    this.updateCue(p, hazardTime);

    // position
    let pos = 0;
    for (let i = 0; i < snap.standings.length; i++) {
      if (snap.standings[i].id === PLAYER_ID) {
        pos = snap.standings[i].position;
        break;
      }
    }
    if (snap.standings.length !== this.shownField) {
      this.shownField = snap.standings.length;
      this.posTotal.set(`/${this.shownField}`);
    }
    if (pos > 0 && pos !== this.shownPos) {
      if (this.shownPos > 0 && snap.state === 'racing') {
        this.posEl.classList.remove('pop');
        void this.posEl.offsetWidth;
        this.posEl.classList.add('pop');
      }
      this.shownPos = pos;
      const o = ordinal(pos);
      this.posNum.set(String(pos));
      this.posSuf.set(o.slice(String(pos).length).toUpperCase());
    }

    // laps & times
    this.lapNum.set(String(snap.lap));
    this.lapOf.set(`/${snap.totalLaps}`);
    this.lapTime.set(formatTime(snap.currentLapTime));
    this.raceTime.set(formatTime(snap.raceTime));
    this.updateLapList(snap);

    // energy
    const eMax = p.def.stats.energyMax;
    const e = clamp(p.energy, 0, eMax);
    const ePct = (e / eMax) * 100;
    const eq = Math.round(ePct * 2) / 2;
    if (eq !== this.shownEnergyQ) {
      this.shownEnergyQ = eq;
      this.energyFill.style.transform = `scaleX(${(eq / 100).toFixed(3)})`;
      this.stripFill.style.transform = this.energyFill.style.transform;
      this.energyVal.set(String(Math.ceil(e)));
      this.stripVal.set(String(Math.ceil(e)));
      const hue = Math.round((clamp(ePct / 60, 0, 1) * 130) / 4) * 4; // red at 0 → amber ~30 → green ≥ 60
      if (hue !== this.shownEnergyHue) {
        this.shownEnergyHue = hue;
        this.energyFill.style.setProperty('--h', String(hue));
        this.stripFill.style.setProperty('--h', String(hue));
      }
    }
    const low = ePct < CONFIG.LOW_ENERGY_THRESHOLD && snap.state === 'racing';
    if (low !== this.shownEnergyLow) {
      this.shownEnergyLow = low;
      this.energyBox.classList.toggle('low', low);
      this.strip.classList.toggle('low', low);
    }
    if (p.inPit !== this.shownPit) {
      this.shownPit = p.inPit;
      this.energyBox.classList.toggle('pit', p.inPit);
      this.strip.classList.toggle('pit', p.inPit);
    }

    // boost indicator
    let bs: string;
    let label: string;
    if (p.empLock > 0) {
      bs = 'jammed';
      label = '⚡ BOOST JAMMED';
    } else if (!p.boostUnlocked) {
      bs = 'locked';
      label = 'BOOST UNLOCKS LAP 2';
    } else if (p.boosting) {
      bs = 'active';
      label = 'BOOSTING';
    } else if (e > p.def.stats.boostCost) {
      bs = 'ready';
      label = 'BOOST READY';
    } else {
      bs = 'charging';
      label = 'CHARGING';
    }
    if (bs !== this.shownBoost) {
      this.shownBoost = bs;
      this.boostBox.dataset.s = bs;
      this.stripBoost.dataset.s = bs;
      this.boostText.set(label);
    }

    // speedometer
    this.speedDisp = damp(this.speedDisp, p.speed * CONFIG.SPEED_DISPLAY_SCALE, 14, dt);
    if (Math.abs(this.speedDisp - p.speed * CONFIG.SPEED_DISPLAY_SCALE) < 0.5) this.speedDisp = p.speed * CONFIG.SPEED_DISPLAY_SCALE;
    this.speedNum.set(String(Math.round(this.speedDisp)));
    this.stripSpeed.set(String(Math.round(this.speedDisp)));
    const aq = Math.round(clamp(this.speedDisp / GAUGE_MAX_KMH, 0, 1) * 200) / 2;
    if (aq !== this.shownArcQ) {
      this.shownArcQ = aq;
      const offset = (100 - aq).toFixed(1);
      this.speedArc.style.strokeDashoffset = offset;
      this.speedGlow.style.strokeDashoffset = offset;
    }
    if (p.boosting !== this.shownBoosting) {
      this.shownBoosting = p.boosting;
      this.speedBox.classList.toggle('boosting', p.boosting);
    }

    // wrong way
    if (snap.wrongWay !== this.shownWrong) {
      this.shownWrong = snap.wrongWay;
      this.wrongEl.classList.toggle('on', snap.wrongWay);
    }

    if (snap.state !== 'paused') {
      const leader = snap.standings.length > 0 ? snap.standings[0].id : -1;
      this.minimap.update(snap.ships.length > 0 ? snap.ships : [p], p, leader, this.cb, ghosts);
    }
  }

  // ---------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------

  /** The hazard cue chip (colour-blind mode only; quiet on a split path and when not racing). */
  private updateCue(p: RaceSnapshot['player'], hazardTime: number): void {
    const cue = this.cb && p.status === 'racing' && p.path === null ? hazardCue(this.cueSpots, p.trackU * this.trackLength, p.lateral, p.speed, hazardTime, this.trackLength) : null;
    const key = cue ? `${cue.kind}|${cue.side}` : '';
    if (key === this.shownCue) return;
    this.shownCue = key;
    this.cueEl.hidden = cue === null;
    if (!cue) return;
    this.cueIcon.set(HAZARD_ICONS[cue.kind]);
    this.cueText.set(cue.side === -1 ? `◀ ${HAZARD_NAMES[cue.kind]}` : cue.side === 1 ? `${HAZARD_NAMES[cue.kind]} ▶` : HAZARD_NAMES[cue.kind]);
    this.cueEl.dataset.side = String(cue.side);
  }

  /** TARGET: the medal above `held` and its time; with gold held, the best time to beat. */
  private setTarget(held: Medal | null): void {
    const t = this.trial;
    if (!t || !this.targetMedal || !this.targetTime) return;
    const order: Medal[] = ['bronze', 'silver', 'gold'];
    const next = order[held ? order.indexOf(held) + 1 : 0];
    if (next) {
      this.targetMedal.textContent = MEDAL_NAME[next];
      this.targetMedal.dataset.medal = next;
      this.targetTime.set(formatTime(t.medalTimes[next]));
    } else {
      this.targetMedal.textContent = 'BEST';
      this.targetMedal.dataset.medal = 'best';
      this.targetTime.set(t.bestLaps ? formatTime(t.bestLaps.reduce((a, b) => a + b, 0)) : formatTime(t.medalTimes.gold));
    }
  }

  private showSplit(lap: number, lapTime: number): void {
    this.myLaps[lap - 1] = lapTime;
    const d = trialSplit(this.myLaps, this.trial?.bestLaps ?? null, lap);
    if (d === null || !this.splitEl || !this.splitTxt) return;
    this.splitTxt.set(formatSplit(d));
    this.splitEl.dataset.s = d <= 0 ? 'ahead' : 'behind';
    this.splitEl.setAttribute('aria-label', d <= 0 ? `${Math.abs(d).toFixed(2)} seconds ahead of your best` : `${d.toFixed(2)} seconds behind your best`);
    this.splitEl.hidden = false;
    this.splitLeft = SPLIT_SECONDS;
  }

  private resetTrial(): void {
    this.myLaps.length = 0;
    this.splitLeft = 0;
    if (this.splitEl) this.splitEl.hidden = true;
  }

  private updateTrial(dt: number, state: RaceState, tag: { readonly x: number; readonly y: number; readonly visible: boolean } | null): void {
    if (this.splitLeft > 0 && state !== 'paused') {
      this.splitLeft -= dt;
      if (this.splitLeft <= 0 && this.splitEl) this.splitEl.hidden = true;
    }
    const el = this.tagEl;
    if (!el) return;
    const show = tag !== null && tag.visible && (state === 'racing' || state === 'countdown');
    const key = show ? `${(tag.x * 1000) | 0},${(tag.y * 1000) | 0}` : '';
    if (key === this.shownTag) return;
    this.shownTag = key;
    el.hidden = !show;
    if (show) el.style.transform = `translate(${(tag.x * 100).toFixed(1)}vw, ${(tag.y * 100).toFixed(1)}vh) translate(-50%, -100%)`;
  }

  private applyState(snap: RaceSnapshot): void {
    const prev = this.shownState;
    this.shownState = snap.state;
    this.container.dataset.state = snap.state;
    if (snap.state !== 'racing' && snap.state !== 'countdown') this.touch?.release();
    if (snap.state === 'results' && this.showResults) this.buildResults(snap);
    if (prev === 'results' || snap.state === 'title') {
      this.shownPos = -1;
      this.shownBoost = '';
      this.shownEnergyQ = -1;
      this.lapListKey = '';
      this.speedDisp = 0;
    }
  }

  private updateCountdown(value: number, state: RaceState): void {
    if (value === this.shownCountdown) return;
    this.shownCountdown = value;
    const node = this.countdownEl;
    node.textContent = '';
    if (value < 0 || state === 'title' || state === 'results') {
      node.classList.remove('on', 'go');
      return;
    }
    const s = el('span', undefined, value === 0 ? 'GO!' : String(value), node);
    s.className = 'mz-num';
    node.classList.add('on');
    node.classList.toggle('go', value === 0);
  }

  private updateLapList(snap: RaceSnapshot): void {
    const key = `${snap.lapTimes.length}|${snap.bestLap}|${snap.recordLap}`;
    if (key === this.lapListKey) return;
    this.lapListKey = key;
    const box = this.lapList;
    box.textContent = '';
    for (let i = 0; i < snap.lapTimes.length; i++) {
      const row = el('div', 'row', undefined, box);
      if (snap.bestLap !== null && snap.lapTimes[i] === snap.bestLap) row.classList.add('best');
      el('span', 'k', `LAP ${i + 1}`, row);
      el('span', undefined, formatTime(snap.lapTimes[i]), row);
    }
    if (snap.lapTimes.length > 0) el('div', 'sep', undefined, box);
    const best = el('div', 'row best', undefined, box);
    el('span', 'k', 'BEST', best);
    el('span', undefined, formatTime(snap.bestLap), best);
    const rec = el('div', 'row rec', undefined, box);
    el('span', 'k', 'RECORD', rec);
    el('span', undefined, formatTime(snap.recordLap), rec);
  }

  private buildResults(snap: RaceSnapshot): void {
    const root = this.resultsEl;
    root.textContent = '';
    const me = snap.standings.find((s) => s.id === PLAYER_ID);
    const retired = snap.player.status === 'retired';
    let heading: string;
    let cls = 'mz-heading';
    if (retired) {
      heading = 'RETIRED';
      cls += ' bad';
    } else if (me) {
      heading = me.position === 1 ? 'VICTORY' : `${ordinal(me.position).toUpperCase()} PLACE`;
      if (me.position === 1) cls += ' gold';
    } else {
      heading = 'RACE OVER';
    }
    el('h1', cls, heading, root);
    if (this.earned) {
      const cr = el('div', 'mz-credits', undefined, root);
      el('span', 'delta', `+${this.earned.delta.toLocaleString('en-US')} CREDITS`, cr);
      el('span', 'total', `${this.earned.total.toLocaleString('en-US')} IN THE BANK`, cr);
    }

    const body = el('div', 'mz-results-body', undefined, root);

    const table = el('div', 'mz-table', undefined, body);
    el('div', 'head', 'FINAL STANDINGS', table);
    for (const s of snap.standings) table.appendChild(this.standingRow(s));
    // A rival who wins gets the last word.
    const winner = snap.standings.find((s) => s.position === 1);
    const quote = winner && winner.id !== PLAYER_ID ? this.roster.find((r) => r.id === winner.id)?.catchphrase : null;
    if (winner && quote) el('div', 'mz-winner-quote', `“${quote}” — ${winner.name}`, table);

    const lapsBox = el('div', 'mz-lapstable', undefined, body);
    el('div', 'head', 'YOUR LAPS', lapsBox);
    if (snap.lapTimes.length === 0) {
      const row = el('div', 'row', undefined, lapsBox);
      el('span', undefined, 'NO LAPS COMPLETED', row);
    }
    for (let i = 0; i < snap.lapTimes.length; i++) {
      const row = el('div', 'row', undefined, lapsBox);
      if (snap.bestLap !== null && snap.lapTimes[i] === snap.bestLap) row.classList.add('best');
      el('span', undefined, `LAP ${i + 1}`, row);
      el('span', undefined, formatTime(snap.lapTimes[i]), row);
    }
    const sep = el('div', 'head', undefined, lapsBox);
    sep.style.marginTop = '0.8em';
    sep.textContent = 'BEST LAP';
    const bestRow = el('div', 'row best', undefined, lapsBox);
    el('span', undefined, formatTime(snap.bestLap), bestRow);
    const recRow = el('div', 'row', undefined, lapsBox);
    el('span', undefined, 'RECORD', recRow);
    el('span', undefined, formatTime(snap.recordLap), recRow);
    if (snap.bestLap !== null && snap.recordLap !== null && Math.abs(snap.bestLap - snap.recordLap) < 1e-6) {
      el('div', 'mz-record', 'NEW LAP RECORD', lapsBox);
    }

    const row = el('div', 'mz-btnrow', undefined, root);
    const cup = this.actions.cup;
    if (cup) {
      this.button('mz-btn big', 'CUP STANDINGS', () => cup.onStandings(), row);
      this.addMute(row);
      prompt('mz-hint', 'PRESS ENTER FOR THE CUP STANDINGS', 'Ⓐ CUP STANDINGS', root);
      return;
    }
    this.button('mz-btn big', 'RACE AGAIN', () => this.actions.onRestart(), row);
    if (this.actions.onMenu) this.button('mz-btn', 'MENU', () => this.actions.onMenu?.(), row);
    this.addMute(row);
    prompt('mz-hint', 'PRESS ENTER TO RACE AGAIN', `Ⓐ RACE AGAIN  •  ✥ CHOOSE${this.actions.onMenu ? '  •  Ⓑ MENU' : ''}`, root);
  }

  /** The full-screen panel on show (title, pause or results), for gamepad focus navigation; null while racing. */
  get overlay(): HTMLElement | null {
    switch (this.container.dataset.state) {
      case 'title':
        return this.titleEl;
      case 'paused':
        return this.pauseEl;
      case 'results':
        return this.resultsEl;
      default:
        return null;
    }
  }

  /** The grid intro card: every racer in grid order with portrait, ship and catchphrase. */
  private buildIntro(trackName: string): void {
    const root = this.introEl;
    el('div', 'mz-intro-kicker', trackName, root);
    el('h2', 'mz-intro-head', 'THE GRID', root);
    const grid = el('div', 'mz-intro-grid', undefined, root);
    for (const r of [...this.roster].sort((a, b) => a.gridIndex - b.gridIndex)) {
      const row = el('div', r.id === PLAYER_ID ? 'mz-intro-row player' : 'mz-intro-row', undefined, grid);
      el('span', 'slot', `P${r.gridIndex + 1}`, row);
      const face = el('span', 'face', undefined, row);
      face.innerHTML = r.portrait; // constant recipe markup (game/pilotPortrait.ts)
      const who = el('span', 'who', undefined, row);
      el('span', 'name', r.name, who);
      el('span', 'ship', r.ship, who);
      el('span', 'quote', r.catchphrase ? `“${r.catchphrase}”` : 'YOU', row);
    }
    if (this.actions.tilt) {
      const tilt = this.actions.tilt;
      const b = this.button('mz-btn mz-intro-tilt', 'ENABLE TILT', () => tilt.enable(), root);
      // The tap must not also skip the card: the permission prompt comes first.
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.tiltBtn = b;
    }
    prompt('mz-hint', 'PRESS ANY KEY TO SKIP', 'PRESS ANY BUTTON TO SKIP', root, 'TAP TO SKIP');
    root.addEventListener('pointerdown', () => this.actions.onSkipIntro?.());
  }

  /** Show or hide the grid intro card (App: before every race, ≈ 3 s, any input skips). */
  setIntro(on: boolean): void {
    this.container.classList.toggle('intro', on && this.roster.length > 0);
    if (this.tiltBtn) this.tiltBtn.hidden = !(on && this.actions.tilt?.needed());
    if (on) this.touch?.release();
  }

  get introShown(): boolean {
    return this.container.classList.contains('intro');
  }

  private standingRow(s: RacerStanding): HTMLElement {
    const row = el('div', s.id === PLAYER_ID ? 'row player' : 'row');
    el('span', 'pos', String(s.position), row);
    const who = el('span', 'who', undefined, row);
    const entry = this.roster.find((r) => r.id === s.id);
    if (entry) el('span', 'face', undefined, who).innerHTML = entry.portrait;
    el('span', undefined, s.name, who);
    let status: string;
    let time: string;
    if (s.status === 'finished') {
      status = 'FINISHED';
      time = formatTime(s.totalTime);
    } else if (s.status === 'retired') {
      status = 'RETIRED';
      time = 'DNF';
    } else {
      status = 'RACING';
      time = s.totalTime !== null ? `~${formatTime(s.totalTime)}` : 'DNF';
    }
    el('span', 'st', status, row);
    el('span', 'tm', time, row);
    return row;
  }

  private button(cls: string, text: string, onClick: () => void, parent: Element): HTMLButtonElement {
    const b = el('button', cls, undefined, parent);
    b.type = 'button';
    el('span', undefined, text, b);
    b.addEventListener('click', () => {
      onClick();
      b.blur(); // keep Enter/Space for the game, not for re-clicking this button
    });
    return b;
  }

  private addMute(parent: Element): void {
    const b = el('button', 'mz-chip', this.muteLabel(), parent);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.actions.onToggleMute();
      b.blur();
    });
    b.classList.toggle('off', this.muted);
    this.muteButtons.push(b);
  }

  private muteLabel(): string {
    return this.muted ? 'SOUND: OFF  (M)' : 'SOUND: ON  (M)';
  }

  private setMuted(muted: boolean): void {
    this.muted = muted;
    for (const b of this.muteButtons) {
      b.textContent = this.muteLabel();
      b.classList.toggle('off', muted);
    }
  }

  private toast(text: string, kind: ToastKind, debounce = false): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (debounce) {
      const last = this.toastLast.get(text) ?? -Infinity;
      if (now - last < 2500) return;
    }
    this.toastLast.set(text, now);
    const node = el('div', `mz-toast ${kind}${text.length > 12 ? ' small' : ''}`, text, this.toastsEl);
    this.toastNodes.push(node);
    while (this.toastNodes.length > MAX_TOASTS) this.toastNodes.shift()?.remove();
    setTimeout(() => {
      node.remove();
      const i = this.toastNodes.indexOf(node);
      if (i >= 0) this.toastNodes.splice(i, 1);
    }, TOAST_MS);
  }

  private clearToasts(): void {
    for (const n of this.toastNodes) n.remove();
    this.toastNodes.length = 0;
  }
}

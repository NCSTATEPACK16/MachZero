import { CONFIG } from '../core/config';
import type { HudActions, IHUD, RaceSnapshot, RaceState, RacerStanding, TrackData } from '../core/contracts';
import type { GameBus } from '../core/events';
import { clamp, damp, formatTime, ordinal } from '../core/math';
import { Minimap } from './Minimap';
import '../ui/tokens.css';
import './hud.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PLAYER_ID = 0;
const MAX_TOASTS = 3;
const TOAST_MS = 2300;
/** Arc gauge tops out at boost top speed so the boost range is visible on the dial. */
const GAUGE_MAX_KMH = CONFIG.BOOST_TOP_SPEED * CONFIG.SPEED_DISPLAY_SCALE;

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
  private readonly speedBox: HTMLElement;
  private readonly speedArc: SVGPathElement;
  private readonly speedNum: Txt;
  private readonly countdownEl: HTMLElement;
  private readonly wrongEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
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

  constructor(
    root: HTMLElement,
    bus: GameBus,
    track: TrackData,
    private readonly actions: HudActions,
    opts: { showTitle?: boolean } = {},
  ) {
    const c = el('div', 'mz-hud');
    c.dataset.state = 'title';
    root.appendChild(c);
    this.container = c;

    // ------------------------------------------------------------ title (v1 start screen; the menu UI replaces it)
    if (opts.showTitle !== false) {
      const title = el('section', 'mz-screen mz-title', undefined, c);
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
        ['ESC  M  R', 'PAUSE  MUTE  RESTART'],
      ]) {
        const row = el('div', 'row', undefined, kb);
        el('kbd', undefined, k, row);
        el('span', undefined, v, row);
      }
      const gp = el('div', undefined, undefined, controls);
      el('h4', undefined, 'GAMEPAD', gp);
      for (const [k, v] of [
        ['LEFT STICK', 'STEER'],
        ['RT', 'THRUST'],
        ['LT', 'BRAKE'],
        ['LB  RB', 'AIR-BRAKES'],
        ['A', 'BOOST (LAP 2+)'],
        ['START', 'PAUSE'],
      ]) {
        const row = el('div', 'row', undefined, gp);
        el('kbd', undefined, k, row);
        el('span', undefined, v, row);
      }
      const start = this.button('mz-btn big', 'PRESS ENTER / CLICK TO RACE', () => this.actions.onStart(), title);
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

    // ------------------------------------------------------------ overlays
    this.countdownEl = el('div', 'mz-countdown', undefined, c);
    this.wrongEl = el('div', 'mz-wrongway', undefined, c);
    el('span', undefined, 'WRONG WAY', this.wrongEl);
    this.toastsEl = el('div', 'mz-toasts', undefined, c);
    this.toastsEl.setAttribute('role', 'status');
    this.toastsEl.setAttribute('aria-live', 'polite');

    const pause = el('section', 'mz-screen mz-pause', undefined, c);
    el('h1', 'mz-heading', 'PAUSED', pause);
    const prow = el('div', 'mz-btnrow', undefined, pause);
    this.button('mz-btn', 'RESUME', () => this.actions.onResume(), prow);
    this.button('mz-btn', 'RESTART', () => this.actions.onRestart(), prow);
    if (this.actions.onSettings) this.button('mz-btn', 'SETTINGS', () => this.actions.onSettings?.(), prow);
    if (this.actions.onMenu) this.button('mz-btn', 'MENU', () => this.actions.onMenu?.(), prow);
    this.addMute(prow);
    el('div', 'mz-hint', 'ESC RESUME  •  R RESTART  •  M MUTE', pause);

    this.resultsEl = el('section', 'mz-screen mz-results', undefined, c);

    // ------------------------------------------------------------ events
    this.offs.push(
      bus.on('race:lap', (e) => {
        if (e.shipId !== PLAYER_ID) return;
        if (e.isRecord) this.toast('NEW RECORD', 'record');
        if (e.lap === 1) this.toast('BOOST UNLOCKED', 'good');
        if (e.lap === CONFIG.TOTAL_LAPS - 1) this.toast('FINAL LAP', 'warn');
      }),
      bus.on('race:finish', (e) => {
        if (e.shipId === PLAYER_ID) this.toast(`FINISH  ${ordinal(e.position)}`, e.position === 1 ? 'good' : 'info');
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
      }),
      bus.on('economy:credits', (e) => (this.earned = e)),
    );
    this.offs.push(bus.on('audio:mute', (e) => this.setMuted(e.muted)));
  }

  /** Unsubscribe and remove the DOM (RaceSession.dispose). */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.clearToasts();
    this.container.remove?.();
  }

  update(snap: RaceSnapshot, dt: number): void {
    if (snap.state !== this.shownState) this.applyState(snap);
    this.updateCountdown(snap.countdown, snap.state);
    if (snap.state === 'title' || snap.state === 'results') return;

    const p = snap.player;

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
      this.energyVal.set(String(Math.ceil(e)));
      const hue = Math.round((clamp(ePct / 60, 0, 1) * 130) / 4) * 4; // red at 0 → amber ~30 → green ≥ 60
      if (hue !== this.shownEnergyHue) {
        this.shownEnergyHue = hue;
        this.energyFill.style.setProperty('--h', String(hue));
      }
    }
    const low = ePct < CONFIG.LOW_ENERGY_THRESHOLD && snap.state === 'racing';
    if (low !== this.shownEnergyLow) {
      this.shownEnergyLow = low;
      this.energyBox.classList.toggle('low', low);
    }
    if (p.inPit !== this.shownPit) {
      this.shownPit = p.inPit;
      this.energyBox.classList.toggle('pit', p.inPit);
    }

    // boost indicator
    let bs: string;
    let label: string;
    if (!p.boostUnlocked) {
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
      this.boostText.set(label);
    }

    // speedometer
    this.speedDisp = damp(this.speedDisp, p.speed * CONFIG.SPEED_DISPLAY_SCALE, 14, dt);
    if (Math.abs(this.speedDisp - p.speed * CONFIG.SPEED_DISPLAY_SCALE) < 0.5) this.speedDisp = p.speed * CONFIG.SPEED_DISPLAY_SCALE;
    this.speedNum.set(String(Math.round(this.speedDisp)));
    const aq = Math.round(clamp(this.speedDisp / GAUGE_MAX_KMH, 0, 1) * 200) / 2;
    if (aq !== this.shownArcQ) {
      this.shownArcQ = aq;
      this.speedArc.style.strokeDashoffset = (100 - aq).toFixed(1);
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
      this.minimap.update(snap.ships.length > 0 ? snap.ships : [p], p);
    }
  }

  // ---------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------

  private applyState(snap: RaceSnapshot): void {
    const prev = this.shownState;
    this.shownState = snap.state;
    this.container.dataset.state = snap.state;
    if (snap.state === 'results') this.buildResults(snap);
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
    this.button('mz-btn big', 'RACE AGAIN', () => this.actions.onRestart(), row);
    if (this.actions.onMenu) this.button('mz-btn', 'MENU', () => this.actions.onMenu?.(), row);
    this.addMute(row);
    el('div', 'mz-hint', 'PRESS ENTER TO RACE AGAIN', root);
  }

  private standingRow(s: RacerStanding): HTMLElement {
    const row = el('div', s.id === PLAYER_ID ? 'row player' : 'row');
    el('span', 'pos', String(s.position), row);
    el('span', undefined, s.name, row);
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

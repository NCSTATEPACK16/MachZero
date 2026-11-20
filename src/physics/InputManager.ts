import { CONFIG } from '../core/config';
import type { ControlInput, IInputManager, KeyBindings, KeyControl, MenuAction } from '../core/contracts';
import { damp } from '../core/math';
import { neutralControls } from '../core/controls';
import type { TouchInput } from './TouchInput';
import { DEFAULT_PAD_BINDINGS, clonePadBindings, type PadBindings } from '../save/schema';

/** Menu actions produced by keys / buttons, in a fixed order (index used for edge bookkeeping). */
const MENU_ACTIONS: readonly MenuAction[] = ['pause', 'confirm', 'back', 'mute', 'restart', 'up', 'down', 'left', 'right'];

/** Default KeyboardEvent.code -> driving control (v1 layout; see save/schema DEFAULT_KEY_BINDINGS). */
const DEFAULT_CODE_TO_CONTROL: Readonly<Record<string, KeyControl>> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyQ: 'airLeft',
  KeyE: 'airRight',
  Space: 'boost',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyF: 'item',
  KeyC: 'itemNext',
};

/** KeyboardEvent.code -> menu actions triggered on key-down. */
const CODE_TO_MENU: Readonly<Record<string, readonly MenuAction[]>> = {
  Escape: ['pause'],
  KeyP: ['pause'],
  Enter: ['confirm'],
  NumpadEnter: ['confirm'],
  Backspace: ['back'],
  KeyM: ['mute'],
  KeyR: ['restart'],
  ArrowUp: ['up'],
  ArrowDown: ['down'],
  ArrowLeft: ['left'],
  ArrowRight: ['right'],
};

/** Fallback for events that carry no `code` (older browsers, synthetic events): lower-cased `key`. */
const KEY_TO_CODE: Readonly<Record<string, string>> = {
  w: 'KeyW',
  s: 'KeyS',
  a: 'KeyA',
  d: 'KeyD',
  q: 'KeyQ',
  e: 'KeyE',
  m: 'KeyM',
  p: 'KeyP',
  r: 'KeyR',
  ' ': 'Space',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  shift: 'ShiftLeft',
  escape: 'Escape',
  enter: 'Enter',
  backspace: 'Backspace',
};

/** Codes whose default browser behaviour (scrolling, history navigation) must be suppressed. */
const PREVENT_DEFAULT: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Backspace',
]);

/** Standard-mapping gamepad button indices. */
const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

const STICK_DEADZONE = 0.15;
const STICK_MENU_THRESHOLD = 0.6;
const TRIGGER_DEADZONE = 0.05;
/** Keyboard steering: approach rate toward the target (1/s), release rate, and reversal rate. */
const STEER_ATTACK = 9;
const STEER_RELEASE = 14;
const STEER_REVERSE = 10;
/** Unconsumed menu presses expire after this many update() ticks (0.25 s at 120 Hz). */
const MENU_EXPIRY_TICKS = 30;
/** A held d-pad direction or stick repeats its menu move after this delay, then at this interval (s). */
export const NAV_REPEAT_DELAY = 0.35;
export const NAV_REPEAT_EVERY = 0.12;
const NAV_DIRS = ['up', 'down', 'left', 'right'] as const;
/**
 * iOS can also turn controller d-pad / Ⓐ presses into arrow / Enter key events for the web view; those arriving
 * this soon (ms) after a pad menu press are dropped so focus does not move twice.
 */
export const PAD_ECHO_MS = 150;
const ECHO_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']);

/** Minimal shape of the parts of a Gamepad this manager reads. */
interface PadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  /** Missing on browsers without rumble (iOS WKWebView): rumble() then does nothing. */
  vibrationActuator?: { playEffect?: (type: 'dual-rumble', params?: GamepadEffectParameters) => Promise<unknown> } | null;
}

/**
 * Key events aimed at text fields or the menu UI (which handles its own keyboard focus) are not game input.
 * The UI may re-render and detach the target between listeners of the same event (browsers run microtasks
 * after each listener), so the UI root is looked up in the event path fixed at dispatch time.
 */
function isUiEvent(e: Event): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return true;
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  for (const n of path) if (n instanceof HTMLElement && n.hasAttribute('data-ui-root')) return true;
  return t instanceof HTMLElement && t.closest('[data-ui-root]') !== null;
}

function applyDeadzone(x: number, dead: number): number {
  const a = Math.abs(x);
  if (a <= dead) return 0;
  return Math.sign(x) * Math.min(1, (a - dead) / (1 - dead));
}

/** The device the player last used (prompts, the layout and the touch controls follow it). */
export type InputDevice = 'keyboard' | 'pad' | 'touch';

/** Any pad input beyond this (stick or button) makes the pad the last-used device. */
const PAD_ACTIVITY = 0.5;

/**
 * Keyboard + gamepad (+ touch, IMPLEMENTATION §M7b) input. Driving state is sampled, menu actions are edge-triggered.
 * With touch, the steer is the largest of the three devices', the other values the largest, and the latches OR-ed.
 */
export class InputManager implements IInputManager {
  /** A gamepad is connected (polled each update()). */
  padConnected = false;
  /** Last device that produced input. */
  lastDevice: InputDevice = 'keyboard';
  /** Called from update() when a gamepad connects or disconnects. */
  onPadChange: ((connected: boolean) => void) | null = null;
  /** Called when the last-used device changes. */
  onDeviceChange: ((device: InputDevice) => void) | null = null;

  private readonly held = new Set<string>();
  private codeToControl: Record<string, KeyControl> = { ...DEFAULT_CODE_TO_CONTROL };
  private readonly pending = new Int32Array(MENU_ACTIONS.length);
  private boostLatch = false;
  private fireLatch = false;
  /** Item selection presses since the last sample: +1 per next, −1 per previous. */
  private cycleLatch = 0;
  private disposed = false;

  private kbSteer = 0;
  private readonly touchOut = neutralControls();

  // Gamepad state, refreshed in update().
  private padSteer = 0;
  private padThrottle = 0;
  private padBrake = 0;
  private padAirLeft = 0;
  private padAirRight = 0;
  private padBoostHeld = false;
  private padFireHeld = false;
  private readonly padPrevButtons = new Uint8Array(16);
  /** The eight pad driving controls' buttons (Settings → Controls, M7c). Menu buttons are fixed. */
  private padMap: PadBindings = clonePadBindings(DEFAULT_PAD_BINDINGS);
  private padItemPrevHeld = false;
  private padItemNextHeld = false;
  /** Per NAV_DIRS: direction held (d-pad or stick), seconds held, and when it next repeats. */
  private readonly navDown = new Uint8Array(NAV_DIRS.length);
  private readonly navTime = new Float32Array(NAV_DIRS.length);
  private readonly navNext = new Float32Array(NAV_DIRS.length);
  /** performance.now() of the last pad menu press (for dropping iOS key echoes). */
  private padNavAt = -Infinity;

  constructor(
    private readonly target: Window,
    private readonly touch: TouchInput | null = null,
  ) {
    if (touch) {
      target.addEventListener('pointerdown', this.onPointerDown as EventListener, true);
      touch.onActivity = () => this.setDevice('touch');
    }
    target.addEventListener('keydown', this.onEchoKey as EventListener, true);
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    target.addEventListener('blur', this.onBlur);
  }

  /** Replace the keyboard driving layout (Settings → Controls). Menu keys are fixed. */
  setBindings(bindings: Readonly<KeyBindings>): void {
    const map: Record<string, KeyControl> = {};
    for (const control of Object.keys(bindings) as KeyControl[]) {
      for (const code of bindings[control]) if (map[code] === undefined) map[code] = control;
    }
    this.codeToControl = map;
    this.held.clear();
  }

  /** Replace the pad's driving layout (Settings → Controls). Steering stays on the left stick; menu buttons are fixed. */
  setPadBindings(bindings: Readonly<PadBindings>): void {
    this.padMap = clonePadBindings(bindings);
  }

  /** The pad buttons pressed right now (Settings → Controls' "press a button" capture). */
  padButtonsDown(): number[] {
    const pad = this.firstPad();
    if (!pad) return [];
    const out: number[] = [];
    for (let i = 0; i < Math.min(16, pad.buttons.length); i++) if (pad.buttons[i]?.pressed) out.push(i);
    return out;
  }

  /** Current driving controls; `boost` is true for exactly one sample per press. */
  sample(): ControlInput {
    const kbThrottle = this.isHeld('throttle') ? 1 : 0;
    const kbBrake = this.isHeld('brake') ? 1 : 0;
    const boost = this.boostLatch;
    this.boostLatch = false;
    const fire = this.fireLatch;
    this.fireLatch = false;
    const itemCycle = Math.sign(this.cycleLatch);
    this.cycleLatch = 0;

    let steer = Math.abs(this.kbSteer) >= Math.abs(this.padSteer) ? this.kbSteer : this.padSteer;
    const t = this.touch ? this.touch.read(this.touchOut) : null;
    if (t && Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
    return {
      throttle: Math.max(kbThrottle, this.padThrottle, t?.throttle ?? 0),
      brake: Math.max(kbBrake, this.padBrake, t?.brake ?? 0),
      steer: Math.max(-1, Math.min(1, steer)),
      airbrakeLeft: Math.max(this.isHeld('airLeft') ? 1 : 0, this.padAirLeft, t?.airbrakeLeft ?? 0),
      airbrakeRight: Math.max(this.isHeld('airRight') ? 1 : 0, this.padAirRight, t?.airbrakeRight ?? 0),
      boost: boost || (t?.boost ?? false),
      fire: fire || (t?.fire ?? false),
      itemCycle: itemCycle !== 0 ? itemCycle : (t?.itemCycle ?? 0),
    };
  }

  /** True once per press of the given menu action. */
  consume(action: MenuAction): boolean {
    const i = MENU_ACTIONS.indexOf(action);
    if (i < 0 || this.pending[i] === 0) return false;
    this.pending[i] = 0;
    return true;
  }

  /** Poll gamepads and advance the keyboard steering ramp. Call once per fixed step. */
  update(): void {
    if (this.disposed) return;
    const dt = CONFIG.FIXED_DT;

    // Age unconsumed menu presses so a stray key press cannot fire a menu action much later.
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i] > 0) this.pending[i]--;
    }

    // Keyboard steer ramp (never snaps between -1 and 1).
    const target = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    let rate: number;
    if (target === 0) rate = STEER_RELEASE;
    else if (this.kbSteer !== 0 && Math.sign(this.kbSteer) !== target) rate = STEER_REVERSE;
    else rate = STEER_ATTACK;
    this.kbSteer = damp(this.kbSteer, target, rate, dt);
    if (Math.abs(this.kbSteer) < 1e-3 && target === 0) this.kbSteer = 0;

    this.pollGamepad(dt);
    // The touch PAUSE button is a menu press like START or Escape (it ages the same way).
    if (this.touch?.consumePause()) this.press('pause');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.onEchoKey as EventListener, true);
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointerdown', this.onPointerDown as EventListener, true);
    this.touch?.releaseAll();
    this.held.clear();
    this.boostLatch = false;
    this.fireLatch = false;
    this.pending.fill(0);
  }

  // -------------------------------------------------------------------------

  private isHeld(control: KeyControl): boolean {
    for (const code of this.held) {
      if (this.codeToControl[code] === control) return true;
    }
    return false;
  }

  private static codeOf(e: KeyboardEvent): string {
    if (e.code) return e.code;
    return KEY_TO_CODE[(e.key ?? '').toLowerCase()] ?? '';
  }

  private press(action: MenuAction): void {
    const i = MENU_ACTIONS.indexOf(action);
    if (i >= 0) this.pending[i] = MENU_EXPIRY_TICKS;
  }

  private setDevice(device: InputDevice): void {
    if (this.lastDevice === device) return;
    this.lastDevice = device;
    this.onDeviceChange?.(device);
  }

  /** Capture-phase: swallow key events that echo a pad press (see PAD_ECHO_MS) before the UI or game sees them. */
  private readonly onEchoKey = (e: KeyboardEvent): void => {
    if (!ECHO_KEYS.has(e.key) || now() - this.padNavAt > PAD_ECHO_MS) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    this.setDevice('keyboard');
    if (isUiEvent(e)) return;
    const code = InputManager.codeOf(e);
    if (code === '') return;
    const control = this.codeToControl[code];
    const menu = CODE_TO_MENU[code];
    if (control === undefined && menu === undefined) return;

    if (PREVENT_DEFAULT.has(code)) e.preventDefault();
    if (e.repeat) return;

    if (control !== undefined) {
      this.held.add(code);
      if (control === 'boost') this.boostLatch = true;
      if (control === 'item') this.fireLatch = true;
      if (control === 'itemNext') this.cycleLatch++;
    }
    if (menu !== undefined) {
      for (const action of menu) this.press(action);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const code = InputManager.codeOf(e);
    if (code === '') return;
    if (PREVENT_DEFAULT.has(code)) e.preventDefault();
    this.held.delete(code);
  };

  /** Capture-phase: any finger on the screen makes touch the last-used device. */
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') this.setDevice('touch');
  };

  private readonly onBlur = (): void => {
    this.touch?.releaseAll();
    this.held.clear();
    this.boostLatch = false;
    this.fireLatch = false;
    this.cycleLatch = 0;
    this.kbSteer = 0;
  };

  private pollGamepad(dt: number): void {
    const pad = this.firstPad();
    const connected = pad !== null;
    if (connected !== this.padConnected) {
      this.padConnected = connected;
      this.onPadChange?.(connected);
    }
    if (pad === null) {
      this.padSteer = 0;
      this.padThrottle = 0;
      this.padBrake = 0;
      this.padAirLeft = 0;
      this.padAirRight = 0;
      this.padBoostHeld = false;
      this.padFireHeld = false;
      this.padItemPrevHeld = false;
      this.padItemNextHeld = false;
      this.padPrevButtons.fill(0);
      this.navDown.fill(0);
      return;
    }

    const btn = (i: number): number => {
      const b = pad.buttons[i];
      if (!b) return 0;
      return b.pressed ? Math.max(b.value, 1e-3) : b.value > TRIGGER_DEADZONE ? b.value : 0;
    };
    const down = (i: number): boolean => btn(i) > 0 && pad.buttons[i]?.pressed === true;

    if (this.lastDevice !== 'pad') {
      let active = Math.abs(pad.axes[0] ?? 0) > PAD_ACTIVITY || Math.abs(pad.axes[1] ?? 0) > PAD_ACTIVITY;
      for (let i = 0; i < pad.buttons.length && !active; i++) active = pad.buttons[i]?.pressed === true;
      if (active) this.setDevice('pad');
    }

    this.padSteer = applyDeadzone(pad.axes[0] ?? 0, STICK_DEADZONE);
    // The driving controls through the bindings (defaults: RT/Ⓐ, LT/Ⓑ, LB, RB, Ⓧ, Ⓨ, d-pad ◀ ▶). Analog values for
    // throttle and brake (a trigger's travel); the rest are pressed or not.
    const m = this.padMap;
    const level = (list: readonly number[]): number => {
      let v = 0;
      for (const i of list) v = Math.max(v, btn(i));
      return v;
    };
    const any = (list: readonly number[]): boolean => {
      for (const i of list) if (down(i)) return true;
      return false;
    };
    this.padThrottle = level(m.throttle);
    this.padBrake = level(m.brake);
    this.padAirLeft = any(m.airLeft) ? 1 : 0;
    this.padAirRight = any(m.airRight) ? 1 : 0;

    const boostHeld = any(m.boost);
    if (boostHeld && !this.padBoostHeld) this.boostLatch = true;
    this.padBoostHeld = boostHeld;
    const fireHeld = any(m.item);
    if (fireHeld && !this.padFireHeld) this.fireLatch = true;
    this.padFireHeld = fireHeld;
    // Item select (menus also read the d-pad as navigation).
    const prev = any(m.itemPrev);
    const next = any(m.itemNext);
    if (prev && !this.padItemPrevHeld) this.cycleLatch--;
    if (next && !this.padItemNextHeld) this.cycleLatch++;
    this.padItemPrevHeld = prev;
    this.padItemNextHeld = next;

    // Menu edges from buttons.
    this.padEdge(PAD.START, down(PAD.START), 'pause');
    this.padEdge(PAD.A, down(PAD.A), 'confirm');
    this.padEdge(PAD.B, down(PAD.B), 'back');

    // Directions: d-pad or left stick, repeating while held.
    const stickX = pad.axes[0] ?? 0;
    const stickY = pad.axes[1] ?? 0;
    this.navDir(0, down(PAD.DPAD_UP) || stickY < -STICK_MENU_THRESHOLD, dt);
    this.navDir(1, down(PAD.DPAD_DOWN) || stickY > STICK_MENU_THRESHOLD, dt);
    this.navDir(2, down(PAD.DPAD_LEFT) || stickX < -STICK_MENU_THRESHOLD, dt);
    this.navDir(3, down(PAD.DPAD_RIGHT) || stickX > STICK_MENU_THRESHOLD, dt);
  }

  private navDir(i: number, held: boolean, dt: number): void {
    if (!held) {
      this.navDown[i] = 0;
      return;
    }
    if (this.navDown[i] === 0) {
      this.navDown[i] = 1;
      this.navTime[i] = 0;
      this.navNext[i] = NAV_REPEAT_DELAY;
      this.padPress(NAV_DIRS[i]);
      return;
    }
    this.navTime[i] += dt;
    if (this.navTime[i] >= this.navNext[i]) {
      this.navNext[i] += NAV_REPEAT_EVERY;
      this.padPress(NAV_DIRS[i]);
    }
  }

  private padPress(action: MenuAction): void {
    this.padNavAt = now();
    this.press(action);
  }

  private padEdge(index: number, isDown: boolean, action: MenuAction): void {
    const prev = this.padPrevButtons[index] === 1;
    if (isDown && !prev) this.padPress(action);
    this.padPrevButtons[index] = isDown ? 1 : 0;
  }

  /**
   * Garage orbit from the pad (§V.3): right stick x/y (deadzoned, -1..1) and zoom from the shoulders
   * (RB in = +1, LB out = -1). All zero without a pad. Menus never read these, so the d-pad and left stick keep
   * their navigation.
   */
  orbitInput(): { x: number; y: number; zoom: number } {
    const pad = this.firstPad();
    if (!pad) return { x: 0, y: 0, zoom: 0 };
    const pressed = (i: number) => pad.buttons[i]?.pressed === true;
    return {
      x: applyDeadzone(pad.axes[2] ?? 0, STICK_DEADZONE),
      y: applyDeadzone(pad.axes[3] ?? 0, STICK_DEADZONE),
      zoom: (pressed(PAD.RB) ? 1 : 0) - (pressed(PAD.LB) ? 1 : 0),
    };
  }

  /** A dual-rumble effect on the pad, where supported (feature-detected; silently nothing otherwise). */
  rumble(strong: number, weak: number, ms: number): void {
    const play = this.firstPad()?.vibrationActuator?.playEffect;
    if (typeof play !== 'function') return;
    try {
      void play
        .call(this.firstPad()!.vibrationActuator, 'dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak })
        .catch(() => undefined);
    } catch {
      // some browsers throw synchronously for unsupported effects
    }
  }

  private firstPad(): PadLike | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    let pads: ArrayLike<Gamepad | null>;
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) return p;
    }
    return null;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

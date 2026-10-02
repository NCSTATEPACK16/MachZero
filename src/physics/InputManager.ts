import { CONFIG } from '../core/config';
import type { ControlInput, IInputManager, KeyBindings, KeyControl, MenuAction } from '../core/contracts';
import { damp } from '../core/math';

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

/** Minimal shape of the parts of a Gamepad this manager reads. */
interface PadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
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

/** Keyboard + gamepad input. Driving state is sampled, menu actions are edge-triggered. */
export class InputManager implements IInputManager {
  private readonly held = new Set<string>();
  private codeToControl: Record<string, KeyControl> = { ...DEFAULT_CODE_TO_CONTROL };
  private readonly pending = new Int32Array(MENU_ACTIONS.length);
  private boostLatch = false;
  private disposed = false;

  private kbSteer = 0;

  // Gamepad state, refreshed in update().
  private padSteer = 0;
  private padThrottle = 0;
  private padBrake = 0;
  private padAirLeft = 0;
  private padAirRight = 0;
  private padBoostHeld = false;
  private readonly padPrevButtons = new Uint8Array(16);
  private padPrevStickUp = false;
  private padPrevStickDown = false;
  private padPrevStickLeft = false;
  private padPrevStickRight = false;

  constructor(private readonly target: Window) {
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

  /** Current driving controls; `boost` is true for exactly one sample per press. */
  sample(): ControlInput {
    const kbThrottle = this.isHeld('throttle') ? 1 : 0;
    const kbBrake = this.isHeld('brake') ? 1 : 0;
    const boost = this.boostLatch;
    this.boostLatch = false;

    const steer = Math.abs(this.kbSteer) >= Math.abs(this.padSteer) ? this.kbSteer : this.padSteer;
    return {
      throttle: Math.max(kbThrottle, this.padThrottle),
      brake: Math.max(kbBrake, this.padBrake),
      steer: Math.max(-1, Math.min(1, steer)),
      airbrakeLeft: Math.max(this.isHeld('airLeft') ? 1 : 0, this.padAirLeft),
      airbrakeRight: Math.max(this.isHeld('airRight') ? 1 : 0, this.padAirRight),
      boost,
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

    this.pollGamepad();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener);
    this.target.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.boostLatch = false;
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

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
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

  private readonly onBlur = (): void => {
    this.held.clear();
    this.boostLatch = false;
    this.kbSteer = 0;
  };

  private pollGamepad(): void {
    const pad = this.firstPad();
    if (pad === null) {
      this.padSteer = 0;
      this.padThrottle = 0;
      this.padBrake = 0;
      this.padAirLeft = 0;
      this.padAirRight = 0;
      this.padBoostHeld = false;
      this.padPrevButtons.fill(0);
      this.padPrevStickUp = false;
      this.padPrevStickDown = false;
      this.padPrevStickLeft = false;
      this.padPrevStickRight = false;
      return;
    }

    const btn = (i: number): number => {
      const b = pad.buttons[i];
      if (!b) return 0;
      return b.pressed ? Math.max(b.value, 1e-3) : b.value > TRIGGER_DEADZONE ? b.value : 0;
    };
    const down = (i: number): boolean => btn(i) > 0 && pad.buttons[i]?.pressed === true;

    this.padSteer = applyDeadzone(pad.axes[0] ?? 0, STICK_DEADZONE);
    this.padThrottle = Math.max(btn(PAD.RT), down(PAD.A) ? 1 : 0);
    this.padBrake = Math.max(btn(PAD.LT), down(PAD.B) ? 1 : 0);
    this.padAirLeft = down(PAD.LB) ? 1 : 0;
    this.padAirRight = down(PAD.RB) ? 1 : 0;

    const boostHeld = down(PAD.X) || down(PAD.Y);
    if (boostHeld && !this.padBoostHeld) this.boostLatch = true;
    this.padBoostHeld = boostHeld;

    // Menu edges from buttons.
    this.padEdge(PAD.START, down(PAD.START), 'pause');
    this.padEdge(PAD.A, down(PAD.A), 'confirm');
    this.padEdge(PAD.B, down(PAD.B), 'back');
    this.padEdge(PAD.DPAD_UP, down(PAD.DPAD_UP), 'up');
    this.padEdge(PAD.DPAD_DOWN, down(PAD.DPAD_DOWN), 'down');
    this.padEdge(PAD.DPAD_LEFT, down(PAD.DPAD_LEFT), 'left');
    this.padEdge(PAD.DPAD_RIGHT, down(PAD.DPAD_RIGHT), 'right');

    // Left stick vertical acts as menu up/down.
    const stickY = pad.axes[1] ?? 0;
    const stickUp = stickY < -STICK_MENU_THRESHOLD;
    const stickDown = stickY > STICK_MENU_THRESHOLD;
    if (stickUp && !this.padPrevStickUp) this.press('up');
    if (stickDown && !this.padPrevStickDown) this.press('down');
    this.padPrevStickUp = stickUp;
    this.padPrevStickDown = stickDown;
    // ...and horizontal as menu left/right.
    const stickX = pad.axes[0] ?? 0;
    const stickLeft = stickX < -STICK_MENU_THRESHOLD;
    const stickRight = stickX > STICK_MENU_THRESHOLD;
    if (stickLeft && !this.padPrevStickLeft) this.press('left');
    if (stickRight && !this.padPrevStickRight) this.press('right');
    this.padPrevStickLeft = stickLeft;
    this.padPrevStickRight = stickRight;
  }

  private padEdge(index: number, isDown: boolean, action: MenuAction): void {
    const prev = this.padPrevButtons[index] === 1;
    if (isDown && !prev) this.press(action);
    this.padPrevButtons[index] = isDown ? 1 : 0;
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

/**
 * Menu focus navigation shared by keyboard, gamepad and touch. Directions are spatial: focus moves to the
 * nearest element on screen in that direction (so side-by-side buttons and card grids work); when nothing lies
 * that way it falls back to DOM order (up/left = previous, down/right = next, wrapping). Range sliders take
 * left/right as value steps. `confirm` clicks the focused element; `back` clicks the screen's [data-back] button.
 */
import type { MenuAction } from '../core/contracts';

const SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [data-nav]';

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => !el.closest('[inert]') && visible(el));
}

/** Focus [data-autofocus] or the first focusable of `screen`. */
export function focusFirst(screen: ParentNode): void {
  const els = focusables(screen);
  const target = els.find((e) => e.hasAttribute('data-autofocus')) ?? els.find((e) => !e.hasAttribute('data-back')) ?? els[0];
  target?.focus();
}

function isRange(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'range';
}

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLInputElement ? ['text', 'search', 'email', 'number', 'password'].includes(el.type) : el instanceof HTMLTextAreaElement;
}

function stepRange(el: HTMLInputElement, dir: 1 | -1): void {
  if (dir > 0) el.stepUp();
  else el.stepDown();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

type Dir = 'up' | 'down' | 'left' | 'right';

/** Off-axis distance counts this much more than on-axis distance when picking the nearest element. */
const SIDE_WEIGHT = 2;
const OFF_LINE = 1e5;

/** The nearest element from `from` in direction `dir`, by centre points; null when none lies that way. */
function nearest(els: HTMLElement[], from: HTMLElement, dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const horizontal = dir === 'left' || dir === 'right';
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of els) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - ax;
    const dy = r.top + r.height / 2 - ay;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    if (along < 4) continue;
    // Elements in line with `from` (their boxes overlap across the move) always beat diagonal ones.
    const overlap = horizontal ? r.top < a.bottom && r.bottom > a.top : r.left < a.right && r.right > a.left;
    const score = along + SIDE_WEIGHT * Math.abs(horizontal ? dy : dx) + (overlap ? 0 : OFF_LINE);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function move(screen: ParentNode, dir: Dir): void {
  const els = focusables(screen);
  if (els.length === 0) return;
  const step = dir === 'down' || dir === 'right' ? 1 : -1;
  const i = els.indexOf(document.activeElement as HTMLElement);
  const next =
    (i >= 0 && nearest(els, els[i], dir)) || els[i < 0 ? (step > 0 ? 0 : els.length - 1) : (i + step + els.length) % els.length];
  next.focus();
  next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function back(screen: ParentNode): void {
  screen.querySelector<HTMLElement>('[data-back]')?.click();
}

/** Apply a menu action (gamepad, or keyboard while focus is outside the UI) to `screen`. */
export function navigate(screen: ParentNode, action: MenuAction): void {
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && (screen as Node).contains(active);
  if (!inside && action !== 'back') {
    focusFirst(screen);
    return;
  }
  switch (action) {
    case 'up':
    case 'down':
      move(screen, action);
      break;
    case 'left':
    case 'right':
      if (isRange(active)) stepRange(active, action === 'right' ? 1 : -1);
      else move(screen, action);
      break;
    case 'confirm':
      if (active instanceof HTMLInputElement && isTextField(active)) active.form?.requestSubmit();
      else (active as HTMLElement).click();
      break;
    case 'back':
      back(screen);
      break;
    default:
      break;
  }
}

/** Keyboard handling while focus is inside the UI (InputManager ignores these events). */
export function onUiKeyDown(screen: ParentNode, e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const t = e.target as Element | null;
  const text = isTextField(t);
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      move(screen, 'up');
      break;
    case 'ArrowDown':
      e.preventDefault();
      move(screen, 'down');
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (text || isRange(t)) return; // native caret / slider behaviour
      e.preventDefault();
      move(screen, e.key === 'ArrowRight' ? 'right' : 'left');
      break;
    case 'Escape':
      e.preventDefault();
      back(screen);
      break;
    case 'Backspace':
      if (text) return;
      e.preventDefault();
      back(screen);
      break;
    default:
      break;
  }
}

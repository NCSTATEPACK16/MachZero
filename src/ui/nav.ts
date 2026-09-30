/**
 * Menu focus navigation shared by keyboard, gamepad and touch. Every interactive element of the current
 * screen is reachable in DOM order: up/left = previous, down/right = next (range sliders take left/right
 * as value steps). `confirm` clicks the focused element; `back` clicks the screen's [data-back] button.
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

function move(screen: ParentNode, dir: 1 | -1): void {
  const els = focusables(screen);
  if (els.length === 0) return;
  const i = els.indexOf(document.activeElement as HTMLElement);
  const next = i < 0 ? (dir > 0 ? 0 : els.length - 1) : (i + dir + els.length) % els.length;
  els[next].focus();
  els[next].scrollIntoView?.({ block: 'nearest' });
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
      move(screen, -1);
      break;
    case 'down':
      move(screen, 1);
      break;
    case 'left':
    case 'right':
      if (isRange(active)) stepRange(active, action === 'right' ? 1 : -1);
      else move(screen, action === 'right' ? 1 : -1);
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
      move(screen, -1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      move(screen, 1);
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (text || isRange(t)) return; // native caret / slider behaviour
      e.preventDefault();
      move(screen, e.key === 'ArrowRight' ? 1 : -1);
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

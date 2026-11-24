/**
 * The UI layer's sound events (IMPLEMENTATION §M6a step 7): one listener per root turns DOM activity into UI sound
 * kinds, so the pad, the keyboard and touch make the same sounds (the pad's confirm and back are clicks too, through
 * `ui/nav.ts`).
 *
 *  - `mz-ui-sound` (dispatched by `nav.ts` when focus moves) → its kind;
 *  - a click on a button → `back` inside `[data-back]`, `tab` on `[role="tab"]`, else `confirm`;
 *  - `input` on a range slider → `slider` with its position 0..1, at most every 60 ms;
 *  - nothing inside the touch race controls (`.mz-touch-layer`): their actions have their own sounds and haptics.
 */
import type { UiSoundKind } from '../audio/soundTable';

export type { UiSoundKind };

/** The event `nav.ts` dispatches on the newly focused element. */
export const UI_SOUND_EVENT = 'mz-ui-sound';
/** A slider sounds at most this often (ms). */
export const SLIDER_INTERVAL_MS = 60;

const TOUCH_LAYER = '.mz-touch-layer';

interface ClosestTarget {
  closest(sel: string): Element | null;
}

const hasClosest = (t: unknown): t is ClosestTarget => !!t && typeof (t as ClosestTarget).closest === 'function';

/** Listen on `root`; returns the unbind. `now` is the clock in ms (tests). */
export function bindUiSounds(root: HTMLElement, emit: (kind: UiSoundKind, value?: number) => void, now: () => number = () => performance.now()): () => void {
  let lastSlider = -Infinity;
  const onSound = (e: Event) => {
    const kind = (e as CustomEvent<{ kind?: UiSoundKind }>).detail?.kind;
    if (kind && !(hasClosest(e.target) && e.target.closest(TOUCH_LAYER))) emit(kind);
  };
  const onClick = (e: Event) => {
    const t = e.target;
    if (!hasClosest(t) || t.closest(TOUCH_LAYER)) return;
    const button = t.closest('button');
    if (!button) return;
    if ((button as Element & ClosestTarget).closest('[data-back]')) emit('back');
    else if (button.getAttribute('role') === 'tab') emit('tab');
    else emit('confirm');
  };
  const onInput = (e: Event) => {
    const t = e.target as (HTMLInputElement & ClosestTarget) | null;
    if (!t || t.type !== 'range' || (hasClosest(t) && t.closest(TOUCH_LAYER))) return;
    const ms = now();
    if (ms - lastSlider < SLIDER_INTERVAL_MS) return;
    lastSlider = ms;
    const min = Number(t.min || 0);
    const max = Number(t.max || 100);
    const v = max > min ? (Number(t.value) - min) / (max - min) : 0.5;
    emit('slider', Math.min(1, Math.max(0, v)));
  };
  root.addEventListener(UI_SOUND_EVENT, onSound);
  root.addEventListener('click', onClick, true);
  root.addEventListener('input', onInput, true);
  return () => {
    root.removeEventListener(UI_SOUND_EVENT, onSound);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('input', onInput, true);
  };
}

/** Tell the UI sound layer that focus moved to `el` (nav.ts). Safe where `CustomEvent` or `dispatchEvent` is missing. */
export function dispatchUiSound(el: Element, kind: UiSoundKind): void {
  if (typeof CustomEvent === 'undefined' || typeof (el as Partial<Element>).dispatchEvent !== 'function') return;
  el.dispatchEvent(new CustomEvent(UI_SOUND_EVENT, { bubbles: true, detail: { kind } }));
}

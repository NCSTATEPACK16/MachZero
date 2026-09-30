/** Small building blocks shared by the menu screens. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { focusFirst, onUiKeyDown } from './nav';

/** A full-screen menu page: heading, optional back button, scrollable body. Focuses its first control. */
export function Screen(props: { title: string; kicker?: string; onBack?: () => void; backLabel?: string; wide?: boolean; children: ComponentChildren; id: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) focusFirst(ref.current);
  }, [props.id]);
  return (
    <section
      ref={ref}
      class={`mzu-screen${props.wide ? ' wide' : ''}`}
      data-screen={props.id}
      aria-label={props.title}
      onKeyDown={(e) => ref.current && onUiKeyDown(ref.current, e)}
    >
      <header class="mzu-head">
        {props.onBack ? (
          <button type="button" class="mzu-back" data-back onClick={props.onBack} aria-label={props.backLabel ?? 'Back'}>
            <span aria-hidden="true">‹</span> {props.backLabel ?? 'BACK'}
          </button>
        ) : null}
        <div class="mzu-titles">
          {props.kicker ? <div class="mzu-kicker">{props.kicker}</div> : null}
          <h1 class="mzu-title">{props.title}</h1>
        </div>
      </header>
      <div class="mzu-body">{props.children}</div>
    </section>
  );
}

export function MenuButton(props: { label: string; sub?: string; icon?: ComponentChildren; onClick: () => void; big?: boolean; autofocus?: boolean; tone?: 'danger' }) {
  return (
    <button
      type="button"
      class={`mzu-item${props.big ? ' big' : ''}${props.tone ? ` ${props.tone}` : ''}`}
      onClick={props.onClick}
      data-autofocus={props.autofocus ? '' : undefined}
    >
      {props.icon ? <span class="mzu-item-icon">{props.icon}</span> : null}
      <span class="mzu-item-text">
        <span class="mzu-item-label">{props.label}</span>
        {props.sub ? <span class="mzu-item-sub">{props.sub}</span> : null}
      </span>
    </button>
  );
}

export function Toggle(props: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" class="mzu-row mzu-toggle" role="switch" aria-checked={props.value} onClick={() => props.onChange(!props.value)}>
      <span class="mzu-row-text">
        <span class="mzu-row-label">{props.label}</span>
        {props.hint ? <span class="mzu-row-hint">{props.hint}</span> : null}
      </span>
      <span class={`mzu-switch${props.value ? ' on' : ''}`} aria-hidden="true">
        <span class="mzu-switch-dot" />
        <span class="mzu-switch-txt">{props.value ? 'ON' : 'OFF'}</span>
      </span>
    </button>
  );
}

export function Slider(props: { label: string; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(props.value * 100);
  return (
    <label class="mzu-row mzu-slider">
      <span class="mzu-row-text">
        <span class="mzu-row-label">{props.label}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        aria-valuetext={`${pct}%`}
        onInput={(e) => props.onChange(Number((e.currentTarget as HTMLInputElement).value) / 100)}
        style={{ '--p': `${pct}%` }}
      />
      <span class="mzu-slider-val">{pct}</span>
    </label>
  );
}

export function Segmented<T extends string>(props: { label: string; options: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div class="mzu-row mzu-seg" role="radiogroup" aria-label={props.label}>
      <span class="mzu-row-text">
        <span class="mzu-row-label">{props.label}</span>
      </span>
      <span class="mzu-seg-opts">
        {props.options.map((o) => (
          <button type="button" role="radio" aria-checked={o.value === props.value} class={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Human-readable key name for a KeyboardEvent.code. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'SPACE',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
  };
  return map[code] ?? code.replace(/^Numpad/, 'NUM ').toUpperCase();
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UiSoundKind } from '../../audio/soundTable';
import { navigate } from '../nav';
import { bindUiSounds, UI_SOUND_EVENT } from '../uiSounds';

/** A minimal element: a tag, attributes, a parent chain for `closest`, and a dispatch that bubbles to the root. */
class El {
  readonly attrs = new Map<string, string>();
  type = '';
  value = '0';
  min = '0';
  max = '100';
  constructor(
    readonly tag: string,
    readonly parent: El | Root | null,
    attrs: Record<string, string> = {},
    readonly cls: string[] = [],
  ) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  matches(sel: string): boolean {
    if (sel === 'button') return this.tag === 'button';
    if (sel === '[data-back]') return this.attrs.has('data-back');
    if (sel.startsWith('.')) return this.cls.includes(sel.slice(1));
    return false;
  }
  closest(sel: string): El | null {
    for (let e: El | Root | null = this; e instanceof El; e = e.parent) if (e.matches(sel)) return e;
    return null;
  }
  dispatchEvent(ev: { type: string }): boolean {
    let r: El | Root | null = this.parent;
    while (r instanceof El) r = r.parent;
    (r as Root | null)?.fire(ev.type, { ...ev, target: this });
    return true;
  }
}

class Root {
  private readonly ls = new Map<string, Array<(e: unknown) => void>>();
  addEventListener(t: string, fn: (e: unknown) => void): void {
    this.ls.set(t, [...(this.ls.get(t) ?? []), fn]);
  }
  removeEventListener(t: string, fn: (e: unknown) => void): void {
    this.ls.set(
      t,
      (this.ls.get(t) ?? []).filter((f) => f !== fn),
    );
  }
  fire(type: string, ev: object): void {
    for (const fn of this.ls.get(type) ?? []) fn({ type, ...ev });
  }
  count(): number {
    let n = 0;
    for (const l of this.ls.values()) n += l.length;
    return n;
  }
}

function bind() {
  const root = new Root();
  const heard: Array<[UiSoundKind, number | undefined]> = [];
  let clock = 0;
  const off = bindUiSounds(root as unknown as HTMLElement, (k, v) => heard.push([k, v]), () => clock);
  return { root, heard, off, tick: (ms: number) => (clock += ms) };
}

afterEach(() => vi.unstubAllGlobals());

describe('UI sounds from the DOM', () => {
  it('gives back for a click inside [data-back], tab for a tab, confirm for any other button', () => {
    const { root, heard } = bind();
    const back = new El('button', root, { 'data-back': '' });
    const inner = new El('span', back);
    const tab = new El('button', root, { role: 'tab' });
    const ok = new El('button', root);
    const div = new El('div', root);
    for (const target of [inner, tab, ok, div]) root.fire('click', { target });
    expect(heard.map((h) => h[0])).toEqual(['back', 'tab', 'confirm']);
  });

  it('gives move when nav.ts moves the focus', () => {
    const { root, heard } = bind();
    vi.stubGlobal('CustomEvent', class {
      readonly detail: unknown;
      constructor(
        readonly type: string,
        init: { detail: unknown },
      ) {
        this.detail = init.detail;
      }
    });
    const a = new El('button', root);
    a.dispatchEvent(new CustomEvent(UI_SOUND_EVENT, { detail: { kind: 'move' } }) as unknown as { type: string });
    expect(heard.map((h) => h[0])).toEqual(['move']);
  });

  it('sounds a slider dragged through 10 values in 100 ms at most twice, with its position', () => {
    const { root, heard, tick } = bind();
    const slider = new El('input', root);
    slider.type = 'range';
    for (let i = 0; i < 10; i++) {
      slider.value = String(i * 10);
      root.fire('input', { target: slider });
      tick(10);
    }
    expect(heard.length).toBeLessThanOrEqual(2);
    expect(heard[0]).toEqual(['slider', 0]);
  });

  it('ignores the touch race controls', () => {
    const { root, heard } = bind();
    const layer = new El('div', root, {}, ['mz-touch-layer']);
    root.fire('click', { target: new El('button', layer) });
    expect(heard).toEqual([]);
  });

  it('unbinds every listener', () => {
    const { root, off } = bind();
    expect(root.count()).toBe(3);
    off();
    expect(root.count()).toBe(0);
  });
});

describe('nav.ts dispatches the move sound', () => {
  it('on a focus move, not when focus stays', () => {
    const sent: string[] = [];
    class FEl {
      constructor(
        readonly name: string,
        readonly left: number,
      ) {}
      getAttribute() {
        return null;
      }
      focus() {
        (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement = this;
      }
      closest() {
        return null;
      }
      hasAttribute() {
        return false;
      }
      getClientRects() {
        return [1];
      }
      getBoundingClientRect() {
        return { left: this.left, top: 0, right: this.left + 10, bottom: 10, width: 10, height: 10 };
      }
      dispatchEvent(ev: { type: string }) {
        sent.push(`${ev.type}:${this.name}`);
        return true;
      }
    }
    vi.stubGlobal('HTMLElement', FEl);
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.stubGlobal('CustomEvent', class {
      constructor(readonly type: string) {}
    });
    const a = new FEl('a', 0);
    const b = new FEl('b', 100);
    vi.stubGlobal('document', { activeElement: a });
    const screen = { querySelectorAll: () => [a, b], querySelector: () => null, contains: () => true } as unknown as ParentNode;
    navigate(screen, 'right');
    expect(sent).toEqual([`${UI_SOUND_EVENT}:b`]);
    const only = { querySelectorAll: () => [b], querySelector: () => null, contains: () => true } as unknown as ParentNode;
    navigate(only, 'right');
    expect(sent.length).toBe(1);
  });
});

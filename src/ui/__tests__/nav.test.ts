import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '../nav';

type DOMRectLike = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** Just enough of an element for nav.ts: a name, a layout box and focus. */
class FakeEl {
  /** data-* attributes (the named neighbours `data-nav-<dir>`). */
  readonly attrs = new Map<string, string>();
  constructor(
    readonly name: string,
    private readonly box: DOMRectLike,
  ) {}
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  focus(): void {
    (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement = this;
  }
  closest(): null {
    return null;
  }
  hasAttribute(): boolean {
    return false;
  }
  getClientRects(): unknown[] {
    return [this.box];
  }
  getBoundingClientRect(): DOMRectLike {
    return this.box;
  }
  click(): void {}
}

function screen(els: FakeEl[]): ParentNode {
  // querySelector('#name') finds an element by name (for data-nav-<dir> selectors).
  return { querySelectorAll: () => els, querySelector: (sel: string) => els.find((e) => `#${e.name}` === sel) ?? null, contains: (n: unknown) => els.includes(n as FakeEl) } as unknown as ParentNode;
}

const box = (left: number, top: number) => ({ left, top, width: 100, height: 40, right: left + 100, bottom: top + 40 });
const focused = () => (document.activeElement as unknown as FakeEl).name;

describe('menu navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', FakeEl);
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.stubGlobal('document', { activeElement: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  // A 2×2 card grid (DOM order a b / c d) with a BACK button under it.
  const grid = () => {
    const els = [new FakeEl('a', box(0, 0)), new FakeEl('b', box(200, 0)), new FakeEl('c', box(0, 100)), new FakeEl('d', box(200, 100))];
    return [...els, new FakeEl('back', box(0, 200))];
  };

  it('moves to the neighbour on screen in each direction', () => {
    const els = grid();
    const s = screen(els);
    els[0].focus();
    navigate(s, 'right');
    expect(focused()).toBe('b');
    navigate(s, 'down');
    expect(focused()).toBe('d');
    navigate(s, 'left');
    expect(focused()).toBe('c');
    navigate(s, 'up');
    expect(focused()).toBe('a');
  });

  it('prefers the element straight ahead over a nearer diagonal one', () => {
    const els = [new FakeEl('from', box(0, 0)), new FakeEl('diag', box(150, 60)), new FakeEl('ahead', box(300, 0))];
    els[0].focus();
    navigate(screen(els), 'right');
    expect(focused()).toBe('ahead');
  });

  it('falls back to list order (wrapping) when nothing lies that way', () => {
    const els = grid();
    const s = screen(els);
    els[4].focus(); // BACK, bottom-left: nothing below or to the left
    navigate(s, 'down');
    expect(focused()).toBe('a');
    els[1].focus(); // b: nothing to the right
    navigate(s, 'right');
    expect(focused()).toBe('c');
  });

  it('a named neighbour (data-nav-<dir>) wins over the nearest element (the world map chain)', () => {
    // Planets zig-zag: from p1 the nearest element to the right is p3, but the chain says p2.
    const els = [new FakeEl('p1', box(0, 200)), new FakeEl('p2', box(150, 0)), new FakeEl('p3', box(300, 180))];
    els[0].attrs.set('data-nav-right', '#p2');
    els[1].attrs.set('data-nav-left', '#p1');
    const s = screen(els);
    els[0].focus();
    navigate(s, 'right');
    expect(focused()).toBe('p2');
    navigate(s, 'left');
    expect(focused()).toBe('p1');
    // Without the attribute the spatial rule picks p3.
    els[0].attrs.delete('data-nav-right');
    navigate(s, 'right');
    expect(focused()).toBe('p3');
  });

  it('a first press with nothing focused only focuses the screen', () => {
    const els = grid();
    navigate(screen(els), 'down');
    expect(focused()).toBe('a');
  });
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Grand Prix by pad only (IMPLEMENTATION §GP): menu → GRAND PRIX → START CUP, race 1 driven to the finish by the
 * player's AI (debug `simulate`, the same autopilot path headless), Ⓐ on the results → cup standings; reload
 * (the app closed between races) → CONTINUE CUP → the same standings, then race 2 on the next world with the
 * reverse grid. No restarts in a cup: R does nothing and the pause panel has no RESTART.
 */

interface Debug {
  app: {
    cup: { tier: string; results: number[][] } | null;
    createProfile(name: string, badge: number, preset: 'rookie' | 'classic'): void;
    currentWorld: { id: string } | null;
  };
  race?: { state: string };
  ships?: { def: { id: number; gridIndex: number } }[];
  simulate(seconds: number): Promise<void>;
}

type PadWindow = Window & { __pad: { buttons: { pressed: boolean; value: number }[]; polls: number } };

const PAD = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13 };

async function installPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const w = window as unknown as PadWindow;
    w.__pad = { buttons, polls: 0 };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => {
        w.__pad.polls++;
        return [{ connected: true, axes: [0, 0, 0, 0], buttons: w.__pad.buttons }];
      },
    });
  });
}

async function polled(page: Page): Promise<void> {
  const n = await page.evaluate(() => (window as unknown as PadWindow).__pad.polls);
  await page.waitForFunction((n0) => (window as unknown as PadWindow).__pad.polls >= n0 + 2, n, { timeout: 60_000 });
}

async function padPress(page: Page, index: number): Promise<void> {
  const set = (down: boolean) =>
    page.evaluate(
      ([i, d]) => {
        const b = (window as unknown as PadWindow).__pad.buttons[i as number];
        b.pressed = d as boolean;
        b.value = d ? 1 : 0;
      },
      [index, down],
    );
  await set(true);
  await polled(page);
  await set(false);
  await polled(page);
}

const dbg = <T>(page: Page, fn: (d: Debug) => T) => page.evaluate(`(${fn.toString()})(window.__machzero)`) as Promise<T>;

/** D-pad down until the focused button's text starts with `label`. */
async function focusButton(page: Page, label: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const text = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? '');
    if (text.trim().startsWith(label)) return;
    await padPress(page, PAD.DOWN);
  }
  throw new Error(`could not focus ${label} by pad`);
}

test('a Grand Prix cup by pad: race 1, standings, reload, CONTINUE CUP, race 2 on a reverse grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await installPad(page);
  await page.goto('/?features=profiles&debug=1&quality=low');
  const screen = page.locator('[data-screen]');
  await expect(screen).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('CUPPER', 3, 'classic'));
  await expect(screen).toHaveAttribute('data-screen', 'menu');

  // Menu → GRAND PRIX → START PILOT CUP (a Classic profile races Pilot rivals).
  await focusButton(page, 'GRAND PRIX');
  await padPress(page, PAD.A);
  await expect(screen).toHaveAttribute('data-screen', 'gp');
  await expect(page.locator('[data-gp-start]')).toBeFocused();
  await expect(page.locator('[data-gp-start]')).toHaveText('START PILOT CUP');
  await padPress(page, PAD.A);
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  expect(await dbg(page, (d) => d.app.currentWorld?.id)).toBe('neon-bay');
  expect(await dbg(page, (d) => d.app.cup)).toEqual({ tier: 'pilot', results: [] });

  // No restarts: the pause panel has RETIRE and no RESTART.
  await padPress(page, PAD.START);
  await expect.poll(() => dbg(page, (d) => d.race?.state)).toBe('paused');
  await expect(page.locator('.mz-pause button', { hasText: 'RETIRE' })).toBeVisible();
  await expect(page.locator('.mz-pause button', { hasText: 'RESTART' })).toHaveCount(0);
  await padPress(page, PAD.START);
  await expect.poll(() => dbg(page, (d) => d.race?.state)).not.toBe('paused');

  // Race 1 to the finish on autopilot; Ⓐ on the results → the cup standings.
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 120_000 }).toBe('results');
  await expect(page.locator('.mz-results button', { hasText: 'CUP STANDINGS' })).toBeVisible();
  await expect(page.locator('.mz-results button', { hasText: 'RACE AGAIN' })).toHaveCount(0);
  await page.keyboard.press('KeyR'); // restart: ignored in a cup
  expect(await dbg(page, (d) => d.race?.state)).toBe('results');
  await padPress(page, PAD.A);
  await expect(screen).toHaveAttribute('data-screen', 'cup');
  await expect(page.locator('[data-cup-done="1"]')).toBeVisible();
  await expect(page.locator('.mzu-cup-row[data-ship]')).toHaveCount(8);
  const points = await page.locator('.mzu-cup-row[data-ship] .pts').allInnerTexts();
  expect(points.map(Number).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  const cup1 = await dbg(page, (d) => d.app.cup);
  expect(cup1?.results).toHaveLength(1);

  // The app closes between races: the cup is in the save; the menu offers CONTINUE CUP first.
  await page.reload();
  await expect(screen).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  const cont = page.getByRole('button', { name: /^CONTINUE CUP/ });
  await expect(cont).toBeFocused();
  await expect(cont).toContainText('RACE 2 OF 5');
  await padPress(page, PAD.A);
  await expect(screen).toHaveAttribute('data-screen', 'cup');
  expect(await dbg(page, (d) => d.app.cup)).toEqual(cup1);
  await expect(page.locator('[data-cup-next]')).toBeFocused();
  await padPress(page, PAD.A);
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  expect(await dbg(page, (d) => d.app.currentWorld?.id)).toBe('sunset-mesa');
  // Reverse grid: the cup leader starts last.
  const grid = await dbg(page, (d) => d.ships!.map((s) => [s.def.id, s.def.gridIndex]));
  const leaderId = cup1!.results[0].indexOf(1); // the race-1 winner leads the cup
  expect(grid.find(([id]) => id === leaderId)?.[1]).toBe(7);
  expect(errors, errors.join('\n')).toEqual([]);
});

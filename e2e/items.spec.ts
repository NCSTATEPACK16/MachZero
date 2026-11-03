import { expect, test, type Page } from '@playwright/test';

/**
 * Items by pad only (IMPLEMENTATION §P): buy a Shield and a Drop Mine in Garage → Items with the d-pad and Ⓐ,
 * then in the race pick each with d-pad left / right and use it with Ⓨ.
 */

interface Debug {
  app: {
    activeProfile: { value: { credits: number; items: { emp: number; shield: number; mine: number } } | null };
    createProfile(name: string, badge: number, preset: 'rookie' | 'classic'): void;
  };
  race?: { state: string };
  ships?: { shield: number }[];
  physics?: { droppedMines: number };
  grantCredits(n: number): void;
}

type PadWindow = Window & { __pad: { buttons: { pressed: boolean; value: number }[]; polls: number } };

const PAD = { A: 0, Y: 3, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

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

/** D-pad down until the focused control is the BUY button of `kind`. */
async function focusBuy(page: Page, kind: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const on = await page.evaluate((k) => document.activeElement?.closest(`[data-item="${k}"]`) !== null && document.activeElement?.tagName === 'BUTTON', kind);
    if (on) return;
    await padPress(page, PAD.DOWN);
  }
  throw new Error(`could not focus the ${kind} BUY button by pad`);
}

test('buy a Shield and a Drop Mine by pad, then pick with the d-pad and use with Ⓨ in the race', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await installPad(page);
  await page.goto('/?features=profiles&debug=1&quality=low');
  const screen = page.locator('[data-screen]');
  await expect(screen).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => {
    const d = (window as unknown as { __machzero: Debug }).__machzero;
    d.app.createProfile('ITEMS', 2, 'classic');
    d.grantCredits(1000);
  });
  await expect(screen).toHaveAttribute('data-screen', 'menu');
  await page.getByRole('button', { name: /^GARAGE/ }).click();
  await expect(screen).toHaveAttribute('data-screen', 'garage');
  await page.getByRole('tab', { name: 'ITEMS' }).click();
  await expect(page.locator('[data-item]')).toHaveCount(3);

  await focusBuy(page, 'shield');
  await padPress(page, PAD.A);
  await expect.poll(() => dbg(page, (d) => d.app.activeProfile.value!.items)).toEqual({ emp: 0, shield: 1, mine: 0 });
  await focusBuy(page, 'mine');
  await padPress(page, PAD.A);
  await expect.poll(() => dbg(page, (d) => d.app.activeProfile.value!.items)).toEqual({ emp: 0, shield: 1, mine: 1 });
  expect(await dbg(page, (d) => d.app.activeProfile.value!.credits)).toBe(1000 - 300 - 350);
  // Two slots, both full: every BUY now says so.
  await expect(page.locator('[data-item="emp"] button')).toHaveText('SLOTS FULL');

  // Race: the item chip shows the selection; d-pad right picks the mine, Ⓨ drops it; left picks the shield.
  await page.keyboard.press('Escape');
  await expect(screen).toHaveAttribute('data-screen', 'menu');
  await page.getByRole('button', { name: /^RACE/ }).click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toBe('racing');
  const chip = page.locator('.mz-items');
  await expect(chip).toBeVisible();
  await expect(page.locator('.mz-items-name')).toContainText('SHIELD');
  await padPress(page, PAD.RIGHT);
  await expect(page.locator('.mz-items-name')).toContainText('DROP MINE');
  await padPress(page, PAD.Y);
  await expect.poll(() => dbg(page, (d) => d.physics!.droppedMines)).toBe(1);
  await expect.poll(() => dbg(page, (d) => d.app.activeProfile.value!.items.mine)).toBe(0);
  // Only the shield is left: the selection moves to it by itself; Ⓨ raises it.
  await expect(page.locator('.mz-items-name')).toContainText('SHIELD');
  await padPress(page, PAD.Y);
  await expect.poll(() => dbg(page, (d) => d.ships![0].shield)).toBeGreaterThan(0);
  await expect(chip).toHaveAttribute('data-s', 'shield');
  expect(await dbg(page, (d) => d.app.activeProfile.value!.items)).toEqual({ emp: 0, shield: 0, mine: 0 });
  expect(errors, errors.join('\n')).toEqual([]);
});

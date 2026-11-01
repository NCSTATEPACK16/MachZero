import { expect, test, type Page } from '@playwright/test';

/**
 * Controller-only play: unplugging the pad pauses the race; the pad drives the pause panel's buttons and the
 * menus, with a visible highlight on the focused control.
 */

interface Debug {
  race?: { state: string };
}

type PadWindow = Window & { __pad: { buttons: { pressed: boolean; value: number }[]; connected: boolean; polls: number } };

async function installPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const w = window as unknown as PadWindow;
    w.__pad = { buttons, connected: true, polls: 0 };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => {
        w.__pad.polls++;
        return w.__pad.connected ? [{ connected: true, axes: [0, 0, 0, 0], buttons: w.__pad.buttons }] : [null];
      },
    });
  });
}

/** Wait until the game has polled the pad a couple more times (presses must span real fixed steps). */
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

const raceState = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.race?.state);

test('unplugging the controller pauses the race; the pad drives the pause panel', async ({ page }) => {
  await installPad(page);
  await page.goto('/?autopilot=1&debug=1');
  await page.waitForFunction(() => {
    const s = (window as unknown as { __machzero?: Debug }).__machzero?.race?.state;
    return s === 'countdown' || s === 'racing';
  }, undefined, { timeout: 60_000 });
  // The first pad poll can land a little after the race starts on a loaded machine.
  await expect(page.locator('html')).toHaveClass(/mz-pad/, { timeout: 30_000 });

  await page.evaluate(() => ((window as unknown as PadWindow).__pad.connected = false));
  await expect.poll(() => raceState(page), { timeout: 30_000 }).toBe('paused');
  await expect(page.locator('.mz-pause .mz-k-pad')).toBeVisible();

  // Reconnecting does not resume by itself.
  await page.evaluate(() => ((window as unknown as PadWindow).__pad.connected = true));
  await polled(page);
  expect(await raceState(page)).toBe('paused');

  // D-pad down focuses RESUME, again RESTART; Ⓐ presses it and the race restarts from the countdown.
  await padPress(page, 13);
  await padPress(page, 13);
  await expect(page.locator('.mz-pause button:focus')).toHaveText('RESTART');
  // The focused button is visibly highlighted, and left / right move along the row.
  const shadow = (name: string) => page.locator('.mz-pause button', { hasText: name }).evaluate((e) => getComputedStyle(e).boxShadow);
  expect(await shadow('RESTART')).not.toBe(await shadow('RESUME'));
  await padPress(page, 14);
  await expect(page.locator('.mz-pause button:focus')).toHaveText('RESUME');
  await padPress(page, 15);
  await expect(page.locator('.mz-pause button:focus')).toHaveText('RESTART');
  await padPress(page, 0);
  await expect.poll(() => raceState(page), { timeout: 30_000 }).toMatch(/countdown|racing/);
});

test('menus: the pad-focused control shows a ring, and the d-pad moves across the world cards', async ({ page }) => {
  await installPad(page);
  await page.goto('/?features=profiles&debug=1');
  const screen = page.locator('[data-screen]');
  await expect(screen).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.locator('input[type=text]').fill('PAD');
  await page.getByRole('radio', { name: /I'M NEW TO RACING GAMES/ }).click();
  await page.getByRole('button', { name: "LET'S RACE" }).click();
  await expect(screen).toHaveAttribute('data-screen', 'menu');

  await padPress(page, 13); // first press: pad mode; RACE stays focused or WORLDS takes focus
  await expect(page.locator('html')).toHaveClass(/mz-pad/, { timeout: 30_000 });
  const focused = page.locator(':focus');
  if (!/WORLDS/.test((await focused.textContent()) ?? '')) await padPress(page, 13);
  await expect(focused).toContainText('WORLDS');
  // Script focus from a pad never matches :focus-visible in WebKit, so pad mode draws its own ring.
  expect(await focused.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
  await padPress(page, 0);
  await expect(screen).toHaveAttribute('data-screen', 'worlds');

  const card = page.locator('.mzu-world:focus');
  await expect(card).toHaveCount(1);
  const first = await card.locator('.mzu-world-name').textContent();
  await padPress(page, 15); // right: the next card along the grid
  await expect(card.locator('.mzu-world-name')).not.toHaveText(first ?? '');
  await padPress(page, 14); // left: back again
  await expect(card.locator('.mzu-world-name')).toHaveText(first ?? '');
});

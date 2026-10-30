import { expect, test, type Page } from '@playwright/test';

/** Controller-only play: unplugging the pad pauses the race; the pad drives the pause panel's buttons. */

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
  await expect(page.locator('html')).toHaveClass(/mz-pad/);

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
  await padPress(page, 0);
  await expect.poll(() => raceState(page), { timeout: 30_000 }).toMatch(/countdown|racing/);
});

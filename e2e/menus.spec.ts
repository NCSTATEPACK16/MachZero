import { expect, test, type Page } from '@playwright/test';

/**
 * 2.0 menu flow (feature `profiles`): create a profile, navigate by keyboard, gamepad and touch, change
 * settings live, race, pause to menu, reload (persistence), and race rebuilds without GPU-memory growth.
 */

interface Debug {
  race?: { state: string };
  app: { route: { value: { name: string } } };
  memory(): { geometries: number; textures: number };
  rebuildRace(): Promise<void>;
}

const URL = '/?features=profiles&debug=1';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const screen = (page: Page) => page.locator('[data-screen]');
const route = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.route.value.name);
const raceState = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.race?.state);
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '');

/** A fake standard-mapping gamepad whose buttons the test presses; counts polls so presses span real fixed steps. */
async function installPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const w = window as unknown as { __pad: { buttons: typeof buttons; polls: number } };
    w.__pad = { buttons, polls: 0 };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => {
        w.__pad.polls++;
        return [{ connected: true, axes: [0, 0, 0, 0], buttons: w.__pad.buttons }];
      },
    });
  });
}

async function padPress(page: Page, index: number): Promise<void> {
  const polls = () => page.evaluate(() => (window as unknown as { __pad: { polls: number } }).__pad.polls);
  const set = (down: boolean) =>
    page.evaluate(
      ([i, d]) => {
        const b = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[i as number];
        b.pressed = d as boolean;
        b.value = d ? 1 : 0;
      },
      [index, down],
    );
  const wait = async () => {
    const n = await polls();
    await page.waitForFunction((n0) => (window as unknown as { __pad: { polls: number } }).__pad.polls >= n0 + 2, n, { timeout: 60_000 });
  };
  await set(true);
  await wait();
  await set(false);
  await wait();
}

test('profiles, menus (keyboard + gamepad), live settings, race, pause → menu, persistence', async ({ page }) => {
  const errors = collectErrors(page);
  await installPad(page);
  await page.goto(URL);

  // Fresh device: the create-a-pilot screen, name field focused.
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 120_000 });
  await expect(page.locator('input[type=text]')).toBeFocused();
  await page.keyboard.type('tess');
  await page.getByRole('radio', { name: /I'M NEW TO RACING GAMES/ }).click();
  await page.getByRole('button', { name: "LET'S RACE" }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await expect(page.locator('.mzu-pilot-name')).toHaveText('TESS');

  // Keyboard: RACE is focused; ↓ reaches SETTINGS; Enter opens it; Escape returns.
  await expect.poll(() => focusedText(page)).toContain('RACE');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedText(page)).toContain('SETTINGS');
  await page.keyboard.press('Enter');
  await expect(screen(page)).toHaveAttribute('data-screen', 'settings');

  // Settings apply live and persist: Comfort → Large text.
  await page.getByRole('tab', { name: 'COMFORT' }).click();
  await page.getByRole('switch', { name: /LARGE TEXT/ }).click();
  await expect(page.locator('html')).toHaveClass(/mz-large-text/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).settings.largeText)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // Gamepad (always routed InputManager → App → UI nav): D-pad moves focus, A activates, B goes back.
  await expect.poll(() => focusedText(page)).toContain('RACE');
  await padPress(page, 13); // D-pad down
  await expect.poll(() => focusedText(page)).toContain('SETTINGS');
  await padPress(page, 12); // D-pad up
  await expect.poll(() => focusedText(page)).toContain('RACE');
  await padPress(page, 13);
  await expect.poll(() => focusedText(page)).toContain('SETTINGS');
  await padPress(page, 0); // A
  await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
  await padPress(page, 1); // B
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // Race from the menu, pause with Escape, quit to the menu from the pause screen.
  await page.getByRole('button', { name: /^RACE/ }).click();
  await expect.poll(() => raceState(page), { timeout: 120_000 }).toMatch(/countdown|racing/);
  expect(await route(page)).toBe('race');
  await page.keyboard.press('Escape');
  await expect.poll(() => raceState(page), { timeout: 60_000 }).toBe('paused');
  await page.locator('.mz-pause').getByRole('button', { name: 'MENU' }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  expect(await raceState(page)).toBe('title');

  // Reload: the single active profile goes straight to the menu with its settings.
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 120_000 });
  await expect(page.locator('.mzu-pilot-name')).toHaveText('TESS');
  await expect(page.locator('html')).toHaveClass(/mz-large-text/);

  expect(errors, errors.join('\n')).toEqual([]);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('menus work by tapping', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL);
    await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 120_000 });
    await page.locator('input[type=text]').fill('KID');
    await page.getByRole('radio', { name: /I'VE RACED BEFORE/ }).tap();
    await page.getByRole('button', { name: "LET'S RACE" }).tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
    await page.getByRole('button', { name: /SETTINGS/ }).tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
    await page.getByRole('button', { name: 'MENU' }).tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test('ten race rebuilds do not grow GPU memory', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(URL);
  await expect(screen(page)).toBeVisible({ timeout: 120_000 });
  const frames = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const mem = () => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.memory());
  const rebuild = () => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.rebuildRace());
  await rebuild();
  await frames();
  const base = await mem();
  for (let i = 0; i < 10; i++) {
    await rebuild();
    await frames();
  }
  const after = await mem();
  expect(after.geometries).toBeLessThanOrEqual(base.geometries + 2);
  expect(after.textures).toBeLessThanOrEqual(base.textures + 2);
  expect(errors, errors.join('\n')).toEqual([]);
});

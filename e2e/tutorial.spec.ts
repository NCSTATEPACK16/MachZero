import { expect, test, type Page } from '@playwright/test';

/**
 * The first-race tutorial (IMPLEMENTATION §M8c): a new Rookie profile's first World Tour race
 * shows the STEER prompt (and the profile gets a free Shield); SKIP removes it and a reload does not bring it back;
 * Settings → Race → REPLAY TUTORIAL does. A Classic profile sees the one-line note and no prompt.
 */

interface Debug {
  race?: { state: string };
  tutorial(): { prompt: string | null; active: boolean };
  app: {
    createProfile(name: string, badge: number, preset: string): void;
    endIntro(): void;
    quitToMenu(): void;
    toasts: { value: { text: string }[] };
    route: { value: { name: string } };
  };
}

const URL = '/?debug=1&quality=low';
const screen = (page: Page) => page.locator('[data-screen]');
const dbg = <T>(page: Page, fn: (d: Debug) => T) => page.evaluate(`(${fn.toString()})(window.__machzero)`) as Promise<T>;
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0]);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function newProfile(page: Page, name: string, preset: 'rookie' | 'classic'): Promise<void> {
  await page.goto(URL);
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(([n, p]) => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile(n, 1, p), [name, preset]);
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
}

/** World Tour → Neon Bay → RACE, past the grid intro card. */
async function tourRace(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^WORLD TOUR/ }).click();
  await page.locator('[data-planet="neon-bay"]').click();
  await page.locator('[data-tour-race]').click();
  // The menu's backdrop race stays until the new one is built: wait for the race route.
  await expect.poll(() => dbg(page, (d) => d.app.route.value.name), { timeout: 90_000 }).toBe('race');
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/title|countdown|racing/);
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.endIntro());
}

test('a new Rookie profile: STEER at the lights, a free Shield, SKIP for good; REPLAY TUTORIAL brings it back', async ({ page }) => {
  const errors = collectErrors(page);
  await newProfile(page, 'ROOKIE', 'rookie');
  await tourRace(page);
  // The free Shield for the item step (the bag was empty).
  expect((await saved(page)).items.shield).toBe(1);
  expect(await dbg(page, (d) => d.tutorial().active)).toBe(true);
  await expect.poll(() => dbg(page, (d) => d.tutorial().prompt), { timeout: 60_000 }).toBe('steer');
  const prompt = page.locator('.mz-tutorial');
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute('data-step', 'steer');
  await expect(prompt).toContainText('STEER');
  // The keyboard form of the control (the last-used device): the bound steering keys.
  await expect(prompt.locator('.mz-k-kb')).toHaveText('A D');
  await prompt.locator('[data-tutorial-skip]').click();
  await expect(prompt).toBeHidden();
  expect(await dbg(page, (d) => d.tutorial())).toEqual({ prompt: null, active: false });
  expect((await saved(page)).tutorialDone).toBe(true);

  // A reload: the next Tour race has no tutorial.
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  await tourRace(page);
  expect(await dbg(page, (d) => d.tutorial().active)).toBe(false);

  // Settings → Race → REPLAY TUTORIAL: the next Tour race runs it again.
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.quitToMenu());
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await page.getByRole('button', { name: /^SETTINGS/ }).click();
  await page.locator('[data-replay-tutorial]').click();
  expect((await saved(page)).tutorialDone).toBe(false);
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await tourRace(page);
  expect(await dbg(page, (d) => d.tutorial().active)).toBe(true);
  await expect.poll(() => dbg(page, (d) => d.tutorial().prompt), { timeout: 60_000 }).toBe('steer');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a Classic profile sees the one-line note and no prompt', async ({ page }) => {
  const errors = collectErrors(page);
  await newProfile(page, 'VETERAN', 'classic');
  await tourRace(page);
  expect(await dbg(page, (d) => d.app.toasts.value.map((t) => t.text))).toContain('Tutorial: Settings → Race');
  expect(await dbg(page, (d) => d.tutorial().active)).toBe(false);
  const p = await saved(page);
  expect(p.tutorialDone).toBe(true);
  expect(p.items.shield).toBe(0);
  await expect(page.locator('.mz-tutorial')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Time Trial (IMPLEMENTATION §M8b), with `?features=modes`: open TIME TRIAL, start Neon Bay on autopilot, finish and
 * see a time and a medal state; start again and `__machzero.ghosts()` reports two ghosts, the best one present; a
 * reload keeps the best time. A ghost switched off on the screen is not shown.
 */

interface Trial {
  total: number | null;
  best: boolean;
  reached: string | null;
  medalTimes: Record<string, number>;
}
interface Debug {
  race?: { state: string };
  simulate(seconds: number): Promise<void>;
  ghosts(): { kind: string; totalTime: number; visible: boolean }[];
  ghostsDrawn(): number;
  app: {
    createProfile(name: string, badge: number, preset: string): void;
    route: { value: { name: string } };
    lastResult: { value: { mode: string; trial?: Trial; tally: { label: string; amount: number }[] } | null };
  };
}

const URL = '/?features=modes&debug=1&quality=low';
const screen = (page: Page) => page.locator('[data-screen]');
const dbg = <T>(page: Page, fn: (d: Debug) => T) => page.evaluate(`(${fn.toString()})(window.__machzero)`) as Promise<T>;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function finishRace(page: Page): Promise<void> {
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect(screen(page)).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
}

test('a Time Trial records a best time and ghost; the next run shows both ghosts; a reload keeps the best time', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(URL);
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('CLOCK', 1, 'classic'));
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // The menu's TIME TRIAL opens the screen: Neon Bay open, Sunset Mesa locked.
  await page.getByRole('button', { name: /^TIME TRIAL/ }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'trial');
  await expect(page.locator('[data-trial-world="sunset-mesa"]')).toHaveAttribute('data-locked', '');
  await expect(page.locator('[data-trial-world="neon-bay"] .mzu-trial-best')).toContainText('—');
  await page.locator('[data-trial-world="neon-bay"]').click();

  // A solo race: one ship, no rivals; the first run has the dev ghost only.
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  expect(await page.evaluate(() => (window as unknown as { __machzero: { ships: unknown[] } }).__machzero.ships.length)).toBe(1);
  expect(await dbg(page, (d) => d.ghosts().map((g) => g.kind))).toEqual(['dev']);
  await finishRace(page);

  const first = await dbg(page, (d) => d.app.lastResult.value);
  expect(first?.mode).toBe('trial');
  expect(first?.trial?.total).toBeGreaterThan(60);
  expect(first?.trial?.best).toBe(true);
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-trial-total]')).toBeVisible();
  await expect(page.locator('[data-medal-row="gold"]')).toBeVisible();
  // The tally lists exactly the medals paid.
  const reached = first?.trial?.reached ?? null;
  const paid = first?.tally.map((l) => l.label) ?? [];
  expect(paid).toEqual({ gold: ['BRONZE MEDAL', 'SILVER MEDAL', 'GOLD MEDAL'], silver: ['BRONZE MEDAL', 'SILVER MEDAL'], bronze: ['BRONZE MEDAL'], none: [] }[reached ?? 'none']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0].records['neon-bay']);
  expect(saved.trialTime).toBeCloseTo(first!.trial!.total!, 3);
  expect(saved.medal ?? null).toBe(reached);

  // RACE AGAIN: the best ghost (this run) and the dev ghost; a ghost adds one draw call.
  await page.locator('[data-res-again]').click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  const ghosts = await dbg(page, (d) => d.ghosts());
  expect(ghosts.map((g) => g.kind)).toEqual(['best', 'dev']);
  expect(ghosts[0].totalTime).toBeCloseTo(first!.trial!.total!, 3);
  await expect.poll(() => dbg(page, (d) => d.ghostsDrawn()), { timeout: 30_000 }).toBeGreaterThan(0);

  // Back to the Time Trial screen and switch the dev ghost off: the next run shows only the best ghost.
  await page.keyboard.press('Escape');
  await expect.poll(() => dbg(page, (d) => d.race?.state)).toBe('paused');
  await page.getByRole('button', { name: 'MENU' }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'trial');
  await page.getByRole('switch', { name: /DEV GHOST/ }).click();
  await expect(page.getByRole('switch', { name: /DEV GHOST/ })).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-trial-world="neon-bay"]').click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  expect(await dbg(page, (d) => d.ghosts().map((g) => g.kind))).toEqual(['best']);

  // A reload keeps the best time (the save) and the best ghost (IndexedDB).
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  await page.getByRole('button', { name: /^TIME TRIAL/ }).click();
  await expect(page.locator('[data-trial-world="neon-bay"] .mzu-trial-best')).not.toContainText('—');
  await page.getByRole('switch', { name: /DEV GHOST/ }).click();
  await page.locator('[data-trial-world="neon-bay"]').click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  expect(await dbg(page, (d) => d.ghosts().map((g) => g.kind))).toEqual(['best', 'dev']);
  expect(errors, errors.join('\n')).toEqual([]);
});

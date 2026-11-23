import { expect, test, type Page } from '@playwright/test';

/**
 * The ASSISTS tab (IMPLEMENTATION §M7a): a Rookie profile starts with all four assists on; the CLASSIC PRESET turns
 * them off and that survives a reload; from the pause menu the ROOKIE PRESET reaches the race in progress at once.
 */

interface Debug {
  race?: { state: string };
  ships?: Array<{ def: { isPlayer?: boolean }; noKO?: boolean; earlyBoost?: boolean }>;
  app: { route: { value: { name: string } }; session: { activeAssists: Record<string, unknown> } | null };
}

const URL = '/?debug=1';
const screen = (page: Page) => page.locator('[data-screen]');
const raceState = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.race?.state);
const sessionAssists = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.session?.activeAssists ?? null);
const playerFlags = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __machzero: Debug }).__machzero.ships?.find((s) => s.def.isPlayer);
    return p ? { noKO: p.noKO === true, earlyBoost: p.earlyBoost === true } : null;
  });

const ROWS = ['AUTO-ACCELERATE', 'NO KNOCK-OUTS', 'BOOST FROM LAP 1'] as const;

async function expectAssists(page: Page, on: boolean): Promise<void> {
  for (const name of ROWS) await expect(page.getByRole('switch', { name: new RegExp(name) })).toHaveAttribute('aria-checked', String(on));
  const steering = page.getByRole('radiogroup', { name: 'STEERING HELP' });
  await expect(steering.getByRole('radio', { name: on ? 'STRONG' : 'OFF' })).toHaveAttribute('aria-checked', 'true');
}

test('assists: Rookie profile on, CLASSIC PRESET off and persists, ROOKIE PRESET from the pause menu acts at once', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);

  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.keyboard.type('rook');
  await page.getByRole('radio', { name: /I'M NEW TO RACING GAMES/ }).click();
  await page.getByRole('button', { name: "LET'S RACE" }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // Settings → ASSISTS: the Rookie preset has all four on.
  await page.getByRole('button', { name: /^SETTINGS/ }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
  await page.getByRole('tab', { name: 'ASSISTS' }).click();
  await expectAssists(page, true);

  // CLASSIC PRESET: all off, saved.
  await page.getByRole('button', { name: 'CLASSIC PRESET' }).click();
  await expectAssists(page, false);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0].assists);
  expect(saved).toEqual({ autoAccelerate: false, steering: 0, noKO: false, earlyBoost: false });
  // One control at a time also works.
  await page.getByRole('radiogroup', { name: 'STEERING HELP' }).getByRole('radio', { name: 'LIGHT' }).click();
  await expect(page.getByRole('radiogroup', { name: 'STEERING HELP' }).getByRole('radio', { name: 'LIGHT' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radiogroup', { name: 'STEERING HELP' }).getByRole('radio', { name: 'OFF' }).click();

  // Reload: still off.
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  await page.getByRole('button', { name: /^SETTINGS/ }).click();
  await page.getByRole('tab', { name: 'ASSISTS' }).click();
  await expectAssists(page, false);
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // A race with no assists; pause → SETTINGS → ASSISTS → ROOKIE PRESET reaches the race at once.
  // World Tour is the single race: the map, Neon Bay's card, RACE.
  await page.getByRole('button', { name: /^WORLD TOUR/ }).click();
  await page.locator('[data-planet="neon-bay"]').click();
  await page.locator('[data-tour-race]').click();
  await expect.poll(() => raceState(page), { timeout: 60_000 }).toMatch(/countdown|racing/);
  expect(await sessionAssists(page)).toEqual({ autoAccelerate: false, steering: 0, noKO: false, earlyBoost: false });
  await page.keyboard.press('Escape');
  await expect.poll(() => raceState(page), { timeout: 60_000 }).toBe('paused');
  await page.locator('.mz-pause').getByRole('button', { name: 'SETTINGS' }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
  await page.getByRole('tab', { name: 'ASSISTS' }).click();
  await page.getByRole('button', { name: 'ROOKIE PRESET' }).click();
  await expectAssists(page, true);
  expect(await sessionAssists(page)).toEqual({ autoAccelerate: true, steering: 2, noKO: true, earlyBoost: true });
  expect(await playerFlags(page)).toEqual({ noKO: true, earlyBoost: true });

  expect(errors, errors.join('\n')).toEqual([]);
});

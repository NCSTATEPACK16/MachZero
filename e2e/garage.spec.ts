import { expect, test, type Page } from '@playwright/test';

/**
 * Garage (feature `garage`, M2): the turntable shows the ship, parts are bought through a confirm dialog and
 * fitted, the livery editor recolours live, everything persists across a reload and the next race uses it.
 */

interface Debug {
  app: {
    route: { value: { name: string } };
    activeProfile: { value: { credits: number; owned: Record<string, number[]>; loadout: { chassisId: string; parts: Record<string, number>; livery: { primary: number; decal: number } } } | null };
    graphics: { preview: { model: unknown } | null; previewEl: unknown };
    createProfile(name: string, badge: number, preset: 'rookie' | 'classic'): void;
    selectChassis(id: string): void;
  };
  ships?: { def: { loadout: { chassisId: string; parts: Record<string, number>; livery: { decal: number } } } }[];
  race?: { state: string };
  memory(): { geometries: number; textures: number };
  grantCredits(n: number): void;
}

const URL = '/?features=profiles&debug=1&quality=low';
/** Run `fn` against the page's debug handle (window.__machzero). */
const dbg = <T>(page: Page, fn: (d: Debug) => T) => page.evaluate(`(${fn.toString()})(window.__machzero)`) as Promise<T>;
const screen = (page: Page) => page.locator('[data-screen]');
const profile = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.activeProfile.value!);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// SwiftShader renders the turntable at a few fps, so every click waits several frames to settle.
test.setTimeout(420_000);

test('buy and fit a part, paint the ship, persist, race with it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(URL);
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 120_000 });
  await page.evaluate(() => {
    const d = (window as unknown as { __machzero: Debug }).__machzero;
    d.app.createProfile('GARAGE', 3, 'rookie');
    d.grantCredits(2000);
  });
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // Menu → garage; the turntable draws the fitted ship.
  await page.getByRole('button', { name: /^GARAGE/ }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'garage');
  await expect(page.locator('.mzu-credits')).toHaveText('2,000');
  await expect.poll(() => dbg(page, (d) => Boolean(d.app.graphics.preview?.model && d.app.graphics.previewEl))).toBe(true);

  // Engine tab: Mk III costs 1,500 → confirm dialog → bought and fitted; Prototype is now out of reach.
  await page.getByRole('tab', { name: 'ENGINE' }).click();
  await page.getByRole('radio', { name: /^MK III/ }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('1,500 credits');
  await expect(dialog.getByRole('button', { name: /BUY/ })).toBeFocused();
  await page.keyboard.press('Escape'); // cancels the dialog, stays in the garage
  await expect(dialog).toHaveCount(0);
  await expect(screen(page)).toHaveAttribute('data-screen', 'garage');
  expect((await profile(page)).credits).toBe(2000);
  await page.getByRole('radio', { name: /^MK III/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /BUY/ }).click();
  await expect(page.locator('.mzu-credits')).toHaveText('500');
  await expect(page.getByRole('radio', { name: /^MK III/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /^PROTOTYPE/ })).toContainText('NEED 2,700 MORE');
  // Stock is owned: refitting it is free and immediate (no dialog), and Mk III stays owned.
  await page.getByRole('radio', { name: /^STOCK/ }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^STOCK/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /^MK III/ }).click();
  await expect(page.getByRole('radio', { name: /^MK III/ })).toHaveAttribute('aria-checked', 'true');
  expect((await profile(page)).credits).toBe(500);

  // Ship tab: chassis are free.
  await page.getByRole('tab', { name: 'SHIP' }).click();
  await page.getByRole('radio', { name: /^BASTION/ }).click();
  await expect(page.locator('.mzu-stage-label')).toContainText('BASTION');

  // Paint: lime body and the BOLT decal, applied live.
  await page.getByRole('tab', { name: 'PAINT' }).click();
  await page.getByRole('radiogroup', { name: 'BODY colour' }).getByRole('radio', { name: '#7dff3a' }).click();
  await page.getByRole('radio', { name: /BOLT/ }).click();
  const p = await profile(page);
  expect(p.loadout).toMatchObject({ chassisId: 'bastion', parts: { engine: 2 }, livery: { primary: 0x7dff3a, decal: 5 } });

  // Back to the menu; the turntable stops drawing.
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  expect(await dbg(page, (d) => d.app.graphics.previewEl)).toBeNull();

  // Reload: everything persisted.
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 120_000 });
  await expect(page.getByRole('button', { name: /^GARAGE/ })).toContainText('BASTION · 500 CREDITS');
  expect((await profile(page)).owned.engine).toEqual([0, 2]);

  // The race uses the garage loadout.
  await page.getByRole('button', { name: /^RACE/ }).click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 120_000 }).toMatch(/countdown|racing/);
  const ship = await dbg(page, (d) => d.ships![0].def.loadout);
  expect(ship).toMatchObject({ chassisId: 'bastion', parts: { engine: 2 }, livery: { decal: 5 } });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('cycling ships on the turntable does not grow GPU memory', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(URL);
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 120_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('LEAK', 0, 'classic'));
  await page.getByRole('button', { name: /^GARAGE/ }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'garage');
  const frames = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const mem = () => dbg(page, (d) => d.memory());
  // Through the app action rather than clicks (same rebuild path, without waiting for SwiftShader to settle).
  const ships = ['dart', 'wisp', 'comet', 'arrow', 'titan', 'bastion'];
  const cycle = async () => {
    for (const id of ships) {
      await page.evaluate((c) => (window as unknown as { __machzero: Debug }).__machzero.app.selectChassis(c), id);
      await frames();
      await expect(page.locator('.mzu-stage-label')).toContainText(id.toUpperCase());
    }
  };
  await cycle();
  const base = await mem();
  await cycle();
  await cycle();
  const after = await mem();
  expect(after.geometries).toBeLessThanOrEqual(base.geometries + 2);
  expect(after.textures).toBeLessThanOrEqual(base.textures + 2);
  expect(errors, errors.join('\n')).toEqual([]);
});

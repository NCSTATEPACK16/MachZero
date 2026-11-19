import { expect, test, type Page } from '@playwright/test';

/**
 * Touch controls (IMPLEMENTATION §M7b), in the `touch` project (a 956 × 440 landscape touch screen): taps only from
 * profile creation to a race; a drag in the steering zone steers right then left; BOOST boosts (boost from lap 1 on
 * the Rookie preset); PAUSE pauses and RESUME resumes; a key hides the touch layer and a touch brings it back.
 */

interface Debug {
  race?: { state: string };
  ships?: Array<{ def: { isPlayer?: boolean }; boosting: boolean }>;
  bus?: { on(type: string, fn: (e: { shipId: number }) => void): () => void };
  input: { device: string; steer: number };
}

const URL = '/?features=profiles,touch&debug=1&quality=low';
const screen = (page: Page) => page.locator('[data-screen]');
const raceState = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.race?.state);
const steer = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.input.steer);
const device = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.input.device);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** A one-finger touch drag through raw CDP touch events (Chromium turns them into touch pointer events). */
async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  return { start: (x: number, y: number) => send('touchStart', x, y), move: (x: number, y: number) => send('touchMove', x, y), end: () => send('touchEnd', 0, 0) };
}

test('a race by touch: steer, boost, pause and resume; a key hands over to the keyboard and a touch takes it back', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(URL);
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.locator('input[type=text]').fill('THUMB');
  await page.getByRole('radio', { name: /I'M NEW TO RACING GAMES/ }).tap();
  await page.getByRole('button', { name: "LET'S RACE" }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  // Stock a Shield and a Drop Mine (the garage purchase itself is covered by the garage spec).
  await page.evaluate(() => {
    const m = (window as unknown as { __machzero: { grantCredits(n: number): void; app: { buyItem(k: string): string } } }).__machzero;
    m.grantCredits(1000);
    m.app.buyItem('shield');
    m.app.buyItem('mine');
  });
  await page.getByRole('button', { name: /^RACE/ }).tap();

  // The grid intro card: a tap skips it.
  const intro = page.locator('.mz-hud.intro .mz-intro');
  await expect(intro).toBeVisible({ timeout: 60_000 });
  await intro.tap();
  await expect.poll(() => raceState(page), { timeout: 60_000 }).toMatch(/countdown|racing/);
  expect(await device(page)).toBe('touch');
  const layer = page.locator('.mz-touch-layer');
  await expect(layer).toBeVisible();
  await expect(page.locator('.mz-strip')).toBeVisible();
  await expect(page.locator('.mz-speed')).toBeHidden();
  await expect.poll(() => raceState(page), { timeout: 90_000 }).toBe('racing');

  // Steer: a drag in the steering zone gives a positive, then a negative steer.
  const zone = await page.locator('.mz-tz-steer').boundingBox();
  expect(zone).not.toBeNull();
  const x0 = zone!.x + zone!.width / 2;
  const y0 = zone!.y + zone!.height / 2;
  const t = await touch(page);
  await t.start(x0, y0);
  await t.move(x0 + 40, y0);
  await expect.poll(() => steer(page), { timeout: 30_000 }).toBeGreaterThan(0.2);
  await t.move(x0 - 40, y0);
  await expect.poll(() => steer(page), { timeout: 30_000 }).toBeLessThan(-0.2);
  await t.end();
  await expect.poll(() => steer(page), { timeout: 30_000 }).toBe(0);

  // BOOST (boost from lap 1 on the Rookie preset).
  await page.evaluate(() => {
    const w = window as unknown as { __machzero: Debug; __boosts: number };
    w.__boosts = 0;
    w.__machzero.bus!.on('ship:boost', (e) => {
      if (e.shipId === 0) w.__boosts++;
    });
  });
  await page.locator('.mz-tb-boost').tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __boosts: number }).__boosts), { timeout: 30_000 }).toBe(1);

  // Items: the ITEM button shows the selected item; the chip switches to the next one; a tap uses it.
  const item = page.locator('.mz-tb-item');
  await expect(item).toBeVisible();
  const first = await item.textContent();
  await page.locator('.mz-tb-itemNext').tap();
  await expect.poll(() => item.textContent(), { timeout: 30_000 }).not.toBe(first);
  await page.evaluate(() => {
    const w = window as unknown as { __machzero: Debug; __uses: string[] };
    w.__uses = [];
    w.__machzero.bus!.on('item:use', (e) => w.__uses.push((e as unknown as { kind: string }).kind));
  });
  await item.tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __uses: string[] }).__uses.length), { timeout: 30_000 }).toBe(1);

  // PAUSE, then RESUME on the pause panel.
  await page.locator('.mz-tb-pause').tap();
  await expect.poll(() => raceState(page), { timeout: 30_000 }).toBe('paused');
  await expect(layer).toBeHidden();
  await page.locator('.mz-pause').getByRole('button', { name: 'RESUME' }).tap();
  await expect.poll(() => raceState(page), { timeout: 30_000 }).toBe('racing');
  await expect(layer).toBeVisible();

  // A key: the keyboard takes over (layer hidden, keyboard HUD back). A touch brings the touch controls back.
  await page.keyboard.down('KeyW');
  await page.keyboard.up('KeyW');
  await expect.poll(() => device(page)).toBe('keyboard');
  await expect(layer).toBeHidden();
  await expect(page.locator('.mz-speed')).toBeVisible();
  await t.start(x0, y0);
  await t.end();
  await expect.poll(() => device(page)).toBe('touch');
  await expect(layer).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

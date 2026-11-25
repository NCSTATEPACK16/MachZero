import { expect, test, type Page } from '@playwright/test';

/**
 * M6a audio (IMPLEMENTATION §M6a step 12), with `music` on: menu sounds by keyboard, the shop's refusal, the
 * lightning telegraph and bolt in a race on Tempest Spire, the node budget, MONO and the sliders persisting. Playwright
 * presses a key once to unlock the audio context, as a player's first input would. The other specs run with `music`
 * off and must stay as they are.
 */

interface AudioDebug {
  state: string;
  nodes: number;
  voices: number;
  bufferBytes: number;
  presetsMs: number | null;
  presetsBy: 'worker' | 'main' | null;
  played: string[];
  song: string | null;
  lift: boolean;
  muffle: boolean;
  duckDb: number;
  audioMs: number;
}

interface Debug {
  audio(): AudioDebug;
  race?: { state: string };
  ships: { trackU: number }[];
  grantCredits(n: number): void;
  simulate(seconds: number): Promise<void>;
  app: {
    createProfile(name: string, badge: number, preset: 'rookie' | 'classic'): void;
    activeProfile: { value: { credits: number } | null };
    buyItem(kind: 'emp' | 'shield' | 'mine'): string;
    openSettings(back: 'menu' | 'pause'): void;
    session: { track: { id: string; length: number } };
    settings: { mono: { value: boolean }; masterVolume: { value: number }; musicVolume: { value: number }; sfxVolume: { value: number } };
  };
}

const dbg = <T>(page: Page, fn: (d: Debug) => T) => page.evaluate(fn as (d: unknown) => T, undefined as never);
const audio = (page: Page) => page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.audio());
const screen = (page: Page) => page.locator('[data-screen]');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** The first input: creates and resumes the context. Then wait for it to run and for the presets to render. */
async function unlock(page: Page): Promise<void> {
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await audio(page)).state, { timeout: 30_000 }).toBe('running');
  await expect.poll(async () => (await audio(page)).presetsMs !== null, { timeout: 60_000 }).toBe(true);
}

test('menus by keyboard and the shop make their sounds; no errors; nodes within budget', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?features=music&debug=1');
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('SOUND', 1, 'classic'));
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await unlock(page);
  const a = await audio(page);
  expect(a.presetsBy, 'the presets render in the Worker').toBe('worker');
  expect(a.bufferBytes).toBeGreaterThan(0);

  // Focus moves by keyboard → ui.move; Enter on a button → ui.confirm.
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await audio(page)).played).toContain('ui.move');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await audio(page)).played).toContain('ui.confirm');

  // A purchase with too few credits → ui.deny.
  const result = await page.evaluate(() => {
    const d = (window as unknown as { __machzero: Debug }).__machzero;
    d.grantCredits(-(d.app.activeProfile.value?.credits ?? 0));
    return d.app.buyItem('emp');
  });
  expect(result).toBe('short');
  await expect.poll(async () => (await audio(page)).played).toContain('ui.deny');

  expect((await audio(page)).nodes).toBeLessThanOrEqual(150);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a race on Tempest Spire plays the lightning telegraph and the bolt, within the node budget', async ({ page }) => {
  test.setTimeout(270_000);
  const errors = collectErrors(page);
  await page.goto('/?autopilot=1&debug=1&quality=low&world=tempest-spire&features=music,expansion');
  await page.waitForFunction(() => (window as unknown as { __machzero?: Debug }).__machzero?.race?.state === 'racing', undefined, { timeout: 60_000 });
  await unlock(page);
  expect(await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.session.track.id)).toBe('tempest-spire');

  // Skip the physics ahead towards the first lightning field (about 1,660–1,860 m), then let real frames run into it.
  // `simulate` steps in 5 s chunks (up to ~650 m), so it stops before 700 m: the grid reads about 4,300 m.
  const dist = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __machzero: Debug }).__machzero;
      return m.ships[0].trackU * m.app.session.track.length;
    });
  for (let i = 0; i < 10; i++) {
    const d = await dist();
    if (d > 700 && d < 3000) break;
    await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(5));
  }
  expect(await dist(), 'the skip stops short of the field').toBeLessThan(1600);
  let peak = 0;
  await expect
    .poll(
      async () => {
        const a = await audio(page);
        peak = Math.max(peak, a.nodes);
        return ['lightning.charge', 'lightning.bolt'].filter((id) => a.played.includes(id));
      },
      { timeout: 240_000, intervals: [250] },
    )
    .toEqual(['lightning.charge', 'lightning.bolt']);
  expect(peak, 'audio nodes alive').toBeLessThanOrEqual(150);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('MONO and the three sliders persist across a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?features=music&debug=1');
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('MONO', 2, 'classic'));
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.openSettings('menu'));
  await page.getByRole('tab', { name: 'SOUND' }).click();
  await page.getByRole('switch', { name: /^MONO/ }).click();
  await page.getByRole('slider', { name: /^MASTER/ }).fill('50');
  await page.getByRole('slider', { name: /^EFFECTS/ }).fill('40');
  await page.getByRole('slider', { name: /^MUSIC/ }).fill('30');
  const read = () => dbg(page, () => {
    const s = (window as unknown as { __machzero: Debug }).__machzero.app.settings;
    return { mono: s.mono.value, master: s.masterVolume.value, effects: s.sfxVolume.value, music: s.musicVolume.value };
  });
  expect(await read()).toEqual({ mono: true, master: 0.5, effects: 0.4, music: 0.3 });
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  expect(await read()).toEqual({ mono: true, master: 0.5, effects: 0.4, music: 0.3 });
  // SOUND TEST opens from Settings → Sound and lists the sounds.
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.openSettings('menu'));
  await page.getByRole('tab', { name: 'SOUND' }).click();
  await page.getByRole('button', { name: 'SOUND TEST' }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'soundtest');
  await expect(page.locator('[data-sound="lightning.bolt"]')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// M6b: the music (IMPLEMENTATION §M6b step 10)
// ---------------------------------------------------------------------------------------------------------------

const MB100 = 100 * 1024 * 1024;

test('the menu theme starts after the first input, within the buffer budget', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.goto('/?features=music&debug=1');
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('THEME', 1, 'classic'));
  await unlock(page);
  await expect.poll(async () => (await audio(page)).song, { timeout: 90_000 }).toBe('menu');
  const a = await audio(page);
  expect(a.lift).toBe(false);
  expect(a.bufferBytes).toBeLessThanOrEqual(MB100);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an autopilot race on Neon Bay plays neon-bay, and the final lap brings the lift in', async ({ page }) => {
  test.setTimeout(330_000);
  const errors = collectErrors(page);
  await page.goto('/?autopilot=1&debug=1&quality=low&world=neon-bay&features=music');
  await page.waitForFunction(() => (window as unknown as { __machzero?: Debug }).__machzero?.race?.state === 'racing', undefined, { timeout: 60_000 });
  await unlock(page);
  await expect.poll(async () => (await audio(page)).song, { timeout: 120_000 }).toBe('neon-bay');
  expect((await audio(page)).lift, 'no lift before the final lap').toBe(false);
  // Skip ahead in 5 s chunks (no frames run inside one), letting real frames run between them, until the lift is in.
  let peakBytes = 0;
  let lift = false;
  for (let i = 0; i < 40 && !lift; i++) {
    await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(5));
    await page.waitForTimeout(400);
    const a = await audio(page);
    peakBytes = Math.max(peakBytes, a.bufferBytes);
    lift = a.lift;
    expect(a.song === 'neon-bay' || a.song === null, `song ${a.song}`).toBe(true);
  }
  expect(lift, 'the lift on the final lap').toBe(true);
  expect(peakBytes).toBeLessThanOrEqual(MB100);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('SOUND TEST plays the three songs, with the lift and the loop, within the buffer budget', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await page.goto('/?features=music&jukebox=1&debug=1');
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('JUKE', 3, 'classic'));
  await expect(screen(page)).toHaveAttribute('data-screen', 'soundtest', { timeout: 30_000 });
  await unlock(page);
  let peakBytes = 0;
  for (const id of ['menu', 'neon-bay', 'orbital-ring']) {
    const row = page.locator(`[data-song="${id}"]`);
    await row.locator('[data-action="play"]').click();
    await expect
      .poll(
        async () => {
          const a = await audio(page);
          peakBytes = Math.max(peakBytes, a.bufferBytes);
          return a.song;
        },
        { timeout: 120_000 },
      )
      .toBe(id);
    await expect(row).toContainText('LUFS');
  }
  // The lift on Orbital Ring, then straight into its loop.
  const orbital = page.locator('[data-song="orbital-ring"]');
  await orbital.locator('[data-action="lift"]').click();
  await expect.poll(async () => (await audio(page)).lift).toBe(true);
  await orbital.locator('[data-action="loop"]').click();
  await expect.poll(async () => (await audio(page)).song).toBe('orbital-ring');
  // STOP gives the menu theme back.
  await orbital.locator('[data-action="stop"]').click();
  await expect.poll(async () => (await audio(page)).song, { timeout: 60_000 }).toBe('menu');
  expect(peakBytes).toBeLessThanOrEqual(MB100);
  expect((await audio(page)).nodes).toBeLessThanOrEqual(150);
  expect(errors, errors.join('\n')).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Grand Prix by pad only (IMPLEMENTATION §GP): a profile with the Neon Cup open (Orbital Ring cleared on the World
 * Tour), menu → GRAND PRIX → START CUP, race 1 driven to the finish by the player's AI (debug `simulate`, the same
 * autopilot path headless), Ⓐ on the results screen → cup standings; reload
 * (the app closed between races) → CONTINUE CUP → the same standings, then race 2 on the next world with the
 * reverse grid. No restarts in a cup: R does nothing and the pause panel has no RESTART.
 */

interface Debug {
  app: {
    cup: { cupId: string; tier: string; results: number[][] } | null;
    createProfile(name: string, badge: number, preset: 'rookie' | 'classic'): void;
    currentWorld: { id: string } | null;
  };
  race?: { state: string };
  ships?: { def: { id: number; gridIndex: number } }[];
  simulate(seconds: number): Promise<void>;
}

type PadWindow = Window & { __pad: { buttons: { pressed: boolean; value: number }[]; polls: number } };

const PAD = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

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

/**
 * Open both cups (IMPLEMENTATION §M8a: a cup opens when its world is cleared on the World Tour): Orbital Ring for the
 * Neon Cup and Abyss Line for the Storm Cup, then reload to the menu.
 */
async function unlockCups(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('machzero.save')!);
    s.profiles[0].tour = { granted: [], trophies: { 'orbital-ring': ['rookie'], 'abyss-line': ['rookie'] } };
    localStorage.setItem('machzero.save', JSON.stringify(s));
  });
  await page.reload();
  await expect(page.locator('[data-screen]')).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
}

/** On the results screen: wait for the whole tally, then Ⓐ on its focused button (STANDINGS in a cup). */
async function resultsToStandings(page: Page): Promise<void> {
  await expect(page.locator('[data-screen]')).toHaveAttribute('data-screen', 'results', { timeout: 120_000 });
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-res-standings]')).toBeFocused();
  await padPress(page, PAD.A);
}

/** D-pad down until the focused button's text starts with `label`. */
async function focusButton(page: Page, label: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const text = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? '');
    if (text.trim().startsWith(label)) return;
    await padPress(page, PAD.DOWN);
  }
  throw new Error(`could not focus ${label} by pad`);
}

test('a Grand Prix cup by pad: race 1, standings, reload, CONTINUE CUP, race 2 on a reverse grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await installPad(page);
  await page.goto('/?debug=1&quality=low');
  const screen = page.locator('[data-screen]');
  await expect(screen).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('CUPPER', 3, 'classic'));
  await expect(screen).toHaveAttribute('data-screen', 'menu');
  await unlockCups(page);

  // Menu → GRAND PRIX → START PILOT CUP (a Classic profile races Pilot rivals).
  await focusButton(page, 'GRAND PRIX');
  await padPress(page, PAD.A);
  await expect(screen).toHaveAttribute('data-screen', 'gp');
  await expect(page.locator('[data-gp-start]')).toBeFocused();
  await expect(page.locator('[data-gp-start]')).toHaveText('START NEON CUP · PILOT');
  await padPress(page, PAD.A);
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  expect(await dbg(page, (d) => d.app.currentWorld?.id)).toBe('neon-bay');
  expect(await dbg(page, (d) => d.app.cup)).toEqual({ cupId: 'neon', tier: 'pilot', results: [] });

  // No restarts: the pause panel has RETIRE and no RESTART.
  await padPress(page, PAD.START);
  await expect.poll(() => dbg(page, (d) => d.race?.state)).toBe('paused');
  await expect(page.locator('.mz-pause button', { hasText: 'RETIRE' })).toBeVisible();
  await expect(page.locator('.mz-pause button', { hasText: 'RESTART' })).toHaveCount(0);
  await padPress(page, PAD.START);
  await expect.poll(() => dbg(page, (d) => d.race?.state)).not.toBe('paused');

  // Race 1 to the finish on autopilot; the results screen (STANDINGS, no RACE AGAIN), Ⓐ → the cup standings.
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 120_000 }).toBe('results');
  await expect(screen).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  await expect(page.locator('[data-res-again]')).toHaveCount(0);
  await page.keyboard.press('KeyR'); // restart: ignored in a cup
  expect(await dbg(page, (d) => d.race?.state)).toBe('results');
  await resultsToStandings(page);
  await expect(screen).toHaveAttribute('data-screen', 'cup');
  await expect(page.locator('[data-cup-done="1"]')).toBeVisible();
  await expect(page.locator('.mzu-cup-row[data-ship]')).toHaveCount(8);
  const points = await page.locator('.mzu-cup-row[data-ship] .pts').allInnerTexts();
  expect(points.map(Number).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  const cup1 = await dbg(page, (d) => d.app.cup);
  expect(cup1?.results).toHaveLength(1);

  // The app closes between races: the cup is in the save; the menu offers CONTINUE CUP first.
  await page.reload();
  await expect(screen).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  const cont = page.getByRole('button', { name: /^CONTINUE CUP/ });
  await expect(cont).toBeFocused();
  await expect(cont).toContainText('RACE 2 OF 5');
  await padPress(page, PAD.A);
  await expect(screen).toHaveAttribute('data-screen', 'cup');
  expect(await dbg(page, (d) => d.app.cup)).toEqual(cup1);
  await expect(page.locator('[data-cup-next]')).toBeFocused();
  await padPress(page, PAD.A);
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
  expect(await dbg(page, (d) => d.app.currentWorld?.id)).toBe('sunset-mesa');
  // Reverse grid: the cup leader starts last.
  const grid = await dbg(page, (d) => d.ships!.map((s) => [s.def.id, s.def.gridIndex]));
  const leaderId = cup1!.results[0].indexOf(1); // the race-1 winner leads the cup
  expect(grid.find(([id]) => id === leaderId)?.[1]).toBe(7);
  expect(errors, errors.join('\n')).toEqual([]);
});

/**
 * The Storm Cup by pad only, start to finish (IMPLEMENTATION §X6): with the `expansion` flag on and Abyss Line built,
 * the Grand Prix screen offers it beside the Neon Cup (both opened by a World Tour fixture). Pick its tab, start it,
 * and run all five races (each to the finish on autopilot, Ⓐ on the results screen, Ⓐ on NEXT RACE) in its world order, ending on Abyss Line, to the final
 * standings. No console error on the way.
 */
test('the Storm Cup by pad: pick it, five races in order, final standings', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await installPad(page);
  await page.goto('/?features=expansion&debug=1&quality=low');
  const screen = page.locator('[data-screen]');
  await expect(screen).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('STORMY', 2, 'classic'));
  await expect(screen).toHaveAttribute('data-screen', 'menu');
  await unlockCups(page);

  await focusButton(page, 'GRAND PRIX');
  await padPress(page, PAD.A);
  await expect(screen).toHaveAttribute('data-screen', 'gp');
  await expect(page.locator('[data-cup="storm"]')).toBeVisible();
  // Up from START to the cup tabs, across to STORM CUP, Ⓐ to show it, then back down to START.
  for (let i = 0; i < 8; i++) {
    if (await page.locator('[data-cup="storm"]').evaluate((el) => el === document.activeElement)) break;
    const onTab = await page.evaluate(() => !!(document.activeElement as HTMLElement | null)?.dataset.cup);
    await padPress(page, onTab ? PAD.RIGHT : PAD.UP);
  }
  await expect(page.locator('[data-cup="storm"]')).toBeFocused();
  await padPress(page, PAD.A);
  await expect(page.locator('[data-cup-shown="storm"]')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    if (await page.locator('[data-gp-start]').evaluate((el) => el === document.activeElement)) break;
    await padPress(page, PAD.DOWN);
  }
  await expect(page.locator('[data-gp-start]')).toHaveText('START STORM CUP · PILOT');
  await padPress(page, PAD.A);

  const order = ['sunset-mesa', 'tempest-spire', 'jade-ruins', 'cinder-forge', 'abyss-line'];
  for (let race = 0; race < order.length; race++) {
    await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/countdown|racing/);
    expect(await dbg(page, (d) => d.app.currentWorld?.id)).toBe(order[race]);
    expect((await dbg(page, (d) => d.app.cup))?.cupId).toBe('storm');
    await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
    await resultsToStandings(page);
    await expect(screen).toHaveAttribute('data-screen', 'cup');
    if (race < order.length - 1) {
      await expect(page.locator(`[data-cup-done="${race + 1}"]`)).toBeVisible();
      await expect(page.locator('[data-cup-next]')).toBeFocused();
      await padPress(page, PAD.A);
    }
  }
  // The final standings: the cup is over and out of the save.
  await expect(page.locator('[data-cup-final]')).toBeVisible();
  await expect(page.locator('.mzu-cup-row[data-ship]')).toHaveCount(8);
  expect(await dbg(page, (d) => d.app.cup)).toBeNull();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the championship (IMPLEMENTATION §M8c): no card with one cup; locked for a new profile; a season ends on the season table', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const screen = page.locator('[data-screen]');
  const editSave = async (fn: string) => {
    await page.evaluate(`(() => { const s = JSON.parse(localStorage.getItem('machzero.save')); (${fn})(s); localStorage.setItem('machzero.save', JSON.stringify(s)); })()`);
    await page.reload();
    await expect(screen).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  };
  // One cup visible (no `expansion`): no CHAMPIONSHIP card, even with the Neon Cup won.
  await page.goto('/?debug=1&quality=low');
  await expect(screen).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile('CHAMP', 3, 'classic'));
  await expect(screen).toHaveAttribute('data-screen', 'menu');
  await editSave(`(s) => { s.profiles[0].trophies = { neon: ['pilot'] }; }`);
  await page.getByRole('button', { name: /^GRAND PRIX/ }).click();
  await expect(screen).toHaveAttribute('data-screen', 'gp');
  await expect(page.locator('[data-cup="championship"]')).toHaveCount(0);

  // Two cups (`expansion`): the card is there, locked until both cups are won.
  await page.goto('/?features=expansion&debug=1&quality=low');
  await expect(screen).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  await page.getByRole('button', { name: /^GRAND PRIX/ }).click();
  await page.locator('[data-cup="championship"]').click();
  await expect(page.locator('[data-season-locked]')).toHaveText(/WIN EVERY CUP TO UNLOCK/);
  await expect(page.locator('[data-season-start]')).toHaveCount(0);

  // Both cups won: START. Then a fixture one race from the end of the season: the Neon Cup done, the Storm Cup at
  // race 5. Finish it: the cup's final standings, then the season table and its end.
  await editSave(`(s) => { s.profiles[0].trophies = { neon: ['rookie'], storm: ['rookie'] }; s.profiles[0].tour = { granted: [], trophies: { 'orbital-ring': ['rookie'], 'abyss-line': ['rookie'] } }; }`);
  await page.getByRole('button', { name: /^GRAND PRIX/ }).click();
  await page.locator('[data-cup="championship"]').click();
  await expect(page.locator('[data-season-start]')).toHaveText('START CHAMPIONSHIP · PILOT');
  const row = [1, 2, 3, 4, 5, 6, 7, 8];
  await editSave(`(s) => {
    const p = s.profiles[0];
    p.season = { tier: 'pilot', done: [{ cupId: 'neon', tier: 'pilot', results: [${JSON.stringify(row)}, ${JSON.stringify(row)}, ${JSON.stringify(row)}, ${JSON.stringify(row)}, ${JSON.stringify(row)}] }] };
    p.cup = { cupId: 'storm', tier: 'pilot', results: [${JSON.stringify(row)}, ${JSON.stringify(row)}, ${JSON.stringify(row)}, ${JSON.stringify(row)}] };
  }`);
  // The menu offers CONTINUE SEASON (in place of GRAND PRIX, as for a cup): the standings, with QUIT SEASON.
  await expect(page.getByRole('button', { name: /^CONTINUE SEASON/ })).toContainText('SEASON CUP 2 OF 2');
  await expect(page.getByRole('button', { name: /^GRAND PRIX/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^CONTINUE SEASON/ }).click();
  await expect(screen).toHaveAttribute('data-screen', 'cup');
  await expect(screen).toContainText('SEASON · CUP 2 OF 2');
  await expect(page.locator('[data-quit-season]')).toBeVisible();
  await expect(page.locator('[data-quit-cup]')).toHaveCount(0);
  await page.locator('[data-cup-next]').click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/title|countdown|racing/);
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect(screen).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  // The results' tally first (an input during it only shows the whole tally), then STANDINGS.
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-res-standings]').click();
  // The Storm Cup's final standings, then the season table: the end of the season.
  await expect(screen).toHaveAttribute('data-screen', 'cup');
  await page.locator('[data-season-table-open]').click();
  await expect(page.locator('[data-season-view="end"]')).toBeVisible();
  await expect(page.locator('[data-season-table="2"] [data-ship]')).toHaveCount(8);
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0]);
  expect(p.season).toBeNull();
  expect(p.cup).toBeNull();
  // The player won all nine races before this one: they are the champion, paid once.
  expect(p.champion).toEqual(['pilot']);
  await expect(page.locator('[data-champion="pilot"]')).toContainText('PILOT champion');
  await page.locator('[data-season-done]').click();
  await expect(screen).toHaveAttribute('data-screen', 'menu');

  // Between cups: a season one race from the end of the Neon Cup. Its final standings, the season table, NEXT CUP:
  // the Storm Cup's standings before its race 1 (already queued, so a reload here would resume it).
  await editSave(`(s) => {
    const p = s.profiles[0];
    p.season = { tier: 'pilot', done: [] };
    p.cup = { cupId: 'neon', tier: 'pilot', results: [${JSON.stringify(row)}, ${JSON.stringify(row)}, ${JSON.stringify(row)}, ${JSON.stringify(row)}] };
  }`);
  await page.getByRole('button', { name: /^CONTINUE SEASON/ }).click();
  await page.locator('[data-cup-next]').click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/title|countdown|racing/);
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 45_000 });
  await page.locator('[data-res-standings]').click();
  await expect(page.locator('[data-cup-final]')).toBeVisible();
  const mid = await page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0]);
  expect(mid.season.done.map((c: { cupId: string }) => c.cupId)).toEqual(['neon']);
  expect(mid.cup).toEqual({ cupId: 'storm', tier: 'pilot', results: [] });
  await page.locator('[data-season-table-open]').click();
  await expect(page.locator('[data-season-view="between"]')).toBeVisible();
  await expect(page.locator('[data-season-table="1"] [data-ship]')).toHaveCount(8);
  await page.locator('[data-season-next]').click();
  await expect(screen).toContainText('SEASON · CUP 2 OF 2');
  await expect(page.locator('[data-cup-done="0"]')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

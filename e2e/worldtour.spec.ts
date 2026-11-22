import { expect, test, type Page } from '@playwright/test';

/**
 * World Tour (IMPLEMENTATION §M8a), with `?features=modes`: a new profile sees world 1 open and world 2 locked, and
 * the Neon Cup locked; by keyboard the map's chain, the card's RACE, an autopilot race to the end, the results screen
 * with its tally (FIRST CLEAR 1,000, the unlock card) and NEXT WORLD to Sunset Mesa's card; a save fixture with world 1
 * cleared shows world 2 open; a v8 save with records on three worlds loads with those three open.
 */

interface Debug {
  race?: { state: string };
  simulate(seconds: number): Promise<void>;
  app: {
    createProfile(name: string, badge: number, preset: string): void;
    route: { value: { name: string } };
    lastResult: { value: { tally: { label: string; amount: number }[]; unlocked: string | null; newTrophies: string[] } | null };
  };
}

const URL = '/?features=modes&debug=1&quality=low';
const screen = (page: Page) => page.locator('[data-screen]');
const dbg = <T>(page: Page, fn: (d: Debug) => T) => page.evaluate(`(${fn.toString()})(window.__machzero)`) as Promise<T>;
const planet = (page: Page, id: string) => page.locator(`[data-planet="${id}"]`);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function newProfile(page: Page, name: string, preset: 'rookie' | 'classic' = 'rookie'): Promise<void> {
  await page.goto(URL);
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.evaluate(([n, p]) => (window as unknown as { __machzero: Debug }).__machzero.app.createProfile(n, 1, p), [name, preset]);
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
}

/** Rewrite the stored save with `fn` and reload to the menu. */
async function editSave(page: Page, fn: string): Promise<void> {
  await page.evaluate(`(() => { const s = JSON.parse(localStorage.getItem('machzero.save')); (${fn})(s); localStorage.setItem('machzero.save', JSON.stringify(s)); })()`);
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
}

test('a new profile: world 1 open, world 2 locked, the Neon Cup locked; a race from the card ends on the results screen and NEXT WORLD opens world 2', async ({ page }) => {
  const errors = collectErrors(page);
  await newProfile(page, 'TOURIST');

  // The menu: WORLD TOUR in place of RACE and WORLDS.
  await expect(page.getByRole('button', { name: /^WORLD TOUR/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^WORLD TOUR/ })).toContainText('0 OF 5 WORLDS CLEARED');
  await expect(page.getByRole('button', { name: /^RACE/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^WORLDS/ })).toHaveCount(0);

  // Grand Prix: the Neon Cup is locked until Orbital Ring is cleared.
  await page.getByRole('button', { name: /^GRAND PRIX/ }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'gp');
  await expect(page.locator('[data-cup-locked]')).toHaveText(/CLEAR ORBITAL RING TO UNLOCK/);
  await expect(page.locator('[data-gp-start]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The map: world 1 open and focused, world 2 locked; → follows the chain.
  await page.getByRole('button', { name: /^WORLD TOUR/ }).click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'tour');
  await expect(planet(page, 'neon-bay')).toBeFocused();
  await expect(planet(page, 'neon-bay')).not.toHaveAttribute('data-locked', '');
  await expect(planet(page, 'sunset-mesa')).toHaveAttribute('data-locked', '');
  await page.keyboard.press('ArrowRight');
  await expect(planet(page, 'sunset-mesa')).toBeFocused();
  // A locked world's card: the unlock line and no RACE.
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-world-card="sunset-mesa"]')).toContainText('FINISH TOP 3 ON NEON BAY TO UNLOCK');
  await expect(page.locator('[data-tour-race]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-world-card]')).toHaveCount(0);
  await expect(planet(page, 'sunset-mesa')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');

  // World 1's card: RACE starts the race.
  await expect(page.locator('[data-tour-race]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/title|countdown|racing/);
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect(screen(page)).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });

  // The results screen: the tally runs, then the unlock card; a Rookie win clears Neon Bay.
  const r = await dbg(page, (d) => d.app.lastResult.value);
  expect(r?.tally.map((l) => l.label)).toContain('FIRST CLEAR');
  expect(r?.tally.find((l) => l.label === 'FIRST CLEAR')?.amount).toBe(1000);
  expect(r?.unlocked).toBe('sunset-mesa');
  expect(r?.newTrophies).toEqual(['rookie']);
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-tally="FIRST CLEAR"]')).toContainText('+1,000');
  await expect(page.locator('[data-unlocked="sunset-mesa"]')).toContainText('SUNSET MESA UNLOCKED');
  await expect(page.locator('[data-res-next]')).toBeFocused();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0]);
  expect(saved.tour.trophies['neon-bay']).toEqual(['rookie']);

  // NEXT WORLD: the map with Sunset Mesa's card open.
  await page.keyboard.press('Enter');
  await expect(screen(page)).toHaveAttribute('data-screen', 'tour');
  await expect(page.locator('[data-world-card="sunset-mesa"]')).toBeVisible();
  await expect(page.locator('[data-tour-race]')).toBeFocused();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('any input shows the whole tally at once; RACE AGAIN and WORLD MAP leave the results', async ({ page }) => {
  const errors = collectErrors(page);
  await newProfile(page, 'AGAIN');
  await page.getByRole('button', { name: /^WORLD TOUR/ }).click();
  await planet(page, 'neon-bay').click();
  await page.locator('[data-tour-race]').click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/title|countdown|racing/);
  // The moment the results screen mounts (before its first tally line), a key and then a tap on the focused button:
  // the key is taken (default prevented) and shows the whole tally; the tap's click does nothing.
  await page.evaluate(() => {
    const w = window as unknown as { __probe: { keyTaken?: boolean; doneAtMount?: boolean } };
    w.__probe = {};
    const mo = new MutationObserver(() => {
      if (!document.querySelector('[data-screen="results"]')) return;
      mo.disconnect();
      w.__probe.doneAtMount = !!document.querySelector('[data-results-done]');
      const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      document.activeElement?.dispatchEvent(key);
      w.__probe.keyTaken = key.defaultPrevented;
      const b = document.activeElement as HTMLElement;
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      b.click();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect(screen(page)).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  await expect(page.locator('[data-results-done]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __probe: unknown }).__probe)).toEqual({ doneAtMount: false, keyTaken: true });
  await expect(page.locator('[data-tally="1ST PLACE"]')).toBeVisible();
  await expect(screen(page)).toHaveAttribute('data-screen', 'results'); // the click on NEXT WORLD was swallowed
  // RACE AGAIN: the same world again, through the grid intro; this time it pays no first-clear bonus.
  await page.locator('[data-res-again]').click();
  await expect.poll(() => dbg(page, (d) => d.race?.state), { timeout: 90_000 }).toMatch(/title|countdown|racing/);
  expect(await dbg(page, (d) => d.app.route.value.name)).toBe('race');
  await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.simulate(600));
  await expect(screen(page)).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-tally="FIRST CLEAR"]')).toHaveCount(0);
  await expect(page.locator('[data-res-next]')).toHaveCount(0);
  await expect(page.locator('[data-res-again]')).toBeFocused();
  // WORLD MAP: the map, world 2 open.
  await page.locator('[data-res-map]').click();
  await expect(screen(page)).toHaveAttribute('data-screen', 'tour');
  await expect(planet(page, 'sunset-mesa')).not.toHaveAttribute('data-locked', '');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a save with world 1 cleared opens world 2; a v8 save with records on three worlds opens those three', async ({ page }) => {
  const errors = collectErrors(page);
  await newProfile(page, 'FIXTURE', 'classic');
  await editSave(page, `(s) => { s.profiles[0].tour = { granted: [], trophies: { 'neon-bay': ['rookie'] } }; }`);
  await page.getByRole('button', { name: /^WORLD TOUR/ }).click();
  await expect(planet(page, 'sunset-mesa')).not.toHaveAttribute('data-locked', '');
  await expect(planet(page, 'cryo-station')).toHaveAttribute('data-locked', '');

  // A v8 save (before World Tour): lap records on worlds 1 and 3 grant worlds 1–3.
  await editSave(
    page,
    `(s) => { s.version = 8; const p = s.profiles[0]; delete p.tour; delete p.season; delete p.champion; delete p.tutorialDone; delete s.settings.ghosts;
       p.records = { 'neon-bay': { bestLap: 31.5 }, 'cryo-station': { bestLap: 28.25 } }; p.stats.races = 4; p.trophies = { neon: ['pilot'] }; }`,
  );
  const loaded = await page.evaluate(() => (window as unknown as { __machzero: { app: { save: { value: { version: number; profiles: { tour: { granted: string[] } }[] } } } } }).__machzero.app.save.value);
  expect(loaded.version).toBe(9);
  expect(loaded.profiles[0].tour.granted).toEqual(['neon-bay', 'sunset-mesa', 'cryo-station']);
  await page.getByRole('button', { name: /^WORLD TOUR/ }).click();
  for (const id of ['neon-bay', 'sunset-mesa', 'cryo-station']) await expect(planet(page, id)).not.toHaveAttribute('data-locked', '');
  await expect(planet(page, 'jade-ruins')).toHaveAttribute('data-locked', '');
  // Its Neon Cup trophy keeps the Neon Cup open.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^GRAND PRIX/ }).click();
  await expect(page.locator('[data-gp-start]')).toBeVisible();
  await expect(page.locator('[data-cup-locked]')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

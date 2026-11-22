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

const URL = '/?debug=1&quality=low'; // touch is on by default since M7c
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
  // The tutorial has its own touch test (below): this race is about the controls.
  await page.evaluate(() => (window as unknown as { __machzero: { app: { updateProfile(f: (p: { tutorialDone: boolean }) => void): void } } }).__machzero.app.updateProfile((p) => (p.tutorialDone = true)));
  // World Tour is the single race: the map, Neon Bay's card, RACE.
  await page.getByRole('button', { name: /^WORLD TOUR/ }).tap();
  await page.locator('[data-planet="neon-bay"]').tap();
  await page.locator('[data-tour-race]').tap();

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

/** Every visible button, tab, radio and input under 44 × 44 points (CSS px), as "text (w×h)". */
const tooSmall = async (page: Page) => {
  // Measure at rest: screen entrances scale their content for a fifth of a second.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, [role=tab], [role=radio], input')) {
      if (el instanceof HTMLInputElement && (el.type === 'file' || el.type === 'hidden')) continue;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || el.closest('[hidden]')) continue;
      // Allow half a point of rounding.
      if (r.width < 43.5 || r.height < 43.5) out.push(`${(el.getAttribute('aria-label') ?? el.textContent ?? el.className).trim().slice(0, 30)} (${r.width.toFixed(0)}×${r.height.toFixed(0)})`);
    }
    return out;
  });
};


async function toMenu(page: Page, name: string) {
  await page.goto(URL);
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  expect(await tooSmall(page), 'create').toEqual([]);
  await page.locator('input[type=text]').fill(name);
  await page.getByRole('radio', { name: /I'VE RACED BEFORE/ }).tap();
  await page.getByRole('button', { name: "LET'S RACE" }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
}

test('every menu target is at least 44 × 44 points; a garage purchase and a livery change by taps only', async ({ page }) => {
  const errors = collectErrors(page);
  await toMenu(page, 'TAPS');
  expect(await tooSmall(page), 'menu').toEqual([]);

  // Profiles (with a second profile on the list).
  await page.evaluate(() => (window as unknown as { __machzero: { app: { route: { value: unknown } } } }).__machzero.app.route.value = { name: 'profiles' });
  await expect(screen(page)).toHaveAttribute('data-screen', 'profiles');
  expect(await tooSmall(page), 'profiles').toEqual([]);
  await page.getByRole('button', { name: /MENU/ }).first().tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');

  // The world map and Grand Prix.
  await page.getByRole('button', { name: /^WORLD TOUR/ }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'tour');
  expect(await tooSmall(page), 'map').toEqual([]);
  await page.getByRole('button', { name: 'MENU' }).tap();
  await page.getByRole('button', { name: /^GRAND PRIX/ }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'gp');
  expect(await tooSmall(page), 'grand prix').toEqual([]);
  await page.getByRole('button', { name: 'MENU' }).tap();

  // Settings and every tab.
  await page.getByRole('button', { name: /^SETTINGS/ }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
  for (const tab of ['RACE', 'ASSISTS', 'SOUND', 'GRAPHICS', 'COMFORT', 'CONTROLS', 'SAVES']) {
    await page.getByRole('tab', { name: tab }).tap();
    expect(await tooSmall(page), `settings ${tab}`).toEqual([]);
  }
  // On a touch screen the Controls tab leads with the TOUCH section.
  await page.getByRole('tab', { name: 'CONTROLS' }).tap();
  await expect(page.locator('.mzu-subhead').first()).toHaveText('TOUCH');
  await page.getByRole('button', { name: 'MENU' }).tap();

  // Garage: every tab; buy and fit a part, change the paint, by taps.
  await page.evaluate(() => (window as unknown as { __machzero: { grantCredits(n: number): void } }).__machzero.grantCredits(5000));
  await page.getByRole('button', { name: /^GARAGE/ }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'garage');
  for (const tab of await page.getByRole('tab').allTextContents()) {
    await page.getByRole('tab', { name: tab.trim(), exact: true }).tap();
    expect(await tooSmall(page), `garage ${tab}`).toEqual([]);
  }
  await page.getByRole('tab', { name: 'ENGINE', exact: true }).tap();
  const credits = await page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0].credits as number);
  await page.locator('.mzu-garage [role=radio]').nth(1).tap();
  const buy = page.getByRole('button', { name: /^BUY/ });
  if (await buy.count()) await buy.first().tap();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('machzero.save')!).profiles[0].credits as number)).toBeLessThan(credits);
  await page.getByRole('tab', { name: 'PAINT', exact: true }).tap();
  const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('machzero.save')!).profiles[0].loadout.livery));
  await page.locator('.mzu-garage [role=radio]').last().tap();
  await expect.poll(() => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('machzero.save')!).profiles[0].loadout.livery))).not.toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('race screens by touch: the pause panel and the results screen are 44-point targets; a cup starts by taps', async ({ page }) => {
  const errors = collectErrors(page);
  await toMenu(page, 'CUPS');
  // The Neon Cup opens with Orbital Ring cleared on the World Tour (IMPLEMENTATION §M8a).
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('machzero.save')!);
    s.profiles[0].tour = { granted: [], trophies: { 'orbital-ring': ['pilot'] } };
    localStorage.setItem('machzero.save', JSON.stringify(s));
  });
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu', { timeout: 60_000 });
  await page.getByRole('button', { name: /^GRAND PRIX/ }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'gp');
  await page.getByRole('button', { name: /START/ }).first().tap();
  await expect.poll(() => raceState(page), { timeout: 60_000 }).toMatch(/title|countdown|racing/);
  const intro = page.locator('.mz-hud.intro .mz-intro');
  if (await intro.count()) await intro.tap();
  await expect.poll(() => raceState(page), { timeout: 90_000 }).toMatch(/countdown|racing/);
  await page.locator('.mz-tb-pause').tap();
  await expect.poll(() => raceState(page), { timeout: 30_000 }).toBe('paused');
  expect(await tooSmall(page), 'pause').toEqual([]);
  // The results panel: let the player's AI finish the race.
  await page.locator('.mz-pause').getByRole('button', { name: 'RESUME' }).tap();
  await page.evaluate(() => (window as unknown as { __machzero: { simulate(s: number): Promise<void> } }).__machzero.simulate(400));
  await expect.poll(() => raceState(page), { timeout: 90_000 }).toBe('results');
  await expect(screen(page)).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 15_000 });
  expect(await tooSmall(page), 'results').toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('World Tour by touch (IMPLEMENTATION §M8a): the map, a world card, a locked card and the results are 44-point targets', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug=1&quality=low');
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.locator('input[type=text]').fill('TOUR');
  await page.getByRole('radio', { name: /I'M NEW TO RACING GAMES/ }).tap();
  await page.getByRole('button', { name: "LET'S RACE" }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  expect(await tooSmall(page), 'menu (Rookie)').toEqual([]);
  await page.getByRole('button', { name: /^WORLD TOUR/ }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'tour');
  expect(await tooSmall(page), 'map').toEqual([]);
  // A locked world's card.
  await page.locator('[data-planet="sunset-mesa"]').tap();
  await expect(page.locator('[data-world-card="sunset-mesa"]')).toContainText('TO UNLOCK');
  expect(await tooSmall(page), 'locked card').toEqual([]);
  await page.locator('[data-tour-close]').tap();
  // World 1's card, then the race and its results.
  await page.locator('[data-planet="neon-bay"]').tap();
  await expect(page.locator('[data-tour-race]')).toBeVisible();
  expect(await tooSmall(page), 'card').toEqual([]);
  await page.locator('[data-tour-race]').tap();
  await expect.poll(() => raceState(page), { timeout: 90_000 }).toMatch(/title|countdown|racing/);
  await page.evaluate(() => (window as unknown as { __machzero: { simulate(s: number): Promise<void> } }).__machzero.simulate(600));
  await expect(screen(page)).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 10_000 });
  expect(await tooSmall(page), 'results').toEqual([]);
  await page.locator('[data-res-next]').tap();
  await expect(page.locator('[data-world-card="sunset-mesa"] [data-tour-race]')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Time Trial by touch (IMPLEMENTATION §M8b): the screen, its toggles and the trial results are 44-point targets', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug=1&quality=low');
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.locator('input[type=text]').fill('CLOCK');
  await page.getByRole('radio', { name: /I'VE RACED BEFORE/ }).tap();
  await page.getByRole('button', { name: "LET'S RACE" }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  await page.getByRole('button', { name: /^TIME TRIAL/ }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'trial');
  expect(await tooSmall(page), 'time trial').toEqual([]);
  await page.getByRole('switch', { name: /MY BEST GHOST/ }).tap();
  await expect(page.getByRole('switch', { name: /MY BEST GHOST/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: /MY BEST GHOST/ }).tap();
  await page.locator('[data-trial-world="neon-bay"]').tap();
  await expect.poll(() => raceState(page), { timeout: 90_000 }).toMatch(/countdown|racing/);
  await page.evaluate(() => (window as unknown as { __machzero: { simulate(s: number): Promise<void> } }).__machzero.simulate(600));
  await expect(screen(page)).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  await expect(page.locator('[data-results-done]')).toBeVisible({ timeout: 10_000 });
  expect(await tooSmall(page), 'trial results').toEqual([]);
  await page.locator('[data-res-trial]').tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'trial');
  await expect(page.locator('[data-trial-world="neon-bay"] .mzu-trial-best')).not.toContainText('—');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('M8c by touch: the tutorial prompt clears the touch controls, power and speed; SKIP and the championship card are 44-point targets', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug=1&quality=low&features=expansion');
  await expect(screen(page)).toHaveAttribute('data-screen', 'create', { timeout: 60_000 });
  await page.locator('input[type=text]').fill('NEWBIE');
  await page.getByRole('radio', { name: /I'M NEW TO RACING GAMES/ }).tap();
  await page.getByRole('button', { name: "LET'S RACE" }).tap();
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  // The championship card (locked for a new profile).
  await page.getByRole('button', { name: /^GRAND PRIX/ }).tap();
  await page.locator('[data-cup="championship"]').tap();
  await expect(page.locator('[data-season-locked]')).toBeVisible();
  expect(await tooSmall(page), 'championship card').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(screen(page)).toHaveAttribute('data-screen', 'menu');
  // The first World Tour race: the tutorial's STEER prompt over the touch controls.
  await page.getByRole('button', { name: /^WORLD TOUR/ }).tap();
  await page.locator('[data-planet="neon-bay"]').tap();
  await page.locator('[data-tour-race]').tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __machzero: { app: { route: { value: { name: string } } } } }).__machzero.app.route.value.name), { timeout: 90_000 }).toBe('race');
  await page.evaluate(() => (window as unknown as { __machzero: { app: { endIntro(): void } } }).__machzero.app.endIntro());
  const prompt = page.locator('.mz-tutorial');
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  await expect(prompt.locator('.mz-k-touch')).toHaveText('SLIDE LEFT THUMB');
  expect(await tooSmall(page), 'race with the tutorial').toEqual([]);
  const overlaps = await page.evaluate(() => {
    const box = document.querySelector('.mz-tutorial')!.getBoundingClientRect();
    const hit: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.mz-tb, .mz-strip, .mz-energy, .mz-speed')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).display === 'none') continue;
      if (r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top) hit.push(el.className);
    }
    return hit;
  });
  expect(overlaps, 'the prompt covers nothing').toEqual([]);
  await prompt.locator('[data-tutorial-skip]').tap();
  await expect(prompt).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

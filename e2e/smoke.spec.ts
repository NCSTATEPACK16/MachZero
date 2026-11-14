import { expect, test } from '@playwright/test';

interface MachZeroDebug {
  race: { state: string; snapshot(): { raceTime: number; player: { speed: number } } };
  programs(): number;
  perf(): { frames: number };
}

// One race per quality preset: each preset builds a different set of environment effects (IMPLEMENTATION §X2),
// and every one of them must be compiled before the lights go out. Autopilot races on Neon Bay, the world
// that carries every effect.
for (const quality of ['high', 'med', 'low'] as const) {
  test(`boots, starts an autopilot race on ${quality} and runs without console errors or mid-race shader compiles`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`/?autopilot=1&debug=1&quality=${quality}`);
    await expect(page.locator('#app canvas')).toBeVisible();

    // Autopilot starts the race by itself. SwiftShader is slow and the loop clamps frame time, so simulated
    // time can run far below real time: wait on simulated progress, never on a wall-clock budget.
    await page.waitForFunction(
      () => (window as unknown as { __machzero?: MachZeroDebug }).__machzero?.race.state === 'racing',
      undefined,
      { timeout: 60_000 },
    );
    // The warm-up behind the loading screen compiled everything: no shader program may appear once the race
    // runs, including what only switches on at speed (speed blur from 40 m/s, speed lines from 50 m/s).
    const programsAtGo = await page.evaluate(() => (window as unknown as { __machzero: MachZeroDebug }).__machzero.programs());
    expect(programsAtGo).toBeGreaterThan(0);
    await page.waitForFunction(
      () => {
        const s = (window as unknown as { __machzero: MachZeroDebug }).__machzero.race.snapshot();
        return s.raceTime > 1 && s.player.speed > 52;
      },
      undefined,
      { timeout: 90_000 },
    );
    const after = await page.evaluate(() => {
      const m = (window as unknown as { __machzero: MachZeroDebug }).__machzero;
      return { programs: m.programs(), frames: m.perf().frames };
    });
    expect(after.programs, 'shader programs compiled mid-race').toBe(programsAtGo);
    expect(after.frames).toBeGreaterThan(0);

    const snap = await page.evaluate(() => {
      const s = (window as unknown as { __machzero: MachZeroDebug }).__machzero.race.snapshot();
      return { raceTime: s.raceTime, speed: s.player.speed };
    });
    expect(snap.raceTime).toBeGreaterThan(1);
    expect(snap.speed).toBeGreaterThan(10);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

// Tempest Spire (IMPLEMENTATION §X4) is behind the `expansion` flag, and `?world=` races it whatever the flag says.
// Its wind streamers, deck chevrons, strike circles and bolts are built with the track, so the warm-up must cover
// them: the race runs past the first crosswind zone and the first lightning field with no shader compiled on the way.
test('races Tempest Spire through a wind zone and a lightning field without console errors or mid-race shader compiles', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?autopilot=1&debug=1&quality=high&world=tempest-spire');
  await expect(page.locator('#app canvas')).toBeVisible();
  type Debug = MachZeroDebug & { app: { session: { track: { id: string; length: number } } }; ships: { trackU: number }[] };
  await page.waitForFunction(() => (window as unknown as { __machzero?: Debug }).__machzero?.race.state === 'racing', undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.session.track.id)).toBe('tempest-spire');
  const programsAtGo = await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.programs());

  // 1,900 m: past the first wind zone (about 850–1,140 m) and the first lightning field (about 1,660–1,860 m).
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __machzero: Debug }).__machzero;
      return m.ships[0].trackU * m.app.session.track.length > 1900;
    },
    undefined,
    { timeout: 240_000 },
  );
  expect(await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.programs()), 'shader programs compiled mid-race').toBe(programsAtGo);
  expect(errors, errors.join('\n')).toEqual([]);
});

// Cinder Forge (IMPLEMENTATION §X5) is behind the `expansion` flag too. Its geyser vents and lava columns are built
// with the track, so the warm-up must cover them: the race runs past both geyser fields, down the Plunge's dive and
// onto the crater floor with no shader compiled on the way.
test('races Cinder Forge past the geysers and down the Plunge without console errors or mid-race shader compiles', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?autopilot=1&debug=1&quality=high&world=cinder-forge');
  await expect(page.locator('#app canvas')).toBeVisible();
  type Debug = MachZeroDebug & { app: { session: { track: { id: string; length: number } } }; ships: { trackU: number; position: { y: number } }[] };
  await page.waitForFunction(() => (window as unknown as { __machzero?: Debug }).__machzero?.race.state === 'racing', undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.app.session.track.id)).toBe('cinder-forge');
  const programsAtGo = await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.programs());
  const rimY = await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.ships[0].position.y);

  // 2,500 m: past the geyser fields (about 800–990 m and 1,520–1,720 m) and the dive (about 2,020–2,280 m).
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __machzero: Debug }).__machzero;
      return m.ships[0].trackU * m.app.session.track.length > 2500;
    },
    undefined,
    { timeout: 240_000 },
  );
  // The ship is on the crater floor, about 110 m below the rim.
  const floorY = await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.ships[0].position.y);
  expect(rimY - floorY).toBeGreaterThan(100);
  expect(await page.evaluate(() => (window as unknown as { __machzero: Debug }).__machzero.programs()), 'shader programs compiled mid-race').toBe(programsAtGo);
  expect(errors, errors.join('\n')).toEqual([]);
});

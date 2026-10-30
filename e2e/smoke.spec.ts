import { expect, test } from '@playwright/test';

interface MachZeroDebug {
  race: { state: string; snapshot(): { raceTime: number; player: { speed: number } } };
  programs(): number;
  perf(): { frames: number };
}

test('boots, starts an autopilot race and runs without console errors or mid-race shader compiles', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?autopilot=1&debug=1');
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

import { expect, test } from '@playwright/test';

interface MachZeroDebug {
  race: { state: string; snapshot(): { raceTime: number; player: { speed: number } } };
}

test('boots, starts an autopilot race and runs without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?autopilot=1&debug=1');
  await expect(page.locator('#app canvas')).toBeVisible();

  // Autopilot starts the race by itself; wait for the countdown to finish.
  await page.waitForFunction(
    () => (window as unknown as { __machzero?: MachZeroDebug }).__machzero?.race.state === 'racing',
    undefined,
    { timeout: 45_000 },
  );

  await page.waitForTimeout(10_000);
  const snap = await page.evaluate(() => {
    const s = (window as unknown as { __machzero: MachZeroDebug }).__machzero.race.snapshot();
    return { raceTime: s.raceTime, speed: s.player.speed };
  });

  // SwiftShader is slow, and the loop clamps frame time — require progress, not real-time pace.
  expect(snap.raceTime).toBeGreaterThan(1);
  expect(snap.speed).toBeGreaterThan(10);
  expect(errors, errors.join('\n')).toEqual([]);
});

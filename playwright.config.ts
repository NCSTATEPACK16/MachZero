import { defineConfig, devices } from '@playwright/test';

// Read CI from Node's env without pulling Node types into the (browser) project tsconfig.
const CI = Boolean((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI);

/**
 * Smoke test against the production build (`vite preview`). WebGL runs on SwiftShader (CPU), which on a
 * GitHub runner renders the full post-FX chain at ~1 fps at 1280×720. The loop clamps each frame to
 * MAX_FRAME_DT / MAX_SUBSTEPS, so simulated time then crawls at a few percent of real time. A small
 * viewport keeps SwiftShader fill cost down; the spec waits on simulated progress, not wall-clock time.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 480, height: 270 },
        deviceScaleFactor: 1,
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});

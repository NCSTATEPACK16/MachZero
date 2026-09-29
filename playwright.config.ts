import { defineConfig, devices } from '@playwright/test';

// Read CI from Node's env without pulling Node types into the (browser) project tsconfig.
const CI = Boolean((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI);

/** Smoke test against the production build (`vite preview`). WebGL runs on SwiftShader in CI. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
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

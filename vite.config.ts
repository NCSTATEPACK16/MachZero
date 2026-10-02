import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    // The Rapier chunk embeds its WASM as base64 (~4.2 MB raw); it is budgeted on its own in scripts/check-size.mjs.
    chunkSizeWarningLimit: 5000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /@dimforge[\\/]rapier3d/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    testTimeout: 60000,
  },
});

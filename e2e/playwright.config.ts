import { defineConfig } from '@playwright/test';

// Cada archivo lanza su propio navegador (contexto persistente) y sus servidores en puertos fijos: sin paralelismo.
export default defineConfig({
  testDir: 'tests',
  globalSetup: './global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
});

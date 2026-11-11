import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  retries: 0,
  worker: 'isolated',
  reporter: 'dot',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    headless: true,
  },
});
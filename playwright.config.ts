import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  webServer: [
    {
      command: 'npm run start --workspace=server',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000
    },
    {
      command: 'npm run dev --workspace=client -- --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000
    }
  ]
});
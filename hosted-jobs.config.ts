import { defineConfig, devices } from '@playwright/test';
import { requireHostedTarget } from './tests/hosted-jobs/target';
const target = requireHostedTarget(process.env);
export default defineConfig({
  testDir: './tests/hosted-jobs', testMatch: '**/journey.spec.ts',
  workers: 1, retries: 0, timeout: 900000, forbidOnly: true,
  reporter: [['list']],
  use: { baseURL: target.origin, ...devices['Desktop Chrome'],
    actionTimeout: 15000, navigationTimeout: 30000,
    trace: 'off', screenshot: 'off', video: 'off' },
  // Deliberately no webServer: this proof must never start a laptop application.
});

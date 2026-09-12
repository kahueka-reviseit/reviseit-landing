import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/auth', workers: 1, retries: 0, timeout: 60000, forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3101', ...devices['Desktop Chrome'], actionTimeout: 10000, navigationTimeout: 15000, trace: 'off', screenshot: 'only-on-failure' },
  // Test admin keys remain in the test process. The web application receives only its public provider key.
  webServer: { command: 'npm run start -- --hostname 127.0.0.1 --port 3101', url: 'http://127.0.0.1:3101', reuseExistingServer:false,
    env: { AUTH_TEST_DATABASE_URL: '', AUTH_TEST_SERVICE_KEY: '', NEXT_TELEMETRY_DISABLED:'1' } },
});

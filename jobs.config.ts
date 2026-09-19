import { defineConfig,devices } from '@playwright/test';
export default defineConfig({testDir:'./tests/jobs',workers:1,retries:0,timeout:240000,forbidOnly:!!process.env.CI,reporter:[['list']],
 use:{baseURL:'http://127.0.0.1:3101',...devices['Desktop Chrome'],actionTimeout:15000,navigationTimeout:30000,trace:'off',screenshot:'only-on-failure'},
 webServer:{command:'npm run start -- --hostname 127.0.0.1 --port 3101',url:'http://127.0.0.1:3101',reuseExistingServer:false,timeout:120000,env:{AUTH_TEST_DATABASE_URL:'',AUTH_TEST_SERVICE_KEY:'',NEXT_TELEMETRY_DISABLED:'1'}}});

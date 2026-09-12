import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/workspace-browser',outputDir:'workspace-test-results',fullyParallel:true,workers:2,forbidOnly:!!process.env.CI,
 use:{baseURL:'http://127.0.0.1:3103',screenshot:'only-on-failure',trace:'retain-on-failure'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 5']}}],
 webServer:{command:'npm run preview:workspace',url:'http://127.0.0.1:3103',reuseExistingServer:!process.env.CI,timeout:60000},
});

import {defineConfig,devices} from '@playwright/test';
// PREVIEW_PORT keeps this run on its own synthetic preview and never reuses another worktree's server.
const port=Number(process.env.PREVIEW_PORT||3103);
export default defineConfig({
 testDir:'./tests/workspace-browser',outputDir:'workspace-test-results',fullyParallel:true,workers:2,forbidOnly:!!process.env.CI,
 use:{baseURL:`http://127.0.0.1:${port}`,screenshot:'only-on-failure',trace:'retain-on-failure'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 5']}}],
 webServer:{command:'npm run preview:workspace',url:`http://127.0.0.1:${port}`,reuseExistingServer:!process.env.CI,timeout:60000,env:{PREVIEW_PORT:String(port)}},
});

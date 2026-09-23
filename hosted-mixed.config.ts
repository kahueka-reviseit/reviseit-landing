import {defineConfig,devices} from '@playwright/test';
import {requireHostedTarget} from './tests/hosted-jobs/target';
const mode=process.env.HOSTED_MIXED_MODE === 'live' ? 'live' : 'replay';
const target=requireHostedTarget(process.env,mode);
export default defineConfig({testDir:'./tests/hosted-jobs',testMatch:'**/mixed.spec.ts',timeout:120000,
 workers:1,retries:0,forbidOnly:true,reporter:[['list']],
 use:{baseURL:target.origin,...devices['Desktop Chrome'],actionTimeout:15000,navigationTimeout:30000,
 trace:'off',screenshot:'off',video:'off'}});

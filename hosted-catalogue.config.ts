import {defineConfig} from '@playwright/test';
import hosted from './hosted-jobs.config';
export default defineConfig({...hosted,testMatch:'**/catalogue.spec.ts',timeout:120000});

import { execFileSync, spawnSync } from 'node:child_process';
const state = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
for (const key of ['API_URL', 'DB_URL']) {
  if (!state[key] || !['127.0.0.1', 'localhost'].includes(new URL(state[key]).hostname)) throw new Error('Identity integration tests require a disposable local Supabase instance.');
}
if (!state.SERVICE_ROLE_KEY || !state.ANON_KEY) throw new Error('Local Supabase test keys are missing.');
const result = spawnSync('npx', ['--no-install', 'playwright', 'test', '--config=identity.config.ts'], {
  stdio: 'inherit', env: { ...process.env, SUPABASE_URL: state.API_URL, SUPABASE_PUBLISHABLE_KEY: state.ANON_KEY,
    SITE_URL: 'http://127.0.0.1:3101', AUTH_TEST_DATABASE_URL: state.DB_URL, AUTH_TEST_SERVICE_KEY: state.SERVICE_ROLE_KEY },
});
process.exit(result.status ?? 1);

import { defineConfig } from 'vitest/config';
// Real PostgreSQL, separate sessions. Needs REVISEIT_CONCURRENCY_DATABASE_URL naming a
// disposable local server; the test refuses anything that is not loopback.
export default defineConfig({ test: { environment: 'node', include: ['tests/concurrency/**/*.test.ts'], testTimeout: 60000, hookTimeout: 120000 } });

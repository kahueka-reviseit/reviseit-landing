const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/** @type {import('next').NextConfig} */
module.exports = (phase) => ({
  async redirects() {
    return [
      { source: '/', has: [{ type: 'host', value: 'admin.reviseit.io' }], destination: '/admin', permanent: false },
      { source: '/', has: [{ type: 'host', value: 'pilot.reviseit.io' }], destination: '/teacher', permanent: false },
      { source: '/login', has: [{ type: 'host', value: 'admin.reviseit.io' }], destination: '/admin/login', permanent: false },
    ];
  },
  // Keep a live developer preview from rewriting the build used by browser tests.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});

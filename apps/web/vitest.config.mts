import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` is a BUILD-TIME guard for Next's bundler: outside it, the
      // package resolves to a module that throws on import. These tests import
      // the server modules directly and on purpose, so the guard is stubbed out
      // rather than the guard being removed from production code.
      'server-only': fileURLToPath(new URL('./tests/helpers/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

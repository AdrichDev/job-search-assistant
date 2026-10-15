import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Type-only modules: they are erased at compile time and contain no
        // executable statements, so a coverage percentage is meaningless.
        'src/ports/**',
        'src/domain/scoring/types.ts',
        'src/index.ts',
        // Composition roots: exercised by the end-to-end CLI run, not by unit tests.
        'src/cli/main.ts',
        // Declarative data with no branches.
        'src/config/candidate-profile.ts',
        'src/config/search-plan.ts',
        'src/config/exploration-config.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});

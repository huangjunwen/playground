import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'packages/**/src/**/*.test.ts',
            'packages/**/src/**/*.test-node.ts',
            'packages/**/tests/**/*.test.ts',
            'packages/**/tests/**/*.test-node.ts',
            'apps/**/src/**/*.test.ts',
            'apps/**/src/**/*.test-node.ts',
            'apps/**/tests/**/*.test.ts',
            'apps/**/tests/**/*.test-node.ts',
            'tests/**/*.test.ts',
            'tests/**/*.test-node.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
          benchmark: {
            include: ['**/*.bench.ts', '**/*.bench-node.ts'],
          },
        },
      },
      {
        test: {
          name: 'web',
          include: [
            'packages/**/src/**/*.test.ts',
            'packages/**/src/**/*.test-web.ts',
            'packages/**/tests/**/*.test.ts',
            'packages/**/tests/**/*.test-web.ts',
            'apps/**/src/**/*.test.ts',
            'apps/**/src/**/*.test-web.ts',
            'apps/**/tests/**/*.test.ts',
            'apps/**/tests/**/*.test-web.ts',
            'tests/**/*.test.ts',
            'tests/**/*.test-web.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
          benchmark: {
            include: ['**/*.bench.ts', '**/*.bench-web.ts'],
          },
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});

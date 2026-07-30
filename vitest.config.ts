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
            'packages/**/src/**/*.node.test.ts',
            'packages/**/tests/**/*.node.test.ts',
            'apps/**/src/**/*.node.test.ts',
            'apps/**/tests/**/*.node.test.ts',
            'tests/**/*.node.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      {
        test: {
          name: 'web',
          include: [
            'packages/**/src/**/*.web.test.ts',
            'packages/**/tests/**/*.web.test.ts',
            'apps/**/src/**/*.web.test.ts',
            'apps/**/tests/**/*.web.test.ts',
            'tests/**/*.web.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
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

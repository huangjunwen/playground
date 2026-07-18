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
          name: 'browser',
          include: [
            'packages/**/src/**/*.browser.test.ts',
            'packages/**/tests/**/*.browser.test.ts',
            'apps/**/src/**/*.browser.test.ts',
            'apps/**/tests/**/*.browser.test.ts',
            'tests/**/*.browser.test.ts',
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

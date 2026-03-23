import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:4200',
    extraHTTPHeaders: {},
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:3000',
      },
    },
    {
      name: 'ui',
      testMatch: /.*\.ui\.spec\.ts/,
      testIgnore: /.*mobile.*\.ui\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:4200',
      },
    },
    {
      name: 'mobile',
      testMatch: /.*mobile.*\.ui\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:8100',
      },
    },
    {
      name: 'legacy',
      testMatch: /^(?!.*\.(api|ui)\.spec\.ts).*\.spec\.ts$/,
      use: {
        baseURL: 'http://localhost:4200',
      },
    },
  ],
});

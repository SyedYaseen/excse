import { defineConfig, devices } from '@playwright/test'

// The app is a phone app. There is no desktop layout to regress, so every
// project here is a phone viewport; the only axis that varies is the theme.
const PHONE = devices['iPhone 14']

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false, // one database, one user -- tests share cycle state.
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.EXSE_URL ?? 'http://127.0.0.1:3005',
    ...PHONE,
    // iPhone 14 is a WebKit descriptor; we run it on Chromium, which does not
    // accept isMobile/hasTouch from that preset in every channel.
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
})

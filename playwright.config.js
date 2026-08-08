import { defineConfig, devices } from '@playwright/test';

// E2E runs against an isolated instance of the production server:
//   - its own DATA_DIR (throwaway SQLite db) so tests never touch real data
//   - its own ports (8443 https / 8080 http) so it can run alongside a dev server
//   - a known ADMIN_PASSWORD so the suite can seed crews/zones via the API
// The browser is the locally-installed Microsoft Edge (channel: 'msedge'), so
// no Chromium download is required.
const HTTPS_PORT = 8443;
const BASE_URL = `https://localhost:${HTTPS_PORT}`;
const ADMIN_PASSWORD = 'e2e-secret-pw';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // shared server-side game state (leaderboard/claims)
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  globalSetup: './e2e/global-setup.js',

  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true, // self-signed cert
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      // A phone-sized viewport to exercise the bottom tab bar + mobile layout.
      use: { channel: 'msedge', viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true },
    },
  ],

  webServer: {
    command: 'node server.js',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    ignoreHTTPSErrors: true,
    env: {
      ADMIN_PASSWORD,
      DATA_DIR: './e2e/.data',
      HTTPS_PORT: String(HTTPS_PORT),
      PORT: String(HTTPS_PORT),
      HTTP_PORT: '8080',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
  },
});

export { BASE_URL, ADMIN_PASSWORD };

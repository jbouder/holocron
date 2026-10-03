import { defineConfig, devices } from '@playwright/test';

const PORT = 4317;
const CI = Boolean(process.env.CI);

/**
 * End-to-end tests against the built app under `vite preview`: the Worker
 * and the Durable Object run in workerd (Miniflare) exactly as they would
 * deploy, with public/_headers (and so the CSP) applied, which `vite dev`
 * does not do.
 *
 * Locally a server already listening on the port is reused, so
 * `npm run preview -- --port 4317` in another terminal skips the rebuild.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // The retry is for the trace; a test that only passes on it still fails
  // the run, since a flake here has so far meant a real race in the app.
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  // Every test drives a live board over WebSockets; a couple at a time keeps
  // one workerd process responsive on a CI runner.
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

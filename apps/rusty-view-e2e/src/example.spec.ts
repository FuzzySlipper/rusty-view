import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the rusty-view reference app.
 *
 * When the debug rusty-crew backend is reachable, these
 * prove the full live stack: browser app → CORS → transport → backend →
 * sessions rendered in the shell. When the backend is not reachable, the
 * structural smoke still runs but the live assertions are skipped.
 */

const BACKEND_URL =
  process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const APP_URL = `/?api=${encodeURIComponent(BACKEND_URL)}`;
let backendReachable = false;

test.beforeAll(async () => {
  try {
    const response = await fetch(`${BACKEND_URL}/v1/chat/sessions`, {
      signal: AbortSignal.timeout(3_000),
    });
    backendReachable = response.ok;
  } catch {
    backendReachable = false;
  }
});

test('rusty-view renders the shell with sidebar and header', async ({
  page,
}) => {
  await page.goto(APP_URL);

  const header = page.locator('.rv-debug__header');
  await expect(header).toBeVisible();
  await expect(header).toContainText('rusty-view');

  await expect(page.locator('rv-profile-panel')).toBeVisible();
  await expect(page.locator('rv-stream-status')).toBeVisible();
});

test('sessions from the backend appear in the sidebar', async ({ page }) => {
  test.skip(!backendReachable, 'backend not reachable at ' + BACKEND_URL);
  await page.goto(APP_URL);

  // The app initializer calls refreshSessions() on startup. Wait for at
  // least one profile button to appear in the sidebar.
  const profileButton = page.locator('.rv-profile').first();
  await expect(profileButton).toBeVisible({ timeout: 10_000 });

  const count = await page.locator('.rv-profile').count();
  expect(count).toBeGreaterThan(0);
});

test('selecting a session shows the transcript region', async ({ page }) => {
  test.skip(!backendReachable, 'backend not reachable at ' + BACKEND_URL);
  await page.goto(APP_URL);

  const profileButton = page.locator('.rv-profile').first();
  await expect(profileButton).toBeVisible({ timeout: 10_000 });
  await profileButton.click();
  await expect(page.locator('rv-transcript-viewport')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('rv-message-input')).toBeVisible();
});

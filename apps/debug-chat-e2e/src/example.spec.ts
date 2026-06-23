import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke tests for the debug-chat reference app.
 *
 * When the rusty-crew backend is reachable at http://127.0.0.1:9347, these
 * prove the full live stack: browser app → CORS → transport → backend →
 * sessions rendered in the shell. When the backend is not reachable, the
 * structural smoke still runs but the live assertions are skipped.
 */

const BACKEND_URL = 'http://127.0.0.1:9347';
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

test('debug-chat renders the shell with sidebar and header', async ({
  page,
}) => {
  await page.goto('/');

  const header = page.locator('.rv-debug__header');
  await expect(header).toBeVisible();
  await expect(header).toContainText('rusty-view');
  await expect(header).toContainText('debug-chat');

  await expect(page.locator('rv-session-list')).toBeVisible();
  await expect(page.locator('rv-stream-status')).toBeVisible();
});

test('sessions from the backend appear in the sidebar', async ({ page }) => {
  test.skip(!backendReachable, 'backend not reachable at ' + BACKEND_URL);
  await page.goto('/');

  // The app initializer calls refreshSessions() on startup. Wait for at
  // least one session button to appear in the sidebar.
  const sessionButton = page.locator('.rv-session').first();
  await expect(sessionButton).toBeVisible({ timeout: 10_000 });

  const count = await page.locator('.rv-session').count();
  expect(count).toBeGreaterThan(0);
});

test('selecting a session shows the transcript region', async ({ page }) => {
  test.skip(!backendReachable, 'backend not reachable at ' + BACKEND_URL);
  await page.goto('/');

  const sessionButton = page.locator('.rv-session').first();
  await expect(sessionButton).toBeVisible({ timeout: 10_000 });
  await sessionButton.click();

  // The transcript viewport should appear (the "no session" placeholder
  // should be gone).
  await expect(page.locator('rv-transcript-viewport')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('rv-message-input')).toBeVisible();
  await expect(page.locator('rv-command-composer')).toBeVisible();
});

test('command registry is loaded and toggleable', async ({ page }) => {
  test.skip(!backendReachable, 'backend not reachable at ' + BACKEND_URL);
  await page.goto('/');

  // The command composer is inside the session view, so select a session first.
  const sessionButton = page.locator('.rv-session').first();
  await expect(sessionButton).toBeVisible({ timeout: 10_000 });
  await sessionButton.click();

  await expect(page.locator('rv-command-composer')).toBeVisible({
    timeout: 10_000,
  });

  const toggleButton = page.locator('.rv-command__toggle');
  await toggleButton.click();

  const registryEntry = page.locator('.rv-command-entry').first();
  await expect(registryEntry).toBeVisible({ timeout: 5_000 });
});

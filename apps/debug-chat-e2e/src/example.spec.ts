import { expect, test } from '@playwright/test';

/**
 * Smoke test for the debug-chat reference app. Proves the shell renders
 * end-to-end (serve + browser) with the debug-shell layout.
 */
test('debug-chat renders the shell with sidebar and header', async ({
  page,
}) => {
  await page.goto('/');

  // The shell header with title.
  const header = page.locator('.rv-debug__header');
  await expect(header).toBeVisible();
  await expect(header).toContainText('rusty-view');
  await expect(header).toContainText('debug-chat');

  // Session sidebar.
  await expect(page.locator('rv-session-list')).toBeVisible();

  // Stream status indicator.
  await expect(page.locator('rv-stream-status')).toBeVisible();
});

import { expect, test } from '@playwright/test';

/**
 * Smoke test for the debug-chat reference app. It only proves the shell renders
 * end-to-end (serve + browser). The real transcript/inspector smoke tests are
 * added when @rusty-view/chat-shell lands (#3185–#3186).
 */
test('debug-chat shell renders the app title', async ({ page }) => {
  await page.goto('/');

  const header = page.locator('.rv-debug-shell__header');
  await expect(header).toBeVisible();
  await expect(header).toContainText('rusty-view');
  await expect(header).toContainText('debug-chat');
});

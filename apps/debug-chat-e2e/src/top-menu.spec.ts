import { expect, test, type Page } from '@playwright/test';

/**
 * Top menu / Options / Help smoke test (task #3252).
 *
 * Covers the acceptance path end-to-end in a real browser:
 *   1. The top menu bar is present with Options + Help entries.
 *   2. Opening Options reveals the Appearance tab.
 *   3. Changing a visual setting (font scale) applies a live `--rv-*` token
 *      override to the document root.
 *   4. Opening Help renders the command panel (registry-driven).
 *   5. Dismissing returns visibility to the chat shell.
 *
 * No backend session is required: the menu/options/help surfaces do not depend
 * on an open session, and an empty command registry renders the Help empty
 * state. Token writes go through Angular's zoneless scheduler, so the visual
 * assertion is polled rather than read once.
 */

async function fontMdToken(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--rv-font-size-md')
      .trim(),
  );
}

test('top menu opens options, applies an appearance change, opens help', async ({
  page,
}) => {
  await page.goto('/');

  // App boot.
  await expect(page.locator('.rv-debug__header')).toBeVisible({
    timeout: 10_000,
  });

  // 1. Top menu bar is present with the built-in entries.
  await expect(page.locator('rv-top-menu-bar')).toBeVisible();
  await expect(
    page.locator('.rv-top-menu__item', { hasText: 'Options' }),
  ).toBeVisible();
  await expect(
    page.locator('.rv-top-menu__item', { hasText: 'Help' }),
  ).toBeVisible();

  // 2. Open Options → Appearance tab is active and rendered.
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await expect(page.locator('rv-options-panel')).toBeVisible();
  await expect(page.locator('rv-appearance-tab')).toBeVisible();
  await expect(
    page.locator('.rv-tab-strip__tab--active', { hasText: 'Appearance' }),
  ).toBeVisible();

  // 3. Change a visual setting: crank the font scale slider to max and verify
  //    the live token override lands on the document root (polled — the write
  //    runs through the zoneless signal scheduler).
  await page.locator('.rv-appearance__range').fill('1.5');
  await expect.poll(fontMdToken.bind(null, page), { timeout: 5_000 }).toBe('20px');

  // 4. Close Options, open Help.
  await page.locator('.rv-options__close').click();
  await expect(page.locator('rv-options-panel')).toHaveCount(0);

  await page.locator('.rv-top-menu__item', { hasText: 'Help' }).click();
  await expect(page.locator('rv-help-panel')).toBeVisible();

  // 5. Dismiss Help and return to the chat shell (no panels open).
  await page.locator('.rv-top-menu__panel-close').click();
  await expect(page.locator('rv-help-panel')).toHaveCount(0);
  await expect(page.locator('.rv-debug__header')).toBeVisible();
});

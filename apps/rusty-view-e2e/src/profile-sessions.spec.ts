import { expect, test } from '@playwright/test';

/**
 * Profile panel + sessions menu smoke test (task #3255).
 *
 * Covers the acceptance path end-to-end in a real browser:
 *   1. The sidebar shows profiles (not a raw session list).
 *   2. Clicking a profile selects it and opens the active session.
 *   3. The top-menu Sessions entry opens the exact session inventory.
 *   4. Opening a historical session shows the banner and disables the input.
 *   5. "Return to active" restores the live session.
 *
 * Requires a backend with at least one profile that has sessions (the dev
 * environment normally has multiple). Skips otherwise.
 */

test('profile sidebar, active session, and sessions menu historical flow', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.rv-debug__header')).toBeVisible({
    timeout: 10_000,
  });

  // 1. Sidebar shows profiles, not the raw session list.
  await expect(page.locator('rv-profile-panel')).toBeVisible();
  await expect(page.locator('rv-session-list')).toHaveCount(0);

  // Wait for profiles to load.
  const profileCount = await page.locator('.rv-profile').count();
  test.skip(
    profileCount === 0,
    'no profiles available — needs a backend with sessions',
  );

  // 2. Click the first profile — it should become selected and open its active session.
  const firstProfile = page.locator('.rv-profile').first();
  await firstProfile.click();
  await expect(firstProfile).toHaveClass(/rv-profile--selected/);
  await expect(page.locator('rv-transcript-viewport')).toBeVisible({
    timeout: 10_000,
  });

  // 3. Top-menu Sessions entry opens the sessions panel.
  await expect(
    page.locator('.rv-top-menu__item', { hasText: 'Sessions' }),
  ).toBeVisible();
  await page.locator('.rv-top-menu__item', { hasText: 'Sessions' }).click();
  await expect(page.locator('rv-sessions-panel')).toBeVisible();

  // The sessions list should have at least one row.
  const sessionRows = page.locator('.rv-sessions-panel__row');
  const rowCount = await sessionRows.count();
  expect(rowCount).toBeGreaterThan(0);

  // 4. Only an exact archived backend session enters historical mode. Another
  // idle/active same-profile session remains writable.
  const archivedRows = page.locator(
    '.rv-sessions-panel__row[data-session-status="archived"]',
  );
  test.skip(
    (await archivedRows.count()) === 0,
    'no archived session available for historical-mode certification',
  );
  await archivedRows.first().click();
  await expect(page.locator('.rv-debug__historical-banner')).toBeVisible();
  await expect(page.locator('rv-message-input')).toHaveCount(0);

  // 5. Return to active.
  await page.locator('.rv-debug__historical-banner__return').click();
  await expect(page.locator('.rv-debug__historical-banner')).toHaveCount(0);
  // Message input should be back.
  await expect(page.locator('rv-message-input')).toBeVisible();
});

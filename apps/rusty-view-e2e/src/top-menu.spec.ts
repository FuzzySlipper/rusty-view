import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

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

async function topMenuFontFamily(page: Page): Promise<string> {
  return page
    .locator('.rv-top-menu__item', { hasText: 'Options' })
    .evaluate((el) => getComputedStyle(el).fontFamily);
}

async function captureBrokerScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  const artifactRoot = process.env['PLAYWRIGHT_BROKER_ARTIFACT_ROOT'];
  if (artifactRoot === undefined || artifactRoot.length === 0) return;
  await page.screenshot({
    path: path.join(artifactRoot, `${name}.png`),
    fullPage: true,
  });
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
  await expect(
    page.locator('.rv-top-menu__item', { hasText: 'Debug' }),
  ).toBeVisible();
  await page.locator('.rv-top-menu__item', { hasText: 'Debug' }).hover();
  await expect(page.locator('.rv-tooltip')).toContainText(
    'Inspect runtime diagnostics',
  );
  await captureBrokerScreenshot(page, 'top-menu-debug-tooltip');
  await page.mouse.move(0, 0);
  await expect(page.locator('.rv-tooltip')).toHaveCount(0);

  // Debug is an operator panel; this smoke only verifies the real topbar exposes
  // it and renders the shell surface. API behavior is covered by component and
  // transport tests with mocked Crew responses.
  await page.locator('.rv-top-menu__item', { hasText: 'Debug' }).click();
  await expect(page.locator('rv-debug-panel')).toBeVisible();
  await expect(page.locator('rv-debug-panel')).toContainText(
    'read-only runtime diagnostics',
  );
  await captureBrokerScreenshot(page, 'top-menu-debug-panel');
  await page.getByTestId('top-menu-overlay-debug').click({
    position: { x: 8, y: 8 },
  });
  await expect(page.locator('rv-debug-panel')).toHaveCount(0);

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
  await expect
    .poll(fontMdToken.bind(null, page), { timeout: 5_000 })
    .toBe('20px');

  // Font family changes must reach the menu chrome too, not only transcript
  // prose. This keeps downstream shells from inheriting a hardcoded mono menu.
  await page.locator('.rv-appearance__seg', { hasText: 'Serif' }).click();
  await expect
    .poll(topMenuFontFamily.bind(null, page), { timeout: 5_000 })
    .toContain('Georgia');

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

test('floating panel ignores an inside-to-outside drag but closes on an outside click', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.rv-top-menu__item', { hasText: 'Help' }).click();

  const panel = page.getByTestId('top-menu-panel-help');
  const overlay = page.getByTestId('top-menu-overlay-help');
  await expect(panel).toBeVisible();
  const panelBounds = await panel.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });

  await page.mouse.move(
    panelBounds.x + panelBounds.width / 2,
    panelBounds.y + panelBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(8, 8, { steps: 8 });
  await page.mouse.up();

  await expect(panel).toBeVisible();
  await overlay.click({ position: { x: 8, y: 8 } });
  await expect(panel).toHaveCount(0);
});

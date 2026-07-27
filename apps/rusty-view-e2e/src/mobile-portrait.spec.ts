import { expect, test } from '@playwright/test';

test.describe('mobile portrait shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('debug-shell')).toBeVisible();
  });

  test('keeps chat primary and exposes Agents and Codex in a drawer', async ({
    page,
  }) => {
    const sessionsToggle = page.getByTestId('mobile-sessions-toggle');
    await expect(sessionsToggle).toBeVisible();
    await expect(sessionsToggle).toHaveText('Agents');
    await expect(page.getByTestId('profiles-toggle')).toBeHidden();
    await expect(page.getByTestId('inspector-toggle')).toBeHidden();
    await expect(page.locator('.rv-debug__sidebar')).toBeHidden();
    await expect(page.locator('.rv-debug__inspector')).toBeHidden();

    const sessionsGeometry = await sessionsToggle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, width: rect.width, height: rect.height };
    });
    expect(sessionsGeometry.top).toBeGreaterThanOrEqual(16);
    expect(sessionsGeometry.width).toBeGreaterThanOrEqual(96);
    expect(sessionsGeometry.height).toBeGreaterThanOrEqual(48);

    const topMenuItems = page.locator('.rv-top-menu__item');
    const topMenuHeights = await topMenuItems.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
    expect(topMenuHeights.length).toBeGreaterThan(0);
    expect(Math.min(...topMenuHeights)).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.rv-status')).toHaveCSS('min-height', '44px');

    const mobileMenuGeometry = await page
      .locator('.rv-debug__header > rv-top-menu')
      .evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    expect(mobileMenuGeometry.scrollWidth).toBeGreaterThan(
      mobileMenuGeometry.clientWidth,
    );

    await sessionsToggle.click();
    await expect(page.locator('.rv-debug__sidebar')).toBeVisible();
    await expect(page.locator('rv-profile-panel')).toBeVisible();
    await expect(page.getByTestId('crew-agents-tab')).toHaveText('Agents');
    await expect(page.getByTestId('external-agents-tab')).toHaveText('Codex');
    await expect(page.locator('.rv-profiles__header')).toHaveText('Agents');

    const sourceTabGeometry = await page
      .locator('.rv-debug__sidebar-tabs button')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        }),
      );
    expect(sourceTabGeometry.length).toBe(3);
    expect(
      Math.min(...sourceTabGeometry.map(({ top }) => top)),
    ).toBeGreaterThanOrEqual(16);
    expect(
      Math.min(...sourceTabGeometry.map(({ height }) => height)),
    ).toBeGreaterThanOrEqual(48);

    await page.getByTestId('external-agents-tab').click();
    await expect(page.locator('rv-external-agent-panel')).toBeVisible();
    await expect(page.locator('.rv-agents__header')).toContainText(
      'Codex sessions',
    );

    await page.getByTestId('mobile-sessions-close').click();
    await expect(page.locator('.rv-debug__sidebar')).toBeHidden();

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  });

  test('dismisses the session drawer by backdrop and Escape', async ({
    page,
  }) => {
    await page.getByTestId('mobile-sessions-toggle').click();
    await page
      .getByTestId('mobile-sessions-backdrop')
      .click({ position: { x: 380, y: 400 } });
    await expect(page.locator('.rv-debug__sidebar')).toBeHidden();

    await page.getByTestId('mobile-sessions-toggle').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.rv-debug__sidebar')).toBeHidden();
  });
});

test('desktop sidebar preferences remain the desktop controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.getByTestId('mobile-sessions-toggle')).toBeHidden();
  await expect(page.getByTestId('profiles-toggle')).toBeVisible();
  await expect(page.getByTestId('profiles-toggle')).toContainText('Agents');
  await expect(page.locator('.rv-debug__sidebar')).toBeVisible();
  await expect(page.getByTestId('crew-agents-tab')).toHaveText('Agents');
  await expect(page.getByTestId('external-agents-tab')).toHaveText('Codex');
  const desktopMenuHeight = await page
    .locator('.rv-top-menu__item')
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(desktopMenuHeight).toBeLessThan(44);
});

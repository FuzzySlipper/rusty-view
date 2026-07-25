import { expect, test } from '@playwright/test';

const live = process.env['RV_MEMORY_SURFACES_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('memory surface diagnostics @live-memory-surfaces', () => {
  test.skip(
    !live,
    'set RV_MEMORY_SURFACES_LIVE_RUN=1 for the real Crew debug memory catalog',
  );

  test('renders the live debug catalog without route interception', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);

    const catalogResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === '/v1/admin/diagnostics/memory-surfaces'
      );
    });
    await page.locator('[data-menu-id="service"]').click();
    const response = await catalogResponse;
    expect(response.ok()).toBe(true);

    const panel = page.getByTestId('top-menu-panel-service');
    await panel.getByRole('button', { name: 'Memory', exact: true }).click();
    const cards = panel.locator('.rv-admin-service__memory-card');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });

    const externalMemory = cards.filter({ hasText: 'external_memory' });
    const denPlanning = cards.filter({ hasText: 'den_planning' });
    await expect(externalMemory).toHaveCount(1);
    await expect(denPlanning).toHaveCount(1);
    await expect(externalMemory).toContainText('External memory');
    await expect(externalMemory).toContainText('unavailable');
    await expect(externalMemory).toContainText(
      'memory_external_dependency_missing',
    );
    await expect(externalMemory).toHaveClass(/memory-card--unavailable/);
    await expect(denPlanning).toContainText(
      'Den documents, tasks, and guidance',
    );
    await expect(denPlanning).toContainText('profile scoped');
    await expect(denPlanning).toHaveClass(/memory-card--profile-scoped/);
    await expect(denPlanning).not.toHaveClass(/memory-card--unavailable/);
    await expect(panel).toContainText(
      'Profile scoped means availability depends on the active profile. It is not a service health failure.',
    );
  });
});

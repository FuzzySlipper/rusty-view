import { expect, test } from '@playwright/test';

const live = process.env['RV_PROVIDER_LAYOUT_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('provider panel layout @live-provider', () => {
  test.skip(
    !live,
    'set RV_PROVIDER_LAYOUT_LIVE_RUN=1 for the real Crew debug provider list',
  );

  test('keeps the full editor stable while the provider list scrolls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
    await page.locator('[data-menu-id="providers"]').click();

    const panel = page.getByTestId('top-menu-panel-providers');
    const editor = page.getByTestId('admin-providers-editor');
    const listRegion = page.getByTestId('admin-providers-list-region');
    await expect(panel).toBeVisible();
    await expect(
      listRegion.locator('.rv-admin-providers__provider').first(),
    ).toBeVisible({ timeout: 30_000 });

    const before = await panel.evaluate((element) => {
      const editorElement = element.querySelector<HTMLElement>(
        '[data-testid="admin-providers-editor"]',
      );
      const listElement = element.querySelector<HTMLElement>(
        '[data-testid="admin-providers-list-region"]',
      );
      const host = element.querySelector<HTMLElement>(
        'rv-admin-providers-panel',
      );
      if (editorElement === null || listElement === null || host === null) {
        throw new Error('Provider panel layout regions are missing.');
      }
      return {
        hostHeight: host.getBoundingClientRect().height,
        editorHeight: editorElement.getBoundingClientRect().height,
        editorClientHeight: editorElement.clientHeight,
        editorScrollHeight: editorElement.scrollHeight,
        listClientHeight: listElement.clientHeight,
        listScrollHeight: listElement.scrollHeight,
      };
    });

    expect(before.hostHeight).toBeGreaterThanOrEqual(800);
    expect(before.editorScrollHeight).toBeLessThanOrEqual(
      before.editorClientHeight + 1,
    );
    expect(before.listScrollHeight).toBeGreaterThan(before.listClientHeight);

    await listRegion.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const editorHeightAfterListScroll = await editor.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    expect(editorHeightAfterListScroll).toBe(before.editorHeight);
    await expect(editor.getByRole('heading')).toContainText('Create Provider');
  });
});

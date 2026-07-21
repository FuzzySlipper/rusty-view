import { expect, test } from '@playwright/test';

const live = process.env['RV_SWITCHBOARD_PROXY_LIVE_RUN'] === '1';
const proxyUrl =
  process.env['RV_SWITCHBOARD_PROXY_URL'] ??
  'https://rusty-debug.dragonden.stream';

test.describe('Service switchboard portless proxy @live-switchboard-proxy', () => {
  test.skip(
    !live,
    'set RV_SWITCHBOARD_PROXY_LIVE_RUN=1 for the installed debug proxy',
  );

  test('loads the debug directory without probing production coordination', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const target = new URL(proxyUrl);
    expect(target.port).toBe('');

    const errors: string[] = [];
    const responses: Array<{ readonly path: string; readonly status: number }> =
      [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path.includes('/coordination/')) {
        responses.push({ path, status: response.status() });
      }
    });

    await page.goto(target.href);
    await page.locator('[data-menu-id="service"]').click();
    const servicePanel = page.getByTestId('top-menu-panel-service');
    await servicePanel.getByRole('button', { name: 'Switchboard' }).click();

    const switchboard = page.getByTestId('service-switchboard');
    await expect(switchboard).toBeVisible();
    await expect(switchboard).toContainText('debug');
    await expect
      .poll(() =>
        responses.some(
          (response) =>
            response.path === '/v1/debug/coordination/agents' &&
            response.status === 200,
        ),
      )
      .toBe(true);
    expect(
      responses.filter((response) =>
        response.path.startsWith('/v1/coordination/'),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
});

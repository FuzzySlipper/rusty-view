import { expect, test, type APIRequestContext } from '@playwright/test';

const live = process.env['RV_PROVIDER_OAUTH_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('provider OAuth unconfigured state @live-provider', () => {
  test.skip(
    !live,
    'set RV_PROVIDER_OAUTH_LIVE_RUN=1 for the real Crew debug provider scenario',
  );

  test('keeps an alias-local missing OAuth provider explicit through structural save', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(2 * 60_000);
    const provider = await unconfiguredOpenAiProvider(request);
    let statusReads = 0;
    page.on('request', (browserRequest) => {
      const pathname = new URL(browserRequest.url()).pathname;
      if (
        browserRequest.method() === 'GET' &&
        pathname ===
          `/v1/admin/model-providers/${encodeURIComponent(provider.alias)}/oauth/openai/status`
      ) {
        statusReads += 1;
      }
    });

    await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
    await page.locator('[data-menu-id="providers"]').click();
    const panel = page.getByTestId('top-menu-panel-providers');
    await expect(panel).toBeVisible();
    const row = panel
      .locator('.rv-admin-providers__provider')
      .filter({ hasText: provider.alias });
    await expect(row).toContainText('unconfigured', { timeout: 30_000 });
    await row.getByRole('button', { name: 'Edit' }).click();

    const credentialMode = panel
      .getByText('Credential Mode')
      .locator('..')
      .locator('select');
    await expect(credentialMode).toHaveValue('unconfigured');
    await credentialMode.selectOption('openai_oauth');
    await expect(panel).toContainText(
      'OAuth is unconfigured for this provider alias',
      { timeout: 30_000 },
    );
    await expect(panel).toContainText(
      'Credentials from another alias or Crew service are not reused',
    );
    expect(statusReads).toBeGreaterThan(0);

    await panel.getByRole('button', { name: 'Update Provider' }).click();
    await expect(panel).toContainText(
      'OAuth is unconfigured for this provider alias',
      { timeout: 30_000 },
    );
    await expect(credentialMode).toHaveValue('openai_oauth');
    expect(statusReads).toBeGreaterThanOrEqual(2);
    await page.screenshot({
      path: testInfo.outputPath('provider-oauth-unconfigured.png'),
      fullPage: true,
    });
  });
});

async function unconfiguredOpenAiProvider(request: APIRequestContext) {
  const response = await request.get(
    `${backend}/v1/admin/model-providers?limit=100&offset=0`,
  );
  expect(response.ok()).toBe(true);
  const envelope = (await response.json()) as {
    data: {
      items: Array<{
        alias: string;
        providerKind: string;
        credential: { hasSecret: boolean; kind?: string };
      }>;
    };
  };
  const provider = envelope.data.items.find(
    (candidate) =>
      candidate.providerKind.toLowerCase() === 'openai' &&
      !candidate.credential.hasSecret,
  );
  expect(
    provider,
    'an unconfigured OpenAI provider on Crew debug',
  ).toBeDefined();
  if (provider === undefined) {
    throw new Error('Crew debug has no unconfigured OpenAI provider.');
  }
  return provider;
}

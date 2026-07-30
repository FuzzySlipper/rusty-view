import { expect, test, type Route } from '@playwright/test';

const sharedCredentialId = 'openai:shared';

interface ProviderFixture {
  alias: string;
  credentialId?: string;
  revision: number;
}

test('two provider aliases reuse one credential and unlink without deleting it', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const providers: ProviderFixture[] = [
    { alias: 'sol', credentialId: sharedCredentialId, revision: 2 },
    { alias: 'terra', revision: 1 },
  ];
  const calls: string[] = [];

  await page.route('**/v1/**', async (route) => {
    await fulfillApi(route, providers, calls);
  });
  const credentialRegistryLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/v1/admin/service-credentials'
    );
  });
  await page.goto('/');
  await credentialRegistryLoaded;
  await page.locator('[data-menu-id="providers"]').click();

  const panel = page.getByTestId('top-menu-panel-providers');
  const terraRow = panel
    .locator('.rv-admin-providers__provider')
    .filter({ hasText: 'terra' });
  await expect(terraRow).toContainText('no shared credential');
  await terraRow
    .getByRole('button', { name: 'Edit' })
    .evaluate((button: HTMLButtonElement) => button.click());
  expect(pageErrors).toEqual([]);
  await expect(
    panel.getByRole('heading', { name: 'Edit Provider' }),
  ).toBeVisible();

  const selector = panel.getByTestId('provider-credential-selector');
  const sharedCredentialOption = selector.locator(
    `option[value="reuse:${sharedCredentialId}"]`,
  );
  await expect(sharedCredentialOption).toHaveCount(1);
  await selector.selectOption(`reuse:${sharedCredentialId}`);
  await panel.getByRole('button', { name: 'Update Provider' }).click();

  await expect
    .poll(
      () => calls.filter((call) => call.endsWith('/credential/link')).length,
    )
    .toBe(1);
  await expect
    .poll(
      () =>
        providers.find((provider) => provider.alias === 'terra')?.credentialId,
    )
    .toBe(sharedCredentialId);
  await panel.getByRole('button', { name: 'Refresh' }).click();

  await expect(
    panel.locator('.rv-admin-providers__provider').filter({ hasText: 'terra' }),
  ).toContainText(sharedCredentialId);
  const impact = panel.getByTestId('credential-impact');
  await expect(impact).toContainText('2 linked aliases');
  await expect(impact).toContainText('sol');
  await expect(impact).toContainText('terra');

  await panel.getByRole('button', { name: 'Unlink from Provider' }).click();
  await expect(impact).toContainText('1 linked aliases');
  await expect(impact).toContainText('sol');
  await expect(impact).not.toContainText('terra');
  await expect(
    panel.getByRole('button', { name: 'Clear Shared Credential' }),
  ).toBeDisabled();
  await expect(
    panel.getByRole('button', { name: 'Delete Shared Credential' }),
  ).toBeDisabled();
  await expect(selector).toHaveValue('unconfigured');
  await expect(sharedCredentialOption).toHaveCount(1);
});

async function fulfillApi(
  route: Route,
  providers: ProviderFixture[],
  calls: string[],
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  calls.push(`${method} ${path}`);
  const envelope = (data: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ ok: status < 400, data }),
    });

  if (path === '/v1/admin/diagnostics') {
    return envelope({
      overview: {
        generatedAt: '2026-07-17T00:00:00Z',
        health: 'ok',
        degraded: false,
        reasonCodes: [],
        summary: {
          sessions: 0,
          activeSessions: 0,
          idleSessions: 0,
          archivedSessions: 0,
          delegatedSessions: 0,
          blockedDelegations: 0,
          pendingQueueItems: 0,
          expiredQueueItems: 0,
          toolErrors: 0,
          recentErrors: 0,
        },
        runtime: {
          brainModules: [],
          sessions: [],
          delegatedSessions: [],
          runtimePauses: [],
        },
      },
      health: {},
    });
  }
  if (path === '/v1/admin/model-providers' && method === 'GET') {
    return envelope(pageOf(providers.map(providerRecord)));
  }
  if (path === '/v1/admin/service-credentials' && method === 'GET') {
    return envelope(pageOf([credentialRecord(providers)]));
  }
  if (
    path ===
      `/v1/admin/service-credentials/${encodeURIComponent(sharedCredentialId)}/impact` &&
    method === 'GET'
  ) {
    const linked = providers.filter(
      (provider) => provider.credentialId === sharedCredentialId,
    );
    return envelope({
      credential: credentialRecord(providers),
      linkedProviderAliases: linked.map((provider) => provider.alias),
      linkedProviders: linked.map(providerRecord),
      canClear: linked.length === 0,
      canDelete: linked.length === 0,
    });
  }
  if (
    path ===
      `/v1/admin/service-credentials/${encodeURIComponent(sharedCredentialId)}/oauth/openai/status` &&
    method === 'GET'
  ) {
    return envelope({
      credential: credentialRecord(providers),
      pendingLogins: [],
    });
  }
  const providerMatch = /^\/v1\/admin\/model-providers\/([^/]+)(.*)$/.exec(
    path,
  );
  if (providerMatch !== null) {
    const alias = decodeURIComponent(providerMatch[1] ?? '');
    const suffix = providerMatch[2] ?? '';
    const provider = providers.find((candidate) => candidate.alias === alias);
    if (provider === undefined) return envelope({}, 404);
    if (method === 'PATCH' && suffix === '') {
      provider.revision += 1;
      return envelope({
        provider: providerRecord(provider),
        refresh: { mode: 'none', affectedProfiles: [], outcomes: [] },
      });
    }
    if (method === 'POST' && suffix === '/credential/link') {
      provider.credentialId = sharedCredentialId;
      provider.revision += 1;
      return envelope({
        provider: providerRecord(provider),
        credential: credentialRecord(providers),
      });
    }
    if (method === 'POST' && suffix === '/credential/unlink') {
      delete provider.credentialId;
      provider.revision += 1;
      return envelope({ provider: providerRecord(provider) });
    }
  }
  if (path.startsWith('/v1/admin/')) {
    if (path.endsWith('/config-validation')) return envelope(null);
    return envelope(pageOf([]));
  }
  if (path === '/v1/chat/sessions') return envelope(pageOf([]));
  return envelope({});
}

function providerRecord(provider: ProviderFixture) {
  const linked = provider.credentialId === sharedCredentialId;
  return {
    alias: provider.alias,
    status: 'active',
    protocol: 'responses',
    providerKind: 'openai',
    displayName: provider.alias.toUpperCase(),
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    modelId: `gpt-5.6-${provider.alias}`,
    chatCompletionsDialect: 'standard',
    thinkingMode: 'provider_default',
    reasoningHistory: 'provider_default',
    ...(linked ? { credentialId: sharedCredentialId } : {}),
    credential: linked
      ? { hasSecret: true, kind: 'openai_oauth', status: 'configured' }
      : { hasSecret: false },
    metadataJson: {},
    revision: provider.revision,
    createdAt: '2026-07-17T00:00:00Z',
    updatedAt: '2026-07-17T00:00:00Z',
  };
}

function credentialRecord(providers: ProviderFixture[]) {
  return {
    credentialId: sharedCredentialId,
    displayName: 'Shared OpenAI OAuth',
    providerKind: 'openai',
    credentialKind: 'openai_oauth',
    credential: {
      hasSecret: true,
      kind: 'openai_oauth',
      status: 'configured',
    },
    linkedProviderAliases: providers
      .filter((provider) => provider.credentialId === sharedCredentialId)
      .map((provider) => provider.alias),
    revision: 1,
    createdAt: '2026-07-17T00:00:00Z',
    updatedAt: '2026-07-17T00:00:00Z',
  };
}

function pageOf<T>(items: readonly T[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

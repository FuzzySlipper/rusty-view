import { expect, test } from '@playwright/test';

test('admin separates shared endpoints from model configurations and keeps all credentials selectable', async ({
  page,
}) => {
  const endpoint = {
    endpointId: 'shared-endpoint',
    status: 'active',
    displayName: 'Shared endpoint',
    baseUrl: 'https://api.example.test/v1',
    protocol: 'chat_completions',
    wireDialect: 'standard',
    authScheme: 'bearer_api_key',
    credentialId: 'credential:moonshot',
    promptCacheTransport: 'none',
    metadataJson: {},
    revision: 4,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:00Z',
  };
  const configuration = {
    modelConfigId: 'model-a',
    endpointId: endpoint.endpointId,
    status: 'active',
    modelId: 'model-a-v1',
    reasoningHistory: 'provider_default',
    thinkingMode: 'provider_default',
    promptCachingPolicy: 'disabled',
    capabilities: { version: 1, imageInput: false },
    metadataJson: {},
    revision: 9,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:00Z',
  };
  const writes: unknown[] = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const envelope = (data: unknown) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data }),
      });
    if (path === '/v1/admin/model-endpoints') {
      return envelope(pageOf([endpoint]));
    }
    if (path === `/v1/admin/model-endpoints/${endpoint.endpointId}`) {
      const body = request.postDataJSON();
      writes.push(body);
      Object.assign(endpoint, body, { revision: endpoint.revision + 1 });
      return envelope({ endpoint });
    }
    if (path === '/v1/admin/model-configurations') {
      return envelope(pageOf([configuration]));
    }
    if (path === '/v1/admin/service-credentials') {
      return envelope(
        pageOf([
          credential('credential:moonshot', 'moonshot'),
          credential('credential:openai', 'openai'),
          credential('credential:custom', 'custom'),
        ]),
      );
    }
    if (path === '/v1/admin/model-providers') return envelope(pageOf([]));
    if (path === '/v1/admin/diagnostics') return envelope(diagnostics());
    if (path.endsWith('/config-validation')) return envelope(null);
    if (path.startsWith('/v1/admin/')) return envelope(pageOf([]));
    if (path === '/v1/chat/sessions') return envelope(pageOf([]));
    return envelope({});
  });

  await page.goto('/');
  await page.locator('[data-menu-id="providers"]').click();
  const panel = page.getByTestId('top-menu-panel-providers');
  await expect(
    panel.getByRole('heading', { name: 'Model Endpoints' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: 'Model Configurations' }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Edit Endpoint' }).click();
  await expect(panel.getByTestId('model-endpoint-impact')).toContainText(
    'model-a',
  );
  const credentialSelector = panel.getByTestId('model-endpoint-credential');
  await expect(credentialSelector.locator('option')).toHaveCount(4);
  await credentialSelector.selectOption('credential:custom');
  await panel.getByRole('button', { name: 'Update Endpoint' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    credentialId: 'credential:custom',
    expectedRevision: 4,
  });
  const legacy = panel.getByTestId('legacy-model-providers');
  await expect(legacy).toContainText('read-only');
  await expect(legacy.locator('button')).toHaveCount(0);
});

function credential(credentialId: string, providerKind: string) {
  return {
    credentialId,
    displayName: credentialId,
    providerKind,
    credentialKind: 'api_key',
    credential: { hasSecret: true, kind: 'api_key', status: 'configured' },
    linkedProviderAliases: [],
    revision: 1,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:00Z',
  };
}

function pageOf<T>(items: T[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

function diagnostics() {
  return {
    overview: {
      generatedAt: '2026-08-13T00:00:00Z',
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
  };
}

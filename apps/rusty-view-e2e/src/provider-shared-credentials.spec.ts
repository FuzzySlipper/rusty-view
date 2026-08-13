import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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

test('creates and selects an API-key credential when the registry is empty', async ({
  page,
}) => {
  const calls = await installEmptyCredentialRegistry(page, 'bearer_api_key');
  await openModelsPanel(page);
  const panel = page.getByTestId('top-menu-panel-providers');
  await panel.getByRole('button', { name: 'Edit Endpoint' }).click();
  await panel
    .getByTestId('new-endpoint-credential-id')
    .fill('credential:new-key');
  await panel.locator('input[type="password"]').fill('secret-value');
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/v1/admin/service-credentials',
  );
  await panel
    .getByRole('button', { name: 'Create API Key Credential' })
    .click();
  const created = await createResponse;
  expect(created.ok()).toBe(true);
  expect(await created.json()).toMatchObject({
    data: { credential: { credentialId: 'credential:new-key' } },
  });
  await expect(panel.getByTestId('model-endpoint-credential')).toHaveValue(
    'credential:new-key',
  );
  expect(calls).toContainEqual(
    expect.objectContaining({
      path: '/v1/admin/service-credentials',
      body: expect.objectContaining({
        credentialId: 'credential:new-key',
        credentialKind: 'api_key',
        secret: 'secret-value',
      }),
    }),
  );
});

test('creates and selects an OAuth credential when the registry is empty', async ({
  page,
}) => {
  const calls = await installEmptyCredentialRegistry(
    page,
    'openai_codex_oauth',
  );
  await openModelsPanel(page);
  const panel = page.getByTestId('top-menu-panel-providers');
  await panel.getByRole('button', { name: 'Edit Endpoint' }).click();
  await panel
    .getByTestId('new-endpoint-credential-id')
    .fill('credential:new-oauth');
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/v1/admin/service-credentials',
  );
  await panel.getByRole('button', { name: 'Start OpenAI OAuth' }).click();
  const created = await createResponse;
  expect(created.ok()).toBe(true);
  expect(await created.json()).toMatchObject({
    data: { credential: { credentialId: 'credential:new-oauth' } },
  });

  await expect(panel.getByTestId('model-endpoint-credential')).toHaveValue(
    'credential:new-oauth',
  );
  expect(calls).toContainEqual(
    expect.objectContaining({
      path: '/v1/admin/service-credentials',
      body: expect.objectContaining({
        credentialId: 'credential:new-oauth',
        credentialKind: 'openai_oauth',
      }),
    }),
  );
  expect(calls).toContainEqual(
    expect.objectContaining({
      path: '/v1/admin/service-credentials/credential%3Anew-oauth/oauth/openai/start',
    }),
  );
});

interface CapturedCall {
  path: string;
  body?: Record<string, unknown>;
}

async function installEmptyCredentialRegistry(
  page: Page,
  authScheme: 'bearer_api_key' | 'openai_codex_oauth',
): Promise<CapturedCall[]> {
  const calls: CapturedCall[] = [];
  const credentials: ReturnType<typeof credential>[] = [];
  const endpoint = {
    endpointId: `endpoint-${authScheme}`,
    status: 'active',
    displayName: 'Credential test endpoint',
    baseUrl: 'https://api.example.test/v1',
    protocol: 'chat_completions',
    wireDialect: 'standard',
    authScheme,
    credentialId: null,
    promptCacheTransport: 'none',
    metadataJson: {},
    revision: 1,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:00Z',
  };
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const envelope = (data: unknown) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data }),
      });
    if (path === '/v1/admin/service-credentials') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>;
        calls.push({ path, body });
        const created = credential(
          String(body['credentialId']),
          String(body['providerKind']),
          String(body['credentialKind']),
        );
        credentials.push(created);
        return envelope({ credential: created });
      }
      return envelope(pageOf(credentials));
    }
    if (path.endsWith('/oauth/openai/start')) {
      calls.push({ path });
      return envelope({
        credential: credentials[0],
        pendingLogin: {
          pendingLoginId: 'pending-1',
          credentialId: credentials[0]?.credentialId,
          issuer: 'https://auth.openai.com',
          clientId: 'client',
          redirectUri: 'http://localhost:1455/auth/callback',
          authorizationUrl: 'https://auth.openai.com/authorize',
          expiresAt: '2026-08-13T01:00:00Z',
        },
        loginConfig: {
          issuer: 'https://auth.openai.com',
          clientId: 'client',
          redirectUri: 'http://localhost:1455/auth/callback',
          redirectUriOverrideAllowed: false,
          redirectUriMode: 'registered',
          callbackUrlCompletionAccepted: true,
          callbackUrlCompletionField: 'callbackUrl',
          pendingLoginIdRequiredForCallbackUrl: false,
          remoteOperatorFlow: 'paste_callback_url',
        },
      });
    }
    if (path === '/v1/admin/model-endpoints')
      return envelope(pageOf([endpoint]));
    if (path === '/v1/admin/model-configurations') return envelope(pageOf([]));
    if (path === '/v1/admin/model-providers') return envelope(pageOf([]));
    if (path === '/v1/admin/diagnostics') return envelope(diagnostics());
    if (path.endsWith('/config-validation')) return envelope(null);
    if (path.startsWith('/v1/admin/')) return envelope(pageOf([]));
    if (path === '/v1/chat/sessions') return envelope(pageOf([]));
    return envelope({});
  });
  return calls;
}

async function openModelsPanel(page: Page) {
  await page.goto('/');
  await page.locator('[data-menu-id="providers"]').click();
}

function credential(
  credentialId: string,
  providerKind: string,
  credentialKind = 'api_key',
) {
  return {
    credentialId,
    displayName: credentialId,
    providerKind,
    credentialKind,
    credential: { hasSecret: true, kind: credentialKind, status: 'configured' },
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

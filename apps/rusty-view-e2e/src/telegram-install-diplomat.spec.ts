import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';

type DiplomatState = 'healthy' | 'disconnected' | 'unconfigured';

interface DiplomatFixture {
  state: DiplomatState;
  credentialRevision: number;
  bindingRevision: number;
  boundSessionId: string;
  tokenRotations: number;
  moves: Array<{ sessionId: string; expectedRevision: number }>;
  calls: string[];
}

test('desktop setup, healthy diagnostics, token rotation, and exact binding switch', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture: DiplomatFixture = {
    state: 'healthy',
    credentialRevision: 4,
    bindingRevision: 7,
    boundSessionId: 'session-a',
    tokenRotations: 0,
    moves: [],
    calls: [],
  };
  await installApiFixture(page, fixture);
  await openTelegramPanel(page);

  const panel = page.getByTestId('telegram-diplomat-panel');
  await expect(page.getByTestId('telegram-diplomat-state')).toHaveText(
    'healthy',
  );
  await expect(panel).toContainText('@InstallDiplomatBot');
  await expect(page.getByTestId('telegram-session-separation')).toContainText(
    'profile-a',
  );
  await expect(page.getByTestId('telegram-session-separation')).toContainText(
    '/home/dev/agora',
  );
  await expect(panel).toContainText('loop terminated');
  await expect(panel).toContainText('last inbound');
  await expect(panel).toContainText('media available / failed');

  await page.getByTestId('telegram-token-input').fill('rotated-token');
  await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(
        '/v1/admin/telegram-diplomat/credential',
      ),
    ),
    panel.getByRole('button', { name: 'Rotate token' }).click(),
  ]);
  await expect.poll(() => fixture.tokenRotations).toBe(1);

  const operations = panel.locator('.rv-telegram__operations');
  await operations.locator('select').selectOption('session-b');
  await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/move'),
    ),
    page.waitForResponse((response) => {
      const candidate = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        candidate.pathname === '/v1/admin/telegram-diplomat'
      );
    }),
    operations.getByRole('button', { name: 'Move binding only' }).click(),
  ]);
  await expect
    .poll(() => fixture.moves)
    .toEqual([{ sessionId: 'session-b', expectedRevision: 7 }]);
  await expect
    .poll(
      () =>
        fixture.calls.filter(
          (call) => call === 'GET /v1/admin/telegram-diplomat',
        ).length,
    )
    .toBeGreaterThanOrEqual(2);
  expect(pageErrors).toEqual([]);
  await openTelegramPanel(page);
  await expect(panel).toContainText('session-b');
  await expect(panel).toContainText('profile-b');
  await expect(panel).toContainText('/home/dev/rusty-roleplay');
  await expect(panel).toContainText(
    'They do not archive either session, edit a profile, or change a working directory.',
  );

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach('telegram-diplomat-desktop-healthy-switch', {
    body: screenshot,
    contentType: 'image/png',
  });
  await captureEvidence(page, 'telegram-diplomat-desktop-healthy-switch.png');
  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await captureEvidence(
    page,
    'telegram-diplomat-desktop-operations-diagnostics.png',
  );
});

test('mobile disconnected and empty state remains operable without horizontal overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture: DiplomatFixture = {
    state: 'disconnected',
    credentialRevision: 4,
    bindingRevision: 0,
    boundSessionId: '',
    tokenRotations: 0,
    moves: [],
    calls: [],
  };
  await installApiFixture(page, fixture);
  await openTelegramPanel(page);

  await expect(page.getByTestId('telegram-diplomat-state')).toHaveText(
    'disconnected',
  );
  await expect(page.getByTestId('telegram-candidates-empty')).toBeVisible();
  await expect(page.getByTestId('telegram-bindings-empty')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  const inputs = page.locator('.rv-telegram input, .rv-telegram select');
  const widths = await inputs.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().width),
  );
  expect(widths.every((width) => width <= 360)).toBe(true);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach('telegram-diplomat-mobile-disconnected-empty', {
    body: screenshot,
    contentType: 'image/png',
  });
  await captureEvidence(
    page,
    'telegram-diplomat-mobile-disconnected-empty.png',
  );
  await page.getByTestId('telegram-diplomat-panel').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await captureEvidence(page, 'telegram-diplomat-mobile-empty-diagnostics.png');
});

async function openTelegramPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-menu-id="service"]').click();
  await page.getByTestId('service-telegram-tab').click();
  await expect(page.getByTestId('telegram-diplomat-panel')).toBeVisible();
  await expect(page.getByTestId('telegram-diplomat-state')).toBeVisible();
}

async function installApiFixture(
  page: Page,
  fixture: DiplomatFixture,
): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    await fulfillApi(route, fixture);
  });
}

async function fulfillApi(
  route: Route,
  fixture: DiplomatFixture,
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  fixture.calls.push(`${method} ${path}`);
  const envelope = (data: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: status < 400,
        data,
        meta: { request_id: 'e2e', schema_version: 1 },
      }),
    });

  if (path === '/v1/admin/telegram-diplomat' && method === 'GET') {
    return envelope(diplomatReadback(fixture));
  }
  if (path === '/v1/admin/telegram-diplomat/credential' && method === 'POST') {
    fixture.tokenRotations += 1;
    fixture.credentialRevision += 1;
    fixture.state = 'healthy';
    return envelope({ ...diplomatReadback(fixture), tokenUpdated: true });
  }
  const moveMatch =
    /^\/v1\/admin\/telegram-diplomat\/bindings\/([^/]+)\/move$/.exec(path);
  if (moveMatch !== null && method === 'POST') {
    const body = request.postDataJSON() as {
      sessionId: string;
      expectedRevision: number;
    };
    fixture.moves.push({
      sessionId: body.sessionId,
      expectedRevision: body.expectedRevision,
    });
    fixture.boundSessionId = body.sessionId;
    fixture.bindingRevision += 1;
    return envelope({ binding: diplomatReadback(fixture).bindings[0] });
  }
  if (path === '/v1/admin/telegram-diplomat/reload' && method === 'POST') {
    return envelope(diplomatReadback(fixture));
  }
  if (path === '/v1/coordination/agents') {
    return envelope({
      deploymentRole: 'production',
      agents: sessionDirectory(),
    });
  }
  if (path === '/v1/admin/diagnostics') {
    return envelope(adminDiagnostics());
  }
  if (path === '/v1/chat/sessions') return envelope(pageOf([]));
  if (path.startsWith('/v1/admin/')) {
    if (path.endsWith('/config-validation')) return envelope(null);
    return envelope(pageOf([]));
  }
  return envelope({});
}

function diplomatReadback(fixture: DiplomatFixture) {
  const healthy = fixture.state === 'healthy';
  const hasBinding = fixture.bindingRevision > 0;
  const session = sessionDirectory().find(
    (candidate) => candidate.sessionId === fixture.boundSessionId,
  );
  return {
    state: fixture.state,
    enabled: true,
    adapterId: 'telegram-main',
    credentialId: 'telegram-main',
    credential: {
      credentialId: 'telegram-main',
      displayName: 'Install diplomat',
      providerKind: 'telegram',
      credentialKind: 'api_key',
      credential: { hasSecret: true },
      linkedProviderAliases: [],
      revision: fixture.credentialRevision,
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-10T01:00:00Z',
    },
    ...(healthy
      ? {
          botIdentity: {
            userId: '9001',
            username: 'InstallDiplomatBot',
            displayLabel: 'Workshop Diplomat',
          },
        }
      : {}),
    candidates: healthy
      ? [
          {
            externalChatId: '-100200',
            externalThreadId: '42',
            chatType: 'supergroup',
            title: 'Crew support',
            lastObservedAt: '2026-08-10T01:00:00Z',
            lastUpdateId: 122,
          },
        ]
      : [],
    bindings: hasBinding
      ? [
          {
            schemaVersion: '1',
            bindingId: 'diplomat:workshop',
            revision: fixture.bindingRevision,
            installationId: 'workshop',
            installationLabel: 'Workshop Crew',
            adapterId: 'telegram-main',
            botUserId: '9001',
            botUsername: 'InstallDiplomatBot',
            agentId: session?.agentId ?? 'agent-a',
            sessionId: fixture.boundSessionId,
            externalChatId: '-100200',
            externalThreadId: '42',
            participationMode: 'mention_or_reply',
            status: 'active',
            createdAt: '2026-08-10T00:00:00Z',
            updatedAt: '2026-08-10T01:00:00Z',
          },
        ]
      : [],
    connector: {
      enabled: true,
      running: healthy,
      adapterId: 'telegram-main',
      bindingCount: hasBinding ? 1 : 0,
      pollCount: 32,
      lastPollAt: '2026-08-10T01:00:00Z',
      lastInboundAt: '2026-08-10T00:59:00Z',
      lastOutboundAt: '2026-08-10T00:59:30Z',
      lastUpdateId: 122,
      nextOffset: 123,
      ...(!healthy ? { lastError: 'Telegram getMe failed: 401' } : {}),
      candidates: [],
      inbound: {
        routed: 8,
        unbound: 0,
        ambiguous: 0,
        expired: 0,
        duplicate: 0,
        staleCursor: 0,
        failed: 0,
        humanMessages: 8,
        botMessages: 2,
        ignored: 1,
        edited: 0,
        unsupported: 0,
        retryPending: 0,
        quarantined: 0,
        loopTerminated: 1,
        rateLimited: 0,
      },
      outbound: {
        sent: 7,
        chunksSent: 8,
        retried: 1,
        failed: 0,
        lastExternalMessageId: '501',
      },
      media: {
        available: 2,
        duplicate: 0,
        unsupported: 0,
        oversized: 0,
        expired: 0,
        failed: 0,
        retried: 0,
        bytesStored: 4096,
      },
    },
  };
}

function sessionDirectory() {
  return [
    {
      agentId: 'agent-a',
      sessionId: 'session-a',
      profileId: 'profile-a',
      displayLabel: 'Agora',
      runtimeKind: 'direct_brain',
      sessionKind: 'full',
      sessionStatus: 'idle',
      routable: true,
      workdir: '/home/dev/agora',
    },
    {
      agentId: 'agent-b',
      sessionId: 'session-b',
      profileId: 'profile-b',
      displayLabel: 'Roleplay',
      runtimeKind: 'direct_brain',
      sessionKind: 'full',
      sessionStatus: 'active',
      routable: true,
      workdir: '/home/dev/rusty-roleplay',
    },
  ];
}

function adminDiagnostics() {
  return {
    overview: {
      generatedAt: '2026-08-10T00:00:00Z',
      health: 'ok',
      degraded: false,
      reasonCodes: [],
      summary: {
        sessions: 2,
        activeSessions: 1,
        idleSessions: 1,
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

function pageOf<T>(items: readonly T[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

async function captureEvidence(page: Page, name: string): Promise<void> {
  const root = process.env['PLAYWRIGHT_BROKER_ARTIFACT_ROOT'];
  if (root === undefined || root.length === 0) return;
  await page.screenshot({ path: path.join(root, name), fullPage: true });
}

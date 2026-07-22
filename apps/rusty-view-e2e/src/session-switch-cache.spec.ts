import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';

const SESSION_OPEN_DELAY_MS = 250;

test('hot Profile and Agent revisits paint atomically in under 100ms', async ({
  page,
}) => {
  await installBackend(page);
  await page.goto('/?api=http://crew.test');
  await expect(page.locator('.rv-debug__header')).toBeVisible({
    timeout: 15_000,
  });

  const profiles = page.getByTestId('profile-row');
  await expect(profiles).toHaveCount(2, { timeout: 15_000 });

  await page
    .locator('[data-testid="profile-row"][data-profile-id="profile-a"]')
    .click();
  await expect(page.getByTestId('session-transcript-loading')).toBeVisible();
  await expect(page.getByText('profile-a message 119')).toBeVisible();
  await page
    .locator('[data-testid="profile-row"][data-profile-id="profile-b"]')
    .click();
  await expect(page.getByText('profile-b message 119')).toBeVisible();
  await assertAtomicHotSwitch(
    page,
    page.locator('[data-testid="profile-row"][data-profile-id="profile-a"]'),
    'profile-a message 119',
  );

  await page.getByTestId('external-agents-tab').click();
  const agents = page.getByTestId('external-agent-row');
  await expect(agents).toHaveCount(2, { timeout: 15_000 });
  await agents
    .filter({ hasText: 'Agent A' })
    .locator('.rv-agent__select')
    .click();
  await expect(page.getByTestId('session-transcript-loading')).toBeVisible();
  await expect(page.getByText('agent-a message 79')).toBeVisible();
  await agents
    .filter({ hasText: 'Agent B' })
    .locator('.rv-agent__select')
    .click();
  await expect(page.getByText('agent-b message 79')).toBeVisible();
  await assertAtomicHotSwitch(
    page,
    agents.filter({ hasText: 'Agent A' }).locator('.rv-agent__select'),
    'agent-a message 79',
  );
});

async function assertAtomicHotSwitch(
  page: Page,
  target: Locator,
  expectedText: string,
): Promise<void> {
  await page.evaluate(() => {
    const transcript = document.querySelector(
      '[data-testid="transcript-shell"]',
    );
    if (transcript === null) throw new Error('transcript shell not found');
    const probe = {
      startedAt: performance.now(),
      observedZeroRows: false,
      observer: undefined as MutationObserver | undefined,
    };
    probe.observer = new MutationObserver(() => {
      if (transcript.querySelectorAll('.rv-transcript__item').length === 0) {
        probe.observedZeroRows = true;
      }
    });
    probe.observer.observe(transcript, { childList: true, subtree: true });
    Object.assign(window, { __rvSessionSwitchProbe: probe });
  });

  await target.click();
  await expect(page.getByText(expectedText)).toBeVisible();
  const result = await page.evaluate(() => {
    const probe = (
      window as Window & {
        __rvSessionSwitchProbe?: {
          startedAt: number;
          observedZeroRows: boolean;
          observer?: MutationObserver;
        };
      }
    ).__rvSessionSwitchProbe;
    if (probe === undefined) throw new Error('switch probe not installed');
    probe.observer?.disconnect();
    return {
      elapsedMs: performance.now() - probe.startedAt,
      observedZeroRows: probe.observedZeroRows,
    };
  });

  expect(result.observedZeroRows).toBe(false);
  expect(result.elapsedMs).toBeLessThan(100);
}

async function installBackend(page: Page): Promise<void> {
  const sessions = ['a', 'b'].map((suffix, index) => ({
    session_id: `session-${suffix}`,
    agent_id: `agent-${suffix}`,
    profile_id: `profile-${suffix}`,
    kind: 'full',
    status: 'idle',
    title: `Profile ${suffix.toUpperCase()}`,
    latest_cursor: `session-${suffix}:120`,
    created_at: `2026-07-20T0${index}:00:00Z`,
    updated_at: `2026-07-21T0${index}:00:00Z`,
    message_count: 120,
    tool_event_count: 0,
  }));
  const runtime = {
    runtimeId: 'runtime-1',
    kind: 'codex_app_server',
    desiredState: 'enabled',
    observedState: 'ready',
    processOwnership: 'attached',
    endpoint: { transport: 'unix_web_socket', address: '/run/codex.sock' },
    compatibilityState: 'certified',
    consumedContractRevision: 'external-runtime-api-v0',
    observedCliVersion: '0.144.1',
    revision: 1,
    createdAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-07-21T00:00:00Z',
  };
  const threads = [
    externalThread('thread-a', 'Agent A', 'agent-a'),
    externalThread('thread-b', 'Agent B', 'agent-b'),
  ];
  const bindings = threads.map((thread, index) => ({
    bindingId: `binding-${index}`,
    runtimeId: runtime.runtimeId,
    nativeThreadId: thread.threadId,
    sessionId: thread.sessionId,
    agentId: `agent-${index}`,
    purpose: 'crew_agent',
    status: 'active',
    cwd: '/home/dev/rusty-view',
    revision: 1,
    createdAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-07-21T00:00:00Z',
  }));

  await page.route('http://crew.test/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/stream')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
      return;
    }
    if (pathname === '/v1/chat/commands')
      return fulfill(route, { commands: [] });
    if (pathname === '/v1/chat/sessions') {
      return fulfill(route, {
        items: sessions,
        total: 2,
        limit: 100,
        offset: 0,
      });
    }
    const nativeOpen = pathname.match(/^\/v1\/chat\/sessions\/([^/]+)$/);
    if (nativeOpen !== null) {
      await delay(SESSION_OPEN_DELAY_MS);
      const session = sessions.find(
        (item) => item.session_id === nativeOpen[1],
      );
      return fulfill(route, {
        session,
        events: nativeMessages(nativeOpen[1] ?? ''),
        latest_cursor: `${nativeOpen[1]}:120`,
        has_more_before: false,
      });
    }
    if (pathname.includes('/context'))
      return route.fulfill({ status: 404, body: '{}' });
    if (pathname === '/v1/admin/profiles/registry') {
      return fulfill(route, { items: [], total: 0, limit: 100, offset: 0 });
    }
    if (pathname === '/v1/external-runtimes') {
      return fulfill(route, {
        runtimes: [runtime],
        controllers: [
          {
            runtimeId: runtime.runtimeId,
            driverState: 'ready',
            controllerInstanceId: 'controller-1',
            controllerGeneration: 1,
            leaseExpiresAt: '2026-07-22T00:00:00Z',
            bindingResumeFailures: [],
          },
        ],
      });
    }
    if (pathname === '/v1/external-bindings')
      return fulfill(route, { bindings });
    if (pathname === '/v1/external-interactions')
      return fulfill(route, { interactions: [] });
    if (pathname.endsWith('/threads/read')) {
      await delay(SESSION_OPEN_DELAY_MS);
      const body = request.postDataJSON() as { threadId?: string };
      return fulfill(route, {
        thread: threads.find((thread) => thread.threadId === body.threadId),
      });
    }
    if (pathname.endsWith('/threads')) {
      return fulfill(route, {
        items: threads,
        nextCursor: null,
        backwardsCursor: null,
      });
    }
    if (pathname.endsWith('/events')) return fulfill(route, { events: [] });
    if (/\/v1\/external-bindings\/[^/]+\/commands$/.test(pathname)) {
      return fulfill(route, {
        contractVersion: '0.7.0',
        runtimeId: runtime.runtimeId,
        bindingId: pathname.split('/')[3],
        nativeThreadId: null,
        commands: [],
        settings: {
          model: 'gpt-5.6-sol',
          modelProvider: 'openai',
          effort: 'medium',
        },
        models: [],
      });
    }
    await route.fulfill({ status: 404, body: '{}' });
  });
}

function nativeMessages(sessionId: string): readonly Record<string, unknown>[] {
  return Array.from({ length: 120 }, (_, index) => ({
    event_id: `${sessionId}:${index + 1}`,
    session_id: sessionId,
    sequence_id: index + 1,
    created_at: '2026-07-21T00:00:00Z',
    kind: 'message_created',
    payload: {
      message_id: `${sessionId}-message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      body: `${sessionId.replace('session', 'profile')} message ${index}`,
    },
  }));
}

function externalThread(threadId: string, name: string, marker: string) {
  return {
    threadId,
    sessionId: `session-${threadId}`,
    parentThreadId: null,
    preview: name,
    ephemeral: false,
    modelProvider: 'openai',
    effectiveModel: 'gpt-5.6-sol',
    createdAt: 1,
    updatedAt: 2,
    status: 'active',
    cwd: '/home/dev/rusty-view',
    cliVersion: '0.144.1',
    name,
    agentNickname: null,
    agentRole: null,
    turns: Array.from({ length: 80 }, (_, index) => ({
      turnId: `${threadId}-turn-${index}`,
      status: 'completed',
      startedAt: index,
      completedAt: index + 1,
      durationMs: 1,
      items: [
        {
          itemId: `${threadId}-item-${index}`,
          kind: 'userMessage',
          status: 'completed',
          text: `${marker} message ${index}`,
        },
      ],
    })),
  };
}

function fulfill(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      data,
      meta: { request_id: 'session-switch-cache', schema_version: 1 },
    }),
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

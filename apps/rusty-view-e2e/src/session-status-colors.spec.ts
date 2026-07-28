import { expect, test } from '@playwright/test';

test('session statuses use distinct semantic colors in the Agents list', async ({
  page,
}) => {
  const sessions = [
    session('idle-session', 'external-agent-idle'),
    session('active-session', 'external-agent-active'),
    session('completed-session', 'external-agent-completed'),
    session('failed-session', 'external-agent-failed'),
  ];
  const threads = sessions.map((item) => nativeThread(item.session_id));
  const bindings = sessions.map((item) => binding(item.session_id));

  await page.route('http://crew.test/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const ok = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data,
          meta: { request_id: 'status-colors', schema_version: 1 },
        }),
      });

    if (pathname === '/v1/chat/sessions') {
      return ok({
        items: sessions,
        total: sessions.length,
        limit: 100,
        offset: 0,
      });
    }
    if (pathname === '/v1/coordination/agents') {
      return ok({
        deploymentRole: 'production',
        agents: sessions.map((item) => ({
          agentId: item.agent_id,
          bindingId: `binding-${item.session_id}`,
          bindingStatus: 'active',
          displayLabel: item.profile_id,
          profileId: item.profile_id,
          routable: true,
          runtimeId: 'runtime-1',
          runtimeKind: 'codex_app_server',
          sessionId: item.session_id,
          sessionKind: item.kind,
          sessionStatus: item.status,
          workdir: `/home/dev/${item.profile_id}`,
        })),
      });
    }
    if (pathname === '/v1/chat/commands') return ok({ commands: [] });
    if (pathname.startsWith('/v1/chat/sessions/')) {
      const item =
        sessions.find((candidate) => pathname.includes(candidate.session_id)) ??
        sessions[0];
      return ok({
        session: item,
        events: [],
        latest_cursor: '',
        has_more_before: false,
      });
    }
    if (pathname === '/v1/external-runtimes') {
      return ok({
        runtimes: [
          {
            runtimeId: 'runtime-1',
            kind: 'codex_app_server',
            desiredState: 'enabled',
            observedState: 'ready',
            processOwnership: 'attached',
            endpoint: {
              transport: 'unix_web_socket',
              address: '/run/codex.sock',
            },
            compatibilityState: 'certified',
            consumedContractRevision: 'external-runtime-api-v0',
            observedCliVersion: '0.144.1',
            revision: 1,
            createdAt: '2026-07-28T02:00:00Z',
            updatedAt: '2026-07-28T02:00:00Z',
          },
        ],
        controllers: [
          {
            runtimeId: 'runtime-1',
            driverState: 'ready',
            controllerInstanceId: 'controller-1',
            controllerGeneration: 1,
            leaseExpiresAt: '2026-07-28T03:00:00Z',
            bindingResumeFailures: [],
          },
        ],
      });
    }
    if (pathname === '/v1/external-bindings') return ok({ bindings });
    if (pathname === '/v1/external-interactions') {
      return ok({ interactions: [] });
    }
    if (pathname.endsWith('/threads')) {
      return ok({ items: threads, nextCursor: null, backwardsCursor: null });
    }
    if (pathname.endsWith('/events')) {
      return ok({
        events: [
          lifecycleEvent(1, 'active-session', 'active'),
          lifecycleEvent(2, 'completed-session', 'completed'),
          lifecycleEvent(3, 'failed-session', 'failed'),
        ],
      });
    }

    return route.fulfill({ status: 404, body: 'not mocked' });
  });

  await page.goto('/?api=http://crew.test');

  const tones = ['idle', 'active', 'completed', 'error'] as const;
  const colors = new Set<string>();
  for (const tone of tones) {
    const status = page.locator(
      `[data-session-id="${statusSessionId(tone)}"] .rv-profile-session__status`,
    );
    await expect(status).toHaveAttribute('data-status-tone', tone);
    colors.add(
      await status.evaluate((element) => getComputedStyle(element).color),
    );
  }

  expect(colors.size).toBe(4);
});

function session(sessionId: string, agentId: string) {
  return {
    session_id: sessionId,
    agent_id: agentId,
    profile_id: agentId,
    kind: 'full',
    status: 'idle',
    latest_cursor: '',
    updated_at: '2026-07-28T02:00:00Z',
  };
}

function nativeThread(sessionId: string) {
  return {
    threadId: `thread-${sessionId}`,
    sessionId,
    parentThreadId: null,
    preview: sessionId,
    ephemeral: false,
    modelProvider: 'openai',
    effectiveModel: 'gpt-5.6-sol',
    createdAt: 1,
    updatedAt: 2,
    status: 'idle',
    cwd: '/home/dev/rusty-view',
    cliVersion: '0.144.1',
    name: sessionId,
    agentNickname: null,
    agentRole: null,
    turns: [],
  };
}

function binding(sessionId: string) {
  return {
    bindingId: `binding-${sessionId}`,
    runtimeId: 'runtime-1',
    nativeThreadId: `thread-${sessionId}`,
    sessionId,
    agentId: `external-agent-${sessionId}`,
    purpose: 'crew_agent',
    status: 'active',
    cwd: '/home/dev/rusty-view',
    effectiveConfigFingerprint: 'config',
    messageDeliveryPolicy: 'immediate_steer',
    profileId: `external-agent-${sessionId}`,
    profilePromptHash: null,
    profileRevision: null,
    revision: 1,
    createdAt: '2026-07-28T02:00:00Z',
    updatedAt: '2026-07-28T02:00:00Z',
  };
}

function lifecycleEvent(sequenceId: number, sessionId: string, status: string) {
  return {
    eventId: `event-${sequenceId}`,
    runtimeId: 'runtime-1',
    sequenceId,
    createdAt: '2026-07-28T02:00:00Z',
    kind: 'turn_lifecycle',
    sessionId,
    nativeThreadId: `thread-${sessionId}`,
    nativeTurnId: `turn-${sessionId}`,
    payload: { nativeMethod: 'turn/status', status },
  };
}

function statusSessionId(tone: 'idle' | 'active' | 'completed' | 'error') {
  return `${tone === 'error' ? 'failed' : tone}-session`;
}

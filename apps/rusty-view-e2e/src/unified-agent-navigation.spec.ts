import { expect, test } from '@playwright/test';

test('Agents navigates Crew and Codex sessions while Codex retains management', async ({
  page,
}) => {
  const directSession = chatSession({
    session_id: 'direct-session',
    agent_id: 'software-engineer',
    updated_at: '2026-07-28T00:02:00Z',
  });
  const codexSession = chatSession({
    session_id: 'codex-session',
    agent_id: 'external-agent-1',
    updated_at: '2026-07-28T00:01:00Z',
  });
  const nativeThread = {
    threadId: 'native-thread-1',
    sessionId: 'codex-session',
    parentThreadId: null,
    preview: 'Native Codex session',
    ephemeral: false,
    modelProvider: 'openai',
    effectiveModel: 'gpt-5.6-sol',
    createdAt: 1,
    updatedAt: 2,
    status: 'idle',
    cwd: '/home/dev/rusty-view',
    cliVersion: '0.144.1',
    name: 'Native Codex session',
    agentNickname: null,
    agentRole: null,
    turns: [
      {
        turnId: 'native-turn-1',
        status: 'completed',
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        items: [
          {
            itemId: 'native-agent-message',
            kind: 'agentMessage',
            status: 'completed',
            text: 'CODEX_NATIVE_TRANSCRIPT_VISIBLE',
          },
        ],
      },
    ],
  };
  const binding = {
    bindingId: 'binding-1',
    runtimeId: 'runtime-1',
    nativeThreadId: 'native-thread-1',
    sessionId: 'codex-session',
    agentId: 'external-agent-1',
    purpose: 'crew_agent',
    status: 'active',
    cwd: '/home/dev/rusty-view',
    taskRef: null,
    effectiveConfigFingerprint: 'config',
    messageDeliveryPolicy: 'immediate_steer',
    profileId: 'software-engineer',
    profilePromptHash: null,
    profileRevision: null,
    revision: 1,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };

  await page.route('http://crew.test/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const ok = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data,
          meta: { request_id: 'unified-nav', schema_version: 1 },
        }),
      });

    if (pathname === '/v1/chat/sessions') {
      return ok({
        items: [directSession, codexSession],
        total: 2,
        limit: 100,
        offset: 0,
      });
    }
    if (pathname === '/v1/coordination/agents') {
      return ok({
        deploymentRole: 'production',
        agents: [
          {
            agentId: 'software-engineer',
            displayLabel: 'software-engineer',
            profileId: 'software-engineer',
            routable: true,
            runtimeKind: 'direct_brain',
            sessionId: 'direct-session',
            sessionKind: 'full',
            sessionStatus: 'idle',
            workdir: '/home/dev/direct-project',
          },
          {
            agentId: 'external-agent-1',
            bindingId: 'binding-1',
            bindingStatus: 'active',
            displayLabel: 'software-engineer',
            profileId: 'software-engineer',
            routable: true,
            runtimeId: 'runtime-1',
            runtimeKind: 'codex_app_server',
            sessionId: 'codex-session',
            sessionKind: 'full',
            sessionStatus: 'idle',
            workdir: '/home/dev/rusty-view',
          },
        ],
      });
    }
    if (pathname === '/v1/chat/commands') {
      return ok({ commands: [] });
    }
    if (pathname === '/v1/chat/sessions/direct-session') {
      return ok({
        session: directSession,
        events: [],
        latest_cursor: '',
        has_more_before: false,
      });
    }
    if (pathname.startsWith('/v1/chat/sessions/direct-session/stream')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
    }
    if (pathname === '/v1/admin/profiles/registry') {
      return ok({
        items: [
          {
            profileId: 'software-engineer',
            displayName: 'Software Engineer',
            lifecycleStatus: 'active',
            defaultSessionKind: 'full',
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
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
            executableSha256: 'exe',
            protocolSchemaSha256: 'schema',
            expectedCliVersion: '0.144.1',
            revision: 1,
            createdAt: '2026-07-28T00:00:00Z',
            updatedAt: '2026-07-28T00:00:00Z',
          },
        ],
        controllers: [
          {
            runtimeId: 'runtime-1',
            driverState: 'ready',
            controllerInstanceId: 'controller-1',
            controllerGeneration: 1,
            leaseExpiresAt: '2026-07-28T01:00:00Z',
            bindingResumeFailures: [],
          },
        ],
      });
    }
    if (pathname === '/v1/external-bindings') {
      return ok({ bindings: [binding] });
    }
    if (pathname === '/v1/external-interactions') {
      return ok({ interactions: [] });
    }
    if (pathname.endsWith('/threads/read')) {
      return ok({ thread: nativeThread });
    }
    if (pathname.endsWith('/threads')) {
      return ok({
        items: [nativeThread],
        nextCursor: null,
        backwardsCursor: null,
      });
    }
    if (pathname.endsWith('/events')) {
      return ok({ events: [] });
    }
    if (pathname.endsWith('/stream')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
    }
    if (pathname === '/v1/external-bindings/binding-1/commands') {
      return ok({
        contractVersion: '0.7.0',
        runtimeId: 'runtime-1',
        bindingId: 'binding-1',
        commands: [],
        settings: {
          model: 'gpt-5.6-sol',
          modelProvider: 'openai',
          effort: 'medium',
        },
        models: [],
      });
    }

    return route.fulfill({ status: 404, body: 'not mocked' });
  });

  await page.goto('/?api=http://crew.test');
  const directRow = page.locator('[data-session-id="direct-session"]');
  const codexRow = page.locator('[data-session-id="codex-session"]');
  await expect(directRow).toHaveAttribute('data-runtime-kind', 'direct_brain');
  await expect(codexRow).toHaveAttribute(
    'data-runtime-kind',
    'codex_app_server',
  );

  await directRow.click();
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'profile',
  );

  await codexRow.click();
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'agent',
  );
  await expect(page.getByText('CODEX_NATIVE_TRANSCRIPT_VISIBLE')).toBeVisible();
  await expect(codexRow).toHaveClass(/rv-profile-session--selected/);

  await page.getByTestId('external-agents-tab').click();
  await expect(page.getByTestId('external-agent-create')).toBeVisible();
  await expect(page.getByTestId('external-agent-archive')).toBeVisible();
  await expect(page.getByTestId('external-agent-options')).toBeVisible();

  await page.getByTestId('crew-agents-tab').click();
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'agent',
  );
  await expect(page.getByText('CODEX_NATIVE_TRANSCRIPT_VISIBLE')).toBeVisible();

  await directRow.click();
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'profile',
  );
  await page.keyboard.press('Control+Tab');
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'agent',
  );
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'profile',
  );
});

function chatSession(overrides: Record<string, unknown>) {
  return {
    session_id: 'session',
    agent_id: 'agent',
    profile_id: 'software-engineer',
    kind: 'full',
    status: 'idle',
    latest_cursor: '',
    updated_at: '2026-07-28T00:00:00Z',
    ...overrides,
  };
}

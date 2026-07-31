import { expect, test, type Page } from '@playwright/test';

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
    status: 'active',
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
  const externalMessageRequests: unknown[] = [];
  let crewCreationRequest: unknown;
  let crewCreationKey: string | undefined;
  let crewCreated = false;
  const createdCrewSession = chatSession({
    session_id: 'crew-created-session',
    agent_id: 'software-engineer',
    updated_at: '2026-07-28T00:03:00Z',
  });
  const chatMessageRequests: Array<{
    readonly pathname: string;
    readonly body: unknown;
  }> = [];
  let sessionListReads = 0;
  let coordinationGate: Deferred<void> | undefined;

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
      if (request.method() === 'POST') {
        crewCreationRequest = request.postDataJSON();
        crewCreationKey = request.headers()['idempotency-key'];
        crewCreated = true;
        return ok({
          creation: {
            requestFingerprint: 'sha256:crew-create',
            profileRevision: 8,
            outcome: 'created',
            session: { sessionId: 'crew-created-session' },
          },
          applyResult: {},
        });
      }
      sessionListReads += 1;
      return ok({
        items: [
          ...(crewCreated ? [createdCrewSession] : []),
          directSession,
          codexSession,
        ],
        total: crewCreated ? 3 : 2,
        limit: 100,
        offset: 0,
      });
    }
    if (pathname === '/v1/coordination/agents') {
      if (coordinationGate !== undefined) await coordinationGate.promise;
      return ok({
        deploymentRole: 'production',
        agents: [
          ...(crewCreated
            ? [
                {
                  agentId: 'software-engineer',
                  displayLabel: 'software-engineer',
                  profileId: 'software-engineer',
                  routable: true,
                  runtimeKind: 'direct_brain',
                  sessionId: 'crew-created-session',
                  sessionKind: 'full',
                  sessionStatus: 'idle',
                  workdir: '/home/dev/direct-project',
                },
              ]
            : []),
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
    if (/^\/v1\/chat\/sessions\/[^/]+\/messages$/.test(pathname)) {
      chatMessageRequests.push({
        pathname,
        body: request.postDataJSON(),
      });
      if (pathname.includes('/codex-session/')) {
        return route.fulfill({ status: 409, body: 'wrong runtime route' });
      }
      return ok({
        status: 'accepted',
        message_id: 'direct-message-1',
        latest_cursor: 'direct-cursor-1',
      });
    }
    if (pathname === '/v1/chat/sessions/direct-session') {
      return ok({
        session: directSession,
        events: [],
        latest_cursor: '',
        has_more_before: false,
      });
    }
    if (pathname === '/v1/chat/sessions/crew-created-session') {
      return ok({
        session: createdCrewSession,
        events: [],
        latest_cursor: '',
        has_more_before: false,
      });
    }
    if (pathname === '/v1/chat/sessions/codex-session') {
      return ok({
        session: codexSession,
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
    if (pathname.startsWith('/v1/chat/sessions/crew-created-session/stream')) {
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
            revision: 7,
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
    if (pathname === '/v1/external-bindings/binding-1/messages') {
      externalMessageRequests.push(request.postDataJSON());
      return ok({ deliveryId: 'delivery-1', status: 'accepted' });
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
  const directOptions = directRow
    .locator('xpath=..')
    .getByTestId('profile-session-options');
  await expect(directOptions).toBeVisible();
  const [directRowBox, directOptionsBox, directStatusBox] = await Promise.all([
    directRow.boundingBox(),
    directOptions.boundingBox(),
    directRow.locator('.rv-profile-session__status').boundingBox(),
  ]);
  expect(directRowBox).not.toBeNull();
  expect(directOptionsBox).not.toBeNull();
  expect(directStatusBox).not.toBeNull();
  expect(
    Math.abs(
      (directRowBox?.x ?? 0) +
        (directRowBox?.width ?? 0) -
        ((directStatusBox?.x ?? 0) + (directStatusBox?.width ?? 0)),
    ),
  ).toBeLessThanOrEqual(12);
  expect(directOptionsBox?.width).toBeLessThan(64);
  expect(directOptionsBox?.x).toBeGreaterThan(
    (directRowBox?.x ?? 0) + (directRowBox?.width ?? 0) / 2,
  );
  expect(
    Math.abs(
      (directOptionsBox?.y ?? 0) +
        (directOptionsBox?.height ?? 0) -
        ((directRowBox?.y ?? 0) + (directRowBox?.height ?? 0)),
    ),
  ).toBeLessThanOrEqual(8);
  await directOptions.click();
  await expect(page.getByTestId('session-options-panel')).toBeVisible();
  await expect(page.getByTestId('session-options-archive')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  const readsBeforeManualRefresh = sessionListReads;
  await page.getByTestId('profile-refresh').click();
  await expect
    .poll(() => sessionListReads)
    .toBeGreaterThan(readsBeforeManualRefresh);

  await directRow.click();
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'profile',
  );
  await page.getByTestId('message-input-field').fill('DIRECT_SEND_PROOF');
  await page.getByTestId('send-message').click();
  await expect.poll(() => chatMessageRequests).toHaveLength(1);
  expect(chatMessageRequests[0]).toMatchObject({
    pathname: '/v1/chat/sessions/direct-session/messages',
    body: {
      actor: { id: 'debug-user', kind: 'human' },
      body: 'DIRECT_SEND_PROOF',
    },
  });

  await codexRow.click();
  await expect(codexRow).toHaveAttribute('data-session-status', 'active');
  await expect(codexRow.locator('.rv-profile-session__status')).toHaveText(
    'Active',
  );
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'agent',
  );
  await expect(page.getByText('CODEX_NATIVE_TRANSCRIPT_VISIBLE')).toBeVisible();
  await expect(codexRow).toHaveClass(/rv-profile-session--selected/);
  await page.getByTestId('message-input-field').fill('CODEX_SEND_PROOF');
  await page.getByTestId('send-message').click();
  await expect.poll(() => externalMessageRequests).toHaveLength(1);
  expect(externalMessageRequests[0]).toEqual({
    body: 'CODEX_SEND_PROOF',
    ttlMs: 60_000,
  });
  await expect
    .poll(() => persistedSelectedSessionId(page))
    .toBe('codex-session');

  coordinationGate = deferred<void>();
  await page.reload();
  await expect(codexRow).toBeVisible();
  await expect(codexRow).toHaveAttribute('data-runtime-kind', 'chat_session');
  await expect(page.getByTestId('message-input-field')).toBeDisabled();

  // A click in the initial classification window must wait for runtime
  // authority instead of selecting the external session through ChatStore.
  await codexRow.click();
  await page.waitForTimeout(100);
  expect(externalMessageRequests).toHaveLength(1);
  expect(chatMessageRequests).toHaveLength(1);

  coordinationGate.resolve();
  coordinationGate = undefined;
  await expect(codexRow).toHaveAttribute(
    'data-runtime-kind',
    'codex_app_server',
  );
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'agent',
  );
  await expect(page.getByTestId('message-input-field')).toBeEnabled();
  await page
    .getByTestId('message-input-field')
    .fill('CODEX_RESTORED_SEND_PROOF');
  await page.getByTestId('send-message').click();
  await expect.poll(() => externalMessageRequests).toHaveLength(2);
  expect(externalMessageRequests[1]).toEqual({
    body: 'CODEX_RESTORED_SEND_PROOF',
    ttlMs: 60_000,
  });
  expect(
    chatMessageRequests.some(({ pathname }) =>
      pathname.includes('/codex-session/'),
    ),
  ).toBe(false);

  await page.getByTestId('external-agents-tab').click();
  await expect(page.getByTestId('external-agent-create')).toBeVisible();
  await expect(page.getByTestId('external-agent-archive')).toHaveCount(0);
  await expect(page.getByTestId('external-agent-options')).toBeVisible();
  await page.getByTestId('external-agent-options').click();
  await expect(page.getByTestId('session-options-archive')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

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

  await page.getByTestId('profile-new-session').click();
  await expect(page.getByTestId('agent-create-mode-crew')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByPlaceholder('/home/dev/project')).toHaveCount(0);
  await expect(page.getByPlaceholder('Optional session name')).toHaveCount(0);
  await page.getByTestId('external-agent-create-submit').click();
  await expect
    .poll(() => crewCreationRequest)
    .toEqual({
      profile_id: 'software-engineer',
      expected_profile_revision: 7,
    });
  expect(crewCreationKey).toBeTruthy();
  await expect(
    page.locator(
      '[data-testid="profile-session-row"][data-session-id="crew-created-session"]',
    ),
  ).toHaveClass(/rv-profile-session--selected/);
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

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function persistedSelectedSessionId(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open('rusty-view-chat');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('ui_state', 'readonly');
          const request = transaction.objectStore('ui_state').get('default');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const state = request.result as
              | { selectedSessionId?: string }
              | undefined;
            resolve(state?.selectedSessionId ?? null);
            database.close();
          };
        };
      }),
  );
}

import { expect, test } from '@playwright/test';

test('external agent fleet, transcript activity, interactions, and controls are visible', async ({
  page,
}, testInfo) => {
  let interactionResolution: unknown;
  let rejectMessages = false;
  let creationRequest: Record<string, unknown> | undefined;
  let messageBindingId: string | undefined;
  let commandRequest: Record<string, unknown> | undefined;
  let listedBindings = [binding];
  let listedThreads = [thread];
  let listedEvents = [...events];
  await page.route('http://crew.test/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ok = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data,
          meta: { request_id: 'req', schema_version: 1 },
        }),
      });
    if (url.pathname === '/v1/admin/profiles/registry')
      return ok({
        items: [
          {
            profileId: 'tester',
            displayName: 'Tester',
            lifecycleStatus: 'active',
            defaultSessionKind: 'full',
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      });
    if (url.pathname === '/v1/external-agent-sessions') {
      creationRequest = request.postDataJSON() as Record<string, unknown>;
      const createdBinding = {
        ...binding,
        bindingId: 'binding-created',
        nativeThreadId: 'thread-created',
        sessionId: 'session-created',
        agentId: 'agent-created',
        taskRef: { project_id: 'rusty-crew', task_id: '5675' },
      };
      const createdThread = {
        ...thread,
        threadId: 'thread-created',
        sessionId: 'session-created',
        preview: 'New browser-created Codex session',
        name: 'View external session',
        turns: [],
      };
      listedBindings = [...listedBindings, createdBinding];
      listedThreads = [...listedThreads, createdThread];
      return ok({
        creation: {
          creationId: 'creation-1',
          request: {
            ...creationRequest,
            requestedAt: '2026-07-12T00:00:00Z',
          },
          requestFingerprint: 'creation-fingerprint',
          session: {
            sessionId: 'session-created',
            agentId: 'agent-created',
            profileId: 'tester',
            status: 'idle',
          },
          binding: createdBinding,
          nativeThreadSource: 'rusty-crew:create-1',
          nativeThreadId: 'thread-created',
          phase: 'ready',
          revision: 4,
          createdAt: '2026-07-12T00:00:00Z',
          updatedAt: '2026-07-12T00:00:01Z',
        },
        runtime,
        thread: createdThread,
      });
    }
    if (url.pathname === '/v1/external-runtimes')
      return ok({ runtimes: [runtime], controllers: [controller] });
    if (url.pathname === '/v1/external-bindings')
      return ok({ bindings: listedBindings });
    if (url.pathname === '/v1/external-interactions')
      return ok({ interactions: [interaction] });
    if (url.pathname.endsWith('/threads/read')) {
      const body = request.postDataJSON() as { threadId?: string };
      return ok({
        thread:
          listedThreads.find((item) => item.threadId === body.threadId) ??
          thread,
      });
    }
    if (url.pathname.endsWith('/threads'))
      return ok({
        items: listedThreads,
        nextCursor: null,
        backwardsCursor: null,
      });
    if (url.pathname.endsWith('/events')) return ok({ events: listedEvents });
    if (url.pathname.endsWith('/stream'))
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
    if (url.pathname.endsWith('/raw-details/detail-diff'))
      return ok({
        detailId: 'detail-diff',
        runtimeId: 'runtime-1',
        json: JSON.stringify({
          method: 'turn/diff/updated',
          params: { diff: 'diff --git a/src/app.ts b/src/app.ts' },
        }),
        originalSha256: 'diff-sha',
        truncated: false,
        redactedKeys: [],
      });
    if (url.pathname.includes('/raw-details/'))
      return ok({
        detailId: 'detail-4',
        runtimeId: 'runtime-1',
        json: '{"future":true}',
        originalSha256: 'sha',
        truncated: false,
        redactedKeys: [],
      });
    if (url.pathname.endsWith('/controls'))
      return ok({
        request: {
          bindingId: 'binding-1',
          controlId: 'control-1',
          expectedBindingRevision: 1,
          idempotencyKey: 'key',
          kind: 'interrupt_turn',
          payload: {},
          requestedAt: '2026-07-11T00:00:00Z',
        },
        requestFingerprint: 'fingerprint',
        revision: 1,
        status: 'applied',
        updatedAt: '2026-07-11T00:00:01Z',
      });
    if (
      /\/v1\/external-bindings\/[^/]+\/commands$/.test(url.pathname) &&
      request.method() === 'GET'
    ) {
      const bindingId = url.pathname.split('/')[3] ?? 'binding-1';
      return ok(commandCatalog(bindingId));
    }
    if (
      /\/v1\/external-bindings\/[^/]+\/commands$/.test(url.pathname) &&
      request.method() === 'POST'
    ) {
      commandRequest = request.postDataJSON() as Record<string, unknown>;
      const input = String(commandRequest['input']);
      const command = input.slice(1).split(/\s+/, 1)[0] ?? 'unknown';
      const message =
        command === 'compact'
          ? 'Native Codex compaction started.'
          : 'Runtime ready\nModel: gpt-5.6';
      const commandId = `command-${command}-1`;
      listedEvents = [
        ...listedEvents,
        {
          ...externalEvent('100', 'command_started', {
            nativeMethod: 'rustyCrew/externalCommand',
            status: 'pending',
            command,
            argument: null,
          }),
          eventId: `${commandId}:started`,
          requestId: commandId,
          nativeTurnId: null,
        },
        {
          ...externalEvent('101', 'command_completed', {
            nativeMethod: 'rustyCrew/externalCommand',
            status: 'applied',
            command,
            argument: null,
            message,
          }),
          eventId: `${commandId}:completed`,
          requestId: commandId,
          nativeTurnId: null,
        },
        ...(command === 'compact'
          ? [
              externalEvent('102', 'compaction', {
                nativeMethod: 'thread/compacted',
                message: 'Native Codex compaction completed.',
              }),
            ]
          : []),
      ];
      return ok({
        commandId,
        input: commandRequest['input'],
        command,
        argument: null,
        status: 'applied',
        reasonCode: null,
        message,
        result: {
          status: {
            settings: commandCatalog('binding-1').settings,
          },
        },
        receipt: {},
      });
    }
    if (url.pathname.endsWith('/resolve')) {
      interactionResolution = request.postDataJSON();
      return ok({
        ...interaction,
        status: 'resolved',
        resolvedAt: '2026-07-11T00:00:02Z',
        revision: 2,
      });
    }
    if (url.pathname.endsWith('/messages') && rejectMessages) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: { code: 'unavailable', message: 'delivery offline' },
        }),
      });
    }
    if (url.pathname.endsWith('/messages')) {
      messageBindingId = url.pathname.split('/')[3];
      return ok({ deliveryId: 'delivery-1', status: 'accepted' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { message: 'not mocked' } }),
    });
  });

  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  await page.getByTestId('external-agent-create').click();
  await page.getByPlaceholder('/home/dev/project').fill('/home/dev/rusty-view');
  await page
    .getByPlaceholder('Optional session name')
    .fill('View external session');
  await page.getByLabel('Den project').fill('rusty-crew');
  await page.getByLabel('Task').fill('5675');
  await page.screenshot({
    path: testInfo.outputPath('external-agent-create-form.png'),
    fullPage: true,
  });
  await page.getByTestId('external-agent-create-submit').click();
  await expect(
    page.getByTestId('external-agent-row').filter({ hasText: '#5675' }),
  ).toBeVisible();
  expect(creationRequest).toMatchObject({
    runtimeId: 'runtime-1',
    profileId: 'tester',
    cwd: '/home/dev/rusty-view',
    label: 'View external session',
    taskRef: { project_id: 'rusty-crew', task_id: '5675' },
  });
  await page.screenshot({
    path: testInfo.outputPath('external-agent-created.png'),
    fullPage: true,
  });
  await page
    .getByTestId('message-input-field')
    .fill('Hello from the created session');
  await page.getByTestId('send-message').click();
  await expect.poll(() => messageBindingId).toBe('binding-created');

  const row = page
    .getByTestId('external-agent-row')
    .filter({ hasText: '#5516' });
  await expect(row).toContainText('#5516');
  await expect(row).toContainText('/home/dev/rusty-view');
  await row.click();

  await expect(page.getByTestId('external-turn-status')).toContainText(
    'active',
  );
  await expect(page.getByTestId('external-current-model')).toHaveText(
    'gpt-5.6',
  );
  await expect(page.getByTestId('external-current-effort')).toHaveText(
    'medium',
  );
  await page.getByTestId('message-input-field').fill('/');
  await expect(
    page.getByTestId('message-command-hint').filter({ hasText: 'model' }),
  ).toBeVisible();
  await page.getByTestId('message-input-field').fill('/model ');
  await expect(
    page.getByTestId('message-command-hint').filter({ hasText: 'gpt-5.6' }),
  ).toBeVisible();
  messageBindingId = undefined;
  await page.getByTestId('message-input-field').fill('/status');
  await page.getByTestId('send-message').click();
  await expect.poll(() => commandRequest).toMatchObject({ input: '/status' });
  expect(messageBindingId).toBeUndefined();
  await expect(page.getByTestId('external-interaction-card')).toBeVisible();
  await page.getByRole('button', { name: 'Blue' }).click();
  await page.getByTestId('external-interaction-submit').click();
  await expect
    .poll(() => interactionResolution)
    .toMatchObject({
      expectedRevision: 1,
      result: { answers: { color: { answers: ['Blue'] } } },
    });
  await expect(page.locator('[data-block-kind="plan"]')).toBeVisible();
  await expect(
    page
      .locator('[data-block-kind="command"]')
      .filter({ hasText: 'pnpm test' }),
  ).toBeVisible();
  await expect(
    page.locator('[data-block-kind="file_change"]').filter({
      hasText: 'File changes',
    }),
  ).toBeVisible();
  const aggregateDiff = page
    .getByTestId('tool-call-block')
    .filter({ hasText: 'Aggregate diff' });
  await aggregateDiff.getByTestId('message-block-detail-toggle').click();
  await expect(
    aggregateDiff.getByTestId('message-block-detail-content'),
  ).toContainText('diff --git a/src/app.ts b/src/app.ts');
  await page
    .getByTestId('event-row')
    .filter({ hasText: 'unknown_native_notification' })
    .click();
  await page.getByTestId('external-raw-detail').click();
  await expect(page.getByTestId('external-raw-detail-view')).toContainText(
    'future',
  );
  commandRequest = undefined;
  await page.getByTestId('message-input-field').fill('/compact');
  await page.getByTestId('send-message').click();
  await expect.poll(() => commandRequest).toMatchObject({ input: '/compact' });
  await expect(page.getByTestId('transcript-shell')).toContainText(
    'Native Codex compaction completed.',
  );
  expect(messageBindingId).toBeUndefined();
  await expect(page.getByTestId('external-interrupt')).toBeEnabled();
  rejectMessages = true;
  await page.getByLabel('External message mode').selectOption('queue');
  await page.getByTestId('message-input-field').fill('Rejected message proof');
  await page.getByTestId('send-message').click();
  await expect(page.getByRole('alert')).toContainText(
    'Send failed: delivery offline',
  );
  await page.screenshot({
    path: testInfo.outputPath('external-agent-console.png'),
    fullPage: true,
  });
});

test('external agent creation explains a missing ready runtime', async ({
  page,
}) => {
  await page.route('http://crew.test/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data =
      pathname === '/v1/admin/profiles/registry'
        ? { items: [], total: 0, limit: 100, offset: 0 }
        : pathname === '/v1/external-runtimes'
          ? { runtimes: [], controllers: [] }
          : pathname === '/v1/external-bindings'
            ? { bindings: [] }
            : pathname === '/v1/external-interactions'
              ? { interactions: [] }
              : undefined;
    await route.fulfill({
      status: data === undefined ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        data === undefined
          ? { ok: false, error: { message: 'not mocked' } }
          : {
              ok: true,
              data,
              meta: { request_id: 'req', schema_version: 1 },
            },
      ),
    });
  });

  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();

  await expect(page.getByTestId('external-agent-no-runtime')).toBeVisible();
  await expect(page.getByTestId('external-agent-create')).toBeDisabled();
});

const runtime = {
  runtimeId: 'runtime-1',
  kind: 'codex_app_server',
  desiredState: 'enabled',
  observedState: 'ready',
  processOwnership: 'attached',
  endpoint: { transport: 'unix_web_socket', address: '/run/codex.sock' },
  executableSha256: 'exe',
  protocolSchemaSha256: 'schema',
  expectedCliVersion: '0.144.1',
  revision: 1,
  createdAt: '2026-07-11T00:00:00Z',
  updatedAt: '2026-07-11T00:00:00Z',
};
const controller = {
  runtimeId: 'runtime-1',
  driverState: 'ready',
  controllerInstanceId: 'crew-1',
  controllerGeneration: 1,
  leaseExpiresAt: '2026-07-11T00:10:00Z',
  bindingResumeFailures: [],
};

function commandCatalog(bindingId: string) {
  return {
    contractVersion: '0.7.0',
    runtimeId: 'runtime-1',
    bindingId,
    nativeThreadId: 'thread-1',
    commands: [
      {
        name: 'help',
        aliases: ['commands'],
        usage: '/help',
        description: 'List commands',
        mutates: false,
        requiredCapabilities: [],
        available: true,
        unavailableReasonCode: null,
      },
      {
        name: 'status',
        aliases: [],
        usage: '/status',
        description: 'Show status',
        mutates: false,
        requiredCapabilities: [],
        available: true,
        unavailableReasonCode: null,
      },
      {
        name: 'model',
        aliases: [],
        usage: '/model [id]',
        description: 'Select model',
        mutates: true,
        requiredCapabilities: ['model/list'],
        available: true,
        unavailableReasonCode: null,
      },
      {
        name: 'effort',
        aliases: [],
        usage: '/effort [value]',
        description: 'Select effort',
        mutates: true,
        requiredCapabilities: ['model/list'],
        available: true,
        unavailableReasonCode: null,
      },
      {
        name: 'compact',
        aliases: [],
        usage: '/compact',
        description: 'Compact context',
        mutates: true,
        requiredCapabilities: ['thread/compact/start'],
        available: true,
        unavailableReasonCode: null,
      },
    ],
    settings: {
      model: 'gpt-5.6',
      modelProvider: 'openai',
      effort: 'medium',
    },
    models: [
      {
        id: 'gpt-5.6',
        model: 'gpt-5.6',
        displayName: 'GPT 5.6',
        description: 'Frontier model',
        hidden: false,
        isDefault: true,
        defaultEffort: 'medium',
        supportedEfforts: [
          { value: 'medium', description: 'Balanced' },
          { value: 'high', description: 'Thorough' },
        ],
      },
    ],
  };
}
const binding = {
  bindingId: 'binding-1',
  runtimeId: 'runtime-1',
  nativeThreadId: 'thread-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  purpose: 'crew_agent',
  status: 'active',
  cwd: '/home/dev/rusty-view',
  taskRef: { project_id: 'rusty-view', task_id: '5516' },
  effectiveConfigFingerprint: 'config',
  revision: 1,
  createdAt: '2026-07-11T00:00:00Z',
  updatedAt: '2026-07-11T00:00:00Z',
};
const thread = {
  threadId: 'thread-1',
  sessionId: 'session-1',
  parentThreadId: null,
  preview: 'Implement external agent console',
  ephemeral: false,
  modelProvider: 'openai',
  createdAt: 1783756800,
  updatedAt: 1783756810,
  status: 'active',
  cwd: '/home/dev/rusty-view',
  cliVersion: '0.144.1',
  name: 'Rusty View task 5516',
  agentNickname: null,
  agentRole: null,
  turns: [],
};
const interaction = {
  interactionId: 'interaction-1',
  runtimeId: 'runtime-1',
  bindingId: 'binding-1',
  requestId: 'request-1',
  nativeThreadId: 'thread-1',
  nativeTurnId: 'turn-1',
  nativeRequestId: 'native-1',
  kind: 'request_user_input',
  prompt: {
    questions: [
      {
        id: 'color',
        header: 'Color',
        question: 'Choose a color',
        isOther: false,
        isSecret: false,
        options: [
          { label: 'Blue', description: 'Use the blue path.' },
          { label: 'Green', description: 'Use the green path.' },
        ],
      },
    ],
  },
  allowedResponses: ['answers'],
  status: 'pending',
  requestedAt: '2026-07-11T00:00:00Z',
  expiresAt: '2026-07-11T00:10:00Z',
  revision: 1,
};
const events = [
  externalEvent('1', 'turn_lifecycle', {
    nativeMethod: 'turn/started',
    status: 'active',
  }),
  externalEvent('2', 'plan_delta', {
    nativeMethod: 'turn/plan/updated',
    text: 'Inspect, implement, verify',
  }),
  externalEvent('3', 'command_activity', {
    nativeMethod: 'item/commandExecution/completed',
    command: 'pnpm test',
    output: '42 passed',
    status: 'completed',
  }),
  externalEvent('4', 'file_activity', {
    nativeMethod: 'item/fileChange/completed',
    status: 'completed',
    fileChanges: [{ path: 'src/app.ts', kind: 'update' }],
  }),
  {
    ...externalEvent('5', 'unknown_native_notification', {
      nativeMethod: 'future/event',
    }),
    rawDetailRef: 'detail-4',
  },
  {
    ...externalEvent('6', 'turn_lifecycle', {
      nativeMethod: 'turn/diff/updated',
    }),
    rawDetailRef: 'detail-diff',
  },
];
function externalEvent(
  eventId: string,
  kind: string,
  payload: Record<string, unknown>,
) {
  return {
    eventId,
    runtimeId: 'runtime-1',
    sequenceId: Number(eventId),
    createdAt: '2026-07-11T00:00:00Z',
    kind,
    sessionId: 'session-1',
    nativeThreadId: 'thread-1',
    nativeTurnId: 'turn-1',
    payload,
  };
}

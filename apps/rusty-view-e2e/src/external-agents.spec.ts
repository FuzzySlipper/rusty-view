import { expect, test } from '@playwright/test';

test('external agent fleet, transcript activity, interactions, and controls are visible', async ({
  page,
}, testInfo) => {
  let interactionResolution: unknown;
  let rejectMessages = false;
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
    if (url.pathname === '/v1/external-runtimes')
      return ok({ runtimes: [runtime], controllers: [controller] });
    if (url.pathname === '/v1/external-bindings')
      return ok({ bindings: [binding] });
    if (url.pathname === '/v1/external-interactions')
      return ok({ interactions: [interaction] });
    if (url.pathname.endsWith('/threads/read')) return ok({ thread });
    if (url.pathname.endsWith('/threads'))
      return ok({ items: [thread], nextCursor: null, backwardsCursor: null });
    if (url.pathname.endsWith('/events')) return ok({ events });
    if (url.pathname.endsWith('/stream'))
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
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
    if (url.pathname.endsWith('/messages'))
      return ok({ deliveryId: 'delivery-1', status: 'accepted' });
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { message: 'not mocked' } }),
    });
  });

  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  const row = page.getByTestId('external-agent-row');
  await expect(row).toContainText('#5516');
  await expect(row).toContainText('/home/dev/rusty-view');
  await row.click();

  await expect(page.getByTestId('external-turn-status')).toContainText(
    'active',
  );
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
  await expect(page.locator('[data-block-kind="command"]')).toBeVisible();
  await expect(page.locator('[data-block-kind="file_change"]')).toBeVisible();
  await page
    .getByTestId('event-row')
    .filter({ hasText: 'unknown_native_notification' })
    .click();
  await page.getByTestId('external-raw-detail').click();
  await expect(page.getByTestId('external-raw-detail-view')).toContainText(
    'future',
  );
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
};
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

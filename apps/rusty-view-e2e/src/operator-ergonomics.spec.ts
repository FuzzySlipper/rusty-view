import { expect, test, type Page } from '@playwright/test';

test('persists composer sizing and configurable hotkeys in a real browser', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();

  await page.getByTestId('appearance-composer-height').fill('160');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--rv-composer-height')
          .trim(),
      ),
    )
    .toBe('160px');

  await page.locator('.rv-tab-strip__tab', { hasText: 'Hotkeys' }).click();
  const nextRow = page.locator('[data-hotkey-action="nextSession"]');
  await nextRow.getByTestId('hotkey-record').click();
  await page.keyboard.press('Alt+n');
  await expect(nextRow.getByTestId('hotkey-binding')).toHaveText('Alt+N');

  await page.locator('.rv-options__close').click();
  await page.reload();
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.locator('.rv-tab-strip__tab', { hasText: 'Hotkeys' }).click();
  await expect(
    page
      .locator('[data-hotkey-action="nextSession"]')
      .getByTestId('hotkey-binding'),
  ).toHaveText('Alt+N');
  await page.getByTestId('hotkeys-reset-all').click();
});

test('requested shortcuts cycle non-archived sessions and erase a composer word', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  const agentRows = page.getByTestId('external-agent-row');
  await expect(agentRows).toHaveCount(3);

  await agentRows.first().click();
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('[data-thread-id="thread-2"]')).toHaveClass(
    /rv-agent--selected/,
  );
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('[data-thread-id="thread-1"]')).toHaveClass(
    /rv-agent--selected/,
  );
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.locator('[data-thread-id="thread-2"]')).toHaveClass(
    /rv-agent--selected/,
  );
  await expect(
    page.locator('[data-thread-id="thread-archived"]'),
  ).not.toHaveClass(/rv-agent--selected/);
  await expect(
    page.locator('[data-thread-id="thread-native-hidden"]'),
  ).toHaveCount(0);

  const composer = page.getByTestId('message-input-field');
  await composer.fill('hello brave world');
  await composer.press('Control+w');
  await expect(composer).toHaveValue('hello brave ');
});

test('scroll-to-latest control recovers an overflowing transcript', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const transcript = page.getByTestId('transcript-viewport');
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 80,
      ),
    )
    .toBe(true);

  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  const latest = page.getByTestId('transcript-scroll-to-bottom');
  await expect(latest).toBeVisible();
  await latest.evaluate((button: HTMLButtonElement) => button.click());
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
  await page.waitForTimeout(200);

  const originalHeight = await transcript.evaluate((element) => {
    const height = element.getBoundingClientRect().height;
    element.style.height = `${Math.max(80, height - 160)}px`;
    return height;
  });
  await expect
    .poll(async () => {
      const bottomOffset = await transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      );
      return bottomOffset <= 80 || (await latest.isVisible());
    })
    .toBe(true);

  await transcript.evaluate((element, height) => {
    element.style.height = `${height}px`;
  }, originalHeight);
  await expect
    .poll(async () => {
      const bottomOffset = await transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      );
      return bottomOffset <= 80 || (await latest.isVisible());
    })
    .toBe(true);
});

async function installExternalSessionFixture(page: Page): Promise<void> {
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
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
  };
  const baseThread = {
    sessionId: 'session-1',
    parentThreadId: null,
    preview: 'Session',
    ephemeral: false,
    modelProvider: 'openai',
    createdAt: 1,
    updatedAt: 2,
    status: 'idle',
    cwd: '/home/dev/rusty-view',
    cliVersion: '0.144.1',
    name: null,
    agentNickname: null,
    agentRole: null,
    turns: [],
  };
  const longItems = Array.from({ length: 120 }, (_, index) => ({
    itemId: `item-${index}`,
    kind: 'agentMessage',
    text: `Transcript row ${index}: ${'content '.repeat(12)}`,
  }));
  const threads = [
    {
      ...baseThread,
      threadId: 'thread-1',
      preview: 'First active session',
      turns: [
        {
          turnId: 'turn-1',
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          items: longItems,
        },
      ],
    },
    { ...baseThread, threadId: 'thread-2', preview: 'Second active session' },
    {
      ...baseThread,
      threadId: 'thread-archived',
      preview: 'Archived session',
      status: 'archived',
    },
    {
      ...baseThread,
      threadId: 'thread-native-hidden',
      preview: 'Native history outside the managed inventory',
    },
  ];
  const bindings = threads
    .filter((thread) => thread.threadId !== 'thread-native-hidden')
    .map((thread, index) => ({
      bindingId: `binding-${index}`,
      runtimeId: 'runtime-1',
      nativeThreadId: thread.threadId,
      sessionId: `session-${index}`,
      agentId: `agent-${index}`,
      purpose: 'crew_agent',
      status: 'active',
      cwd: '/home/dev/rusty-view',
      taskRef: { project_id: 'rusty-view', task_id: '5703' },
      effectiveConfigFingerprint: 'config',
      revision: 1,
      createdAt: '2026-07-12T00:00:00Z',
      updatedAt: '2026-07-12T00:00:00Z',
    }));

  await page.route('http://crew.test/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let data: unknown;
    if (pathname === '/v1/admin/profiles/registry') {
      data = { items: [], total: 0, limit: 100, offset: 0 };
    } else if (pathname === '/v1/external-runtimes') {
      data = {
        runtimes: [runtime],
        controllers: [
          {
            runtimeId: 'runtime-1',
            driverState: 'ready',
            controllerInstanceId: 'controller-1',
            controllerGeneration: 1,
            leaseExpiresAt: '2026-07-12T01:00:00Z',
            bindingResumeFailures: [],
          },
        ],
      };
    } else if (pathname === '/v1/external-bindings') {
      data = { bindings };
    } else if (pathname === '/v1/external-interactions') {
      data = { interactions: [] };
    } else if (pathname.endsWith('/threads/read')) {
      const body = request.postDataJSON() as { threadId?: string };
      data = {
        thread: threads.find((thread) => thread.threadId === body.threadId),
      };
    } else if (pathname.endsWith('/threads')) {
      data = { items: threads, nextCursor: null, backwardsCursor: null };
    } else if (pathname.endsWith('/events')) {
      data = { events: [] };
    } else if (pathname.endsWith('/stream')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
      return;
    } else {
      await route.fulfill({ status: 404, body: 'not mocked' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data,
        meta: { request_id: 'req', schema_version: 1 },
      }),
    });
  });
}

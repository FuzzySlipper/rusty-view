import { expect, test, type Locator, type Page } from '@playwright/test';

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

  await page.getByTestId('appearance-message-actions').uncheck();
  await page.getByTestId('appearance-session-status-bar').uncheck();

  await page.locator('.rv-tab-strip__tab', { hasText: 'Hotkeys' }).click();
  const nextRow = page.locator('[data-hotkey-action="nextSession"]');
  await nextRow.getByTestId('hotkey-record').click();
  await page.keyboard.press('Alt+n');
  await expect(nextRow.getByTestId('hotkey-binding')).toHaveText('Alt+N');

  await page.locator('.rv-options__close').click();
  await page.getByTestId('profiles-toggle').click();
  await page.getByTestId('inspector-toggle').click();
  await expect
    .poll(() => readAppearanceSetting(page, 'showInspector'))
    .toBe(false);
  await page.reload();
  await expect(page.getByTestId('profiles-toggle')).toHaveText('Show Profiles');
  await expect(page.getByTestId('inspector-toggle')).toHaveText(
    'Show Inspector',
  );
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await expect(
    page.getByTestId('appearance-message-actions'),
  ).not.toBeChecked();
  await expect(
    page.getByTestId('appearance-session-status-bar'),
  ).not.toBeChecked();
  await page.locator('.rv-tab-strip__tab', { hasText: 'Hotkeys' }).click();
  await expect(
    page
      .locator('[data-hotkey-action="nextSession"]')
      .getByTestId('hotkey-binding'),
  ).toHaveText('Alt+N');
  await page.getByTestId('hotkeys-reset-all').click();
});

async function readAppearanceSetting(
  page: Page,
  key: 'showInspector' | 'autoExpandReasoning',
): Promise<unknown> {
  return page.evaluate(
    (settingKey) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('rusty-view-chat', 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('settings', 'readonly');
          const get = transaction.objectStore('settings').get('appearance');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            const settings = get.result as Record<string, unknown> | undefined;
            resolve(settings?.[settingKey]);
            db.close();
          };
        };
      }),
    key,
  );
}

test('requested shortcuts cycle non-archived sessions and erase a composer word', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  const agentRows = page.getByTestId('external-agent-row');
  await expect(agentRows).toHaveCount(3);

  await agentRows.first().click();
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'agent',
  );
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-activity',
    'idle',
  );
  await expect(page.getByTestId('external-current-model')).toHaveText(
    'gpt-5.6-sol',
  );
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('[data-thread-id="thread-2"]')).toHaveClass(
    /rv-agent--selected/,
  );
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-activity',
    'working',
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
      transcript.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          overflowAnchor: style.overflowAnchor,
          scrollBehavior: style.scrollBehavior,
        };
      }),
    )
    .toEqual({ overflowAnchor: 'none', scrollBehavior: 'auto' });
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
  await transcript.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: bounds.right - 1,
        clientY: bounds.top + 20,
      }),
    );
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  const heldScrollTop = await transcript.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        setTimeout(() => resolve(element.scrollTop), 750);
      }),
  );
  expect(heldScrollTop).toBeLessThanOrEqual(1);
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

test('rapid streamed tail growth does not apply reverse scroll corrections', async ({
  page,
}) => {
  const fixture = await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByLabel('Reduced Motion').check();
  await page.locator('.rv-options__close').click();
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const transcript = page.getByTestId('transcript-viewport');
  const latest = page.getByTestId('transcript-scroll-to-bottom');
  await latest.evaluateAll((buttons: HTMLButtonElement[]) =>
    buttons.at(0)?.click(),
  );
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);

  fixture.startGrowingTail();
  await transcript.evaluate((element) => {
    const samples: number[] = [];
    (window as typeof window & { __rvTailScrollSamples?: number[] })[
      '__rvTailScrollSamples'
    ] = samples;
    element.addEventListener('scroll', () => samples.push(element.scrollTop));
  });

  for (let index = 0; index < 12; index += 1) {
    fixture.growTail(
      `\nStreaming line ${index}: ${'variable-height content '.repeat(10)}`,
    );
    await page.getByTestId('external-agent-refresh').click();
    await expect(page.getByTestId('transcript-shell')).toContainText(
      `Streaming line ${index}`,
    );
  }

  await transcript.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 400)),
  );
  const samples = await page.evaluate(
    () =>
      (window as typeof window & { __rvTailScrollSamples?: number[] })
        .__rvTailScrollSamples ?? [],
  );
  expect(samples.length).toBeGreaterThan(0);
  const largestReverseCorrection = samples.reduce((largest, value, index) => {
    const previous = samples[index - 1];
    return previous === undefined
      ? largest
      : Math.max(largest, previous - value);
  }, 0);
  expect(largestReverseCorrection).toBeLessThanOrEqual(2);
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
});

test('session cycling does not leave blank space after the transcript tail', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByTestId('appearance-auto-expand-reasoning').check();
  await page.locator('.rv-options__close').click();
  await page.getByTestId('external-agents-tab').click();
  await page.getByTestId('external-agent-mode-all').click();

  const transcript = page.getByTestId('transcript-viewport');
  const tailIds = new Map([
    ['thread-1', 'external:thread-1:turn-1:reasoning-visible'],
    [
      'thread-native-hidden',
      'external:thread-native-hidden:turn-native:second-tail',
    ],
  ]);
  for (let cycle = 0; cycle < 6; cycle += 1) {
    for (const threadId of ['thread-1', 'thread-native-hidden']) {
      await page.locator(`[data-thread-id="${threadId}"]`).click();
      await expect(
        transcript.locator('.rv-transcript__item').last(),
      ).toHaveAttribute('data-message-id', tailIds.get(threadId) ?? '');
      const geometry = await transcriptGeometryAfter(transcript, 700);
      expect(
        {
          tailAligned: geometry.tailGap <= 2,
          atBottom: geometry.bottomOffset <= 80,
          wrapperEndCoherent: Math.abs(geometry.renderedEndMismatch) <= 2,
          viewportCovered: geometry.viewportCoverageGap <= 2,
        },
        JSON.stringify(geometry),
      ).toEqual({
        tailAligned: true,
        atBottom: true,
        wrapperEndCoherent: true,
        viewportCovered: true,
      });
    }
  }
});

test('auto-expand reasoning is live, manually collapsible, and persisted', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const reasoningToggle = page.getByTestId('reasoning-toggle').last();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false');

  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByTestId('appearance-auto-expand-reasoning').check();
  await page.locator('.rv-options__close').click();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('reasoning-content').last()).toContainText(
    'Inspect the final state',
  );

  const transcript = page.getByTestId('transcript-viewport');
  const latest = page.getByTestId('transcript-scroll-to-bottom');
  await latest.evaluateAll((buttons: HTMLButtonElement[]) =>
    buttons.at(0)?.click(),
  );
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
  expect(await transcriptTailGapAfter(transcript, 700)).toBeLessThanOrEqual(2);

  await reasoningToggle.click();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await transcriptTailGapAfter(transcript, 300)).toBeLessThanOrEqual(2);
  await expect
    .poll(() => readAppearanceSetting(page, 'autoExpandReasoning'))
    .toBe(true);

  await page.reload();
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();
  await expect(page.getByTestId('reasoning-toggle').last()).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

interface ExternalSessionFixtureController {
  startGrowingTail(): void;
  growTail(text: string): void;
}

async function installExternalSessionFixture(
  page: Page,
): Promise<ExternalSessionFixtureController> {
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
    effectiveModel: 'gpt-5.6-sol',
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
  longItems.push({
    itemId: 'reasoning-visible',
    kind: 'reasoning',
    text: [
      'Inspect the final state before answering.',
      ...Array.from(
        { length: 180 },
        (_, index) =>
          `Expanded reasoning line ${index}: ${'variable-height analysis '.repeat(
            index % 7 === 0 ? 12 : 2,
          )}`,
      ),
    ].join('\n'),
  });
  const secondItems = Array.from({ length: 55 }, (_, index) => ({
    itemId: `second-item-${index}`,
    kind: 'agentMessage',
    text: `Second transcript row ${index}: ${'variable content '.repeat(
      index % 5 === 0 ? 40 : 4,
    )}`,
  }));
  secondItems.push({
    itemId: 'second-tail',
    kind: 'agentMessage',
    text: 'Second transcript tail.',
  });
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
    {
      ...baseThread,
      threadId: 'thread-2',
      preview: 'Second active session',
      status: 'active',
    },
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
      turns: [
        {
          turnId: 'turn-native',
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          items: secondItems,
        },
      ],
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
  const growingTailEvents: Array<Record<string, unknown>> = [];
  let growingSequence = 1;

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
      data = { events: growingTailEvents };
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

  let growingTailStarted = false;
  const appendGrowingTailEvent = (text: string): void => {
    const eventId = String(growingSequence++);
    growingTailEvents.push({
      eventId,
      runtimeId: 'runtime-1',
      sequenceId: Number(eventId),
      createdAt: '2026-07-12T00:00:00Z',
      kind: 'assistant_text_delta',
      sessionId: 'session-1',
      nativeThreadId: 'thread-1',
      nativeTurnId: 'streaming-growth-turn',
      itemId: 'streaming-growth-tail',
      payload: {
        nativeMethod: 'item/agentMessage/delta',
        text,
      },
    });
  };
  return {
    startGrowingTail(): void {
      growingTailStarted = true;
      appendGrowingTailEvent('Streaming growth begins.');
    },
    growTail(text: string): void {
      if (!growingTailStarted) {
        throw new Error('startGrowingTail must be called before growTail');
      }
      appendGrowingTailEvent(text);
    },
  };
}

async function transcriptTailGapAfter(
  transcript: Locator,
  delayMs: number,
): Promise<number> {
  return transcript.evaluate(
    (viewport, delay) =>
      new Promise<number>((resolve) => {
        setTimeout(() => {
          const items = viewport.querySelectorAll<HTMLElement>(
            '.rv-transcript__item',
          );
          const lastItem = items.item(items.length - 1);
          resolve(
            lastItem === null
              ? Number.POSITIVE_INFINITY
              : viewport.getBoundingClientRect().bottom -
                  lastItem.getBoundingClientRect().bottom,
          );
        }, delay);
      }),
    delayMs,
  );
}

async function transcriptGeometryAfter(
  transcript: Locator,
  delayMs: number,
): Promise<{
  tailGap: number;
  bottomOffset: number;
  renderedEndMismatch: number;
  viewportCoverageGap: number;
}> {
  return transcript.evaluate(
    (viewport, delay) =>
      new Promise((resolve) => {
        setTimeout(() => {
          const wrapper = viewport.querySelector<HTMLElement>(
            '.cdk-virtual-scroll-content-wrapper',
          );
          const spacer = viewport.querySelector<HTMLElement>(
            '.cdk-virtual-scroll-spacer',
          );
          const items = viewport.querySelectorAll<HTMLElement>(
            '.rv-transcript__item',
          );
          const lastItem = items.item(items.length - 1);
          if (wrapper === null || spacer === null || lastItem === null) {
            resolve({
              tailGap: Number.POSITIVE_INFINITY,
              bottomOffset: Number.POSITIVE_INFINITY,
              renderedEndMismatch: Number.POSITIVE_INFINITY,
              viewportCoverageGap: Number.POSITIVE_INFINITY,
            });
            return;
          }

          const viewportBounds = viewport.getBoundingClientRect();
          const wrapperBounds = wrapper.getBoundingClientRect();
          const lastBounds = lastItem.getBoundingClientRect();
          const renderedOffset =
            viewport.scrollTop + wrapperBounds.top - viewportBounds.top;
          resolve({
            tailGap: viewportBounds.bottom - lastBounds.bottom,
            bottomOffset:
              viewport.scrollHeight -
              viewport.scrollTop -
              viewport.clientHeight,
            renderedEndMismatch:
              renderedOffset +
              wrapperBounds.height -
              spacer.getBoundingClientRect().height,
            viewportCoverageGap: Math.max(
              0,
              wrapperBounds.top - viewportBounds.top,
            ),
          });
        }, delay);
      }),
    delayMs,
  );
}

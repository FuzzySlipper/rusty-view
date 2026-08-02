import { expect, test, type Page, type Route } from '@playwright/test';

type ScrollTrace = {
  readonly sequence: number;
  readonly frame: number;
  readonly reason: string;
  readonly transcriptKey: string | null;
  readonly authority: string;
  readonly offsetBefore: number;
  readonly offsetAfter: number;
};

type ScrollTestApi = {
  setTranscriptScrollDiagnosticsEnabled(enabled: boolean): void;
  clearTranscriptScrollWriteTrace(): void;
  getTranscriptScrollWriteTrace(): readonly ScrollTrace[];
  refreshActiveSession(): Promise<void>;
  scrollToMessageId(messageId: string): void;
  scrollTranscriptToLatest(): void;
};

const SESSION_A = 'scroll-diagnostic-a';
const SESSION_B = 'scroll-diagnostic-b';

function envelope(data: unknown): string {
  return JSON.stringify({
    ok: true,
    data,
    meta: { request_id: 'req_scroll_diagnostic', schema_version: 1 },
  });
}

function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: envelope(data),
  });
}

function sseFrame(
  sessionId: string,
  sequence: number,
  kind: string,
  payload: unknown,
): string {
  const event = {
    event_id: `${sessionId}:${sequence}`,
    session_id: sessionId,
    sequence_id: sequence,
    created_at: '2026-08-02T00:02:00Z',
    kind,
    payload,
  };
  return `id: ${event.event_id}\ndata: ${JSON.stringify(event)}\n\n`;
}

function summary(sessionId: string, title: string) {
  return {
    session_id: sessionId,
    agent_id: 'scroll-diagnostic',
    profile_id: 'scroll-diagnostic',
    kind: 'full',
    status: 'idle',
    title,
    latest_cursor: `${sessionId}:99`,
    created_at: '2026-08-02T00:00:00Z',
    updated_at: '2026-08-02T00:01:00Z',
    message_count: 40,
    tool_event_count: 0,
  };
}

function messageEvent(sessionId: string, sequence: number, suffix = '') {
  return {
    event_id: `${sessionId}:${sequence}`,
    session_id: sessionId,
    sequence_id: sequence,
    created_at: `2026-08-02T00:00:${String(sequence % 60).padStart(2, '0')}Z`,
    kind: 'message_created',
    payload: {
      message_id: `${sessionId}:message:${sequence}`,
      role: sequence % 2 === 0 ? 'assistant' : 'user',
      body: `Diagnostic row ${sequence} ${suffix} `.repeat(12),
    },
  };
}

function hasApi(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return (
      (window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi })
        .__RUSTY_VIEW_TEST__ !== undefined
    );
  });
}

async function invoke(
  page: Page,
  action: 'enable' | 'clear' | 'refresh',
): Promise<void> {
  await page.evaluate(async (requested) => {
    const value = (window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi })
      .__RUSTY_VIEW_TEST__;
    if (value === undefined) throw new Error('Rusty View test API unavailable');
    if (requested === 'enable')
      value.setTranscriptScrollDiagnosticsEnabled(true);
    if (requested === 'clear') value.clearTranscriptScrollWriteTrace();
    if (requested === 'refresh') await value.refreshActiveSession();
  }, action);
}

async function trace(page: Page): Promise<readonly ScrollTrace[]> {
  return page.evaluate(() => {
    const value = (window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi })
      .__RUSTY_VIEW_TEST__;
    return value?.getTranscriptScrollWriteTrace() ?? [];
  });
}

test('attributes current transcript scroll writers across deterministic baseline scenarios', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const sessionA = summary(SESSION_A, 'Scroll diagnostic A');
  const sessionB = summary(SESSION_B, 'Scroll diagnostic B');
  const baseA = Array.from({ length: 36 }, (_, index) =>
    messageEvent(SESSION_A, index + 1),
  );
  const grownA = [...baseA, messageEvent(SESSION_A, 37, 'paused growth')];
  const baseB = Array.from({ length: 8 }, (_, index) =>
    messageEvent(SESSION_B, index + 1),
  );
  let openCountA = 0;
  let releaseSessionAStream = (): void => undefined;
  const sessionAStreamGate = new Promise<void>((resolve) => {
    releaseSessionAStream = resolve;
  });

  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/coordination/agents', (route) =>
    fulfillJson(route, {
      deploymentRole: 'production',
      agents: [SESSION_A, SESSION_B].map((sessionId) => ({
        agentId: 'scroll-diagnostic',
        displayLabel: 'scroll-diagnostic',
        profileId: 'scroll-diagnostic',
        routable: true,
        runtimeKind: 'direct_brain',
        sessionId,
        sessionKind: 'full',
        sessionStatus: 'idle',
        workdir: '/tmp/scroll-diagnostic',
      })),
    }),
  );
  await page.route('**/v1/chat/sessions*', (route) => {
    const archived =
      new URL(route.request().url()).searchParams.get('status') === 'archived';
    return fulfillJson(route, {
      items: archived ? [] : [sessionA, sessionB],
      total: archived ? 0 : 2,
      limit: 100,
      offset: 0,
    });
  });
  await page.route('**/v1/chat/sessions/*', (route) => {
    const url = route.request().url();
    if (url.includes(SESSION_A)) {
      openCountA += 1;
      return fulfillJson(route, {
        session: sessionA,
        events: openCountA === 1 ? baseA : grownA,
      });
    }
    return fulfillJson(route, { session: sessionB, events: baseB });
  });
  await page.route('**/v1/chat/sessions/*/events*', (route) =>
    fulfillJson(route, { items: [], latest_cursor: null, has_more: false }),
  );
  await page.route('**/v1/chat/sessions/*/stream*', async (route) => {
    const sessionAStream = route.request().url().includes(SESSION_A);
    if (sessionAStream) await sessionAStreamGate;
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sessionAStream
        ? [
            sseFrame(SESSION_A, 38, 'assistant_turn_started', {}),
            sseFrame(SESSION_A, 39, 'assistant_text_delta', {
              message_id: `${SESSION_A}:streaming-assistant`,
              delta: 'Deterministic streaming tail growth for baseline.',
            }),
          ].join('')
        : ': deterministic baseline\n\n',
    });
  });

  await page.goto('/');
  await page
    .locator(
      `[data-testid="profile-session-row"][data-session-id="${SESSION_A}"]`,
    )
    .click();
  const viewport = page.getByTestId('transcript-viewport');
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => page.getByTestId('transcript-item').count())
    .toBeGreaterThan(0);
  await expect.poll(() => hasApi(page)).toBe(true);
  await invoke(page, 'enable');

  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, deltaY: -120 }),
    );
    element.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate((messageId) => {
    const value = (window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi })
      .__RUSTY_VIEW_TEST__;
    value?.scrollToMessageId(messageId);
  }, `${SESSION_A}:message:1`);
  await page.evaluate(() => {
    const value = (window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi })
      .__RUSTY_VIEW_TEST__;
    value?.scrollTranscriptToLatest();
  });
  releaseSessionAStream();
  await expect(
    page.getByText('Deterministic streaming tail growth'),
  ).toBeVisible();
  await page.waitForTimeout(150);
  await expect.poll(async () => (await trace(page)).length).toBeGreaterThan(0);
  const following = await trace(page);
  expect(following.some((entry) => entry.reason === 'explicit-latest')).toBe(
    true,
  );

  await viewport.evaluate((element) => {
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
  await invoke(page, 'clear');
  const pausedOffsetBefore = await viewport.evaluate(
    (element) => element.scrollTop,
  );
  await invoke(page, 'refresh');
  await page.waitForTimeout(150);
  const pausedGrowth = await trace(page);
  const pausedOffsetAfter = await viewport.evaluate(
    (element) => element.scrollTop,
  );
  expect(pausedGrowth).toHaveLength(0);
  expect(pausedOffsetAfter).toBe(pausedOffsetBefore);

  const idleOffsetBefore = await viewport.evaluate(
    (element) => element.scrollTop,
  );
  await invoke(page, 'clear');
  await invoke(page, 'refresh');
  await page.waitForTimeout(150);
  const idleRefresh = await trace(page);
  const idleOffsetAfter = await viewport.evaluate(
    (element) => element.scrollTop,
  );
  expect(idleRefresh).toHaveLength(0);
  expect(idleOffsetAfter).toBe(idleOffsetBefore);

  await page.getByRole('button', { name: 'Search' }).click();
  await invoke(page, 'clear');
  await page.getByTestId('transcript-search-input').fill('Diagnostic row 20');
  await expect(page.getByTestId('transcript-search-status')).not.toHaveText(
    'No results',
  );
  await expect
    .poll(async () =>
      (await trace(page)).some((entry) => entry.reason.startsWith('seek-')),
    )
    .toBe(true);
  const activeSearch = await trace(page);
  expect(
    activeSearch.filter((entry) => entry.reason.startsWith('seek-')),
  ).toHaveLength(1);

  await page.getByTestId('transcript-search-input').fill('Diagnostic row');
  await expect(page.getByTestId('transcript-search-status')).toContainText('/');
  await expect
    .poll(
      async () =>
        (await trace(page)).filter((entry) => entry.reason.startsWith('seek-'))
          .length,
    )
    .toBe(2);
  await invoke(page, 'clear');
  await page.getByTestId('transcript-search-next').click();
  await expect
    .poll(
      async () =>
        (await trace(page)).filter((entry) => entry.reason.startsWith('seek-'))
          .length,
    )
    .toBe(1);

  await page.getByTestId('transcript-search-clear').click();
  await invoke(page, 'clear');
  await page
    .locator(
      `[data-testid="profile-session-row"][data-session-id="${SESSION_B}"]`,
    )
    .click();
  await expect(viewport).toBeVisible();
  await expect
    .poll(async () =>
      (await trace(page)).some(
        (entry) => entry.reason === 'session-replacement',
      ),
    )
    .toBe(true);
  const sessionReplacement = await trace(page);
  expect(
    sessionReplacement.some((entry) => entry.reason.startsWith('seek-')),
  ).toBe(false);

  const artifact = {
    capturedAt: new Date().toISOString(),
    browserErrors,
    geometry: {
      pausedGrowth: {
        scrollTopBefore: pausedOffsetBefore,
        scrollTopAfter: pausedOffsetAfter,
        delta: pausedOffsetAfter - pausedOffsetBefore,
      },
      idleRefresh: {
        scrollTopBefore: idleOffsetBefore,
        scrollTopAfter: idleOffsetAfter,
        delta: idleOffsetAfter - idleOffsetBefore,
      },
    },
    scenarios: {
      following,
      pausedGrowth,
      idleRefresh,
      activeSearch,
      sessionReplacement,
    },
  };
  await testInfo.attach('transcript-scroll-baseline-6548.json', {
    body: JSON.stringify(artifact, null, 2),
    contentType: 'application/json',
  });
  console.log(
    JSON.stringify({
      browserErrorCount: browserErrors.length,
      geometry: artifact.geometry,
      scenarios: Object.fromEntries(
        Object.entries(artifact.scenarios).map(([name, entries]) => [
          name,
          {
            writeCount: entries.length,
            reasons: [...new Set(entries.map((entry) => entry.reason))],
          },
        ]),
      ),
    }),
  );

  for (const entries of Object.values(artifact.scenarios)) {
    expect(entries.every((entry) => entry.authority === 'application')).toBe(
      true,
    );
    expect(entries.every((entry) => entry.frame > 0)).toBe(true);
  }
});

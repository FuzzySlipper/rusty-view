import { expect, test, type Page } from '@playwright/test';

const TOTAL_TURNS = 10_000;
const PAGE_LIMIT = 50;
const LIVE_MARKER = 'Concurrent live tail survived backward hydration';
const PAGE_FAILURES = new Map([
  ['before:9850', 'truncated'],
  ['before:9750', 'timeout'],
  ['before:9650', 'unavailable'],
] as const);

test('certifies a disposable 10,000-turn Codex transcript end to end', async ({
  page,
}, testInfo) => {
  test.slow();
  test.setTimeout(120_000);

  const servedTurnIds = new Set<string>();
  const pageEvidence: PageEvidence[] = [];
  const failureAttempts = new Map<string, number>();
  const recoveredFailures = new Set<string>();
  let rawDetailReads = 0;
  let initialStartedAt = 0;
  let initialCompletedAt = 0;

  await page.route('http://mega-session.test/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ok = async (data: unknown, delayMs = 0) => {
      const body = JSON.stringify({
        ok: true,
        data,
        meta: { request_id: 'mega-session-certification', schema_version: 1 },
      });
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body,
      });
      return body;
    };

    if (url.pathname === '/v1/admin/profiles/registry') {
      return ok({ items: [], total: 0, limit: 100, offset: 0 });
    }
    if (url.pathname === '/v1/external-runtimes') {
      return ok({ runtimes: [runtime], controllers: [controller] });
    }
    if (url.pathname === '/v1/external-bindings') {
      return ok({ bindings: [binding, smallBinding] });
    }
    if (url.pathname === '/v1/external-interactions') {
      return ok({ interactions: [] });
    }
    if (url.pathname.endsWith('/threads')) {
      return ok({
        items: [threadSummary, smallThread],
        nextCursor: null,
        backwardsCursor: null,
      });
    }
    if (url.pathname.endsWith('/threads/read')) {
      const requestStartedAt = performance.now();
      const body = request.postDataJSON() as {
        threadId?: string;
        includeTurns?: boolean;
        limit?: number;
        beforeCursor?: string;
      };
      if (body.threadId === 'small-thread') {
        return ok({
          thread: smallThread,
          turnPage: {
            limit: PAGE_LIMIT,
            hasMoreBefore: false,
            beforeCursor: null,
            pageStartCursor: 'small:0',
            pageEndCursor: 'small:2',
          },
        });
      }
      expect(body.threadId).toBe('mega-thread');
      expect(body.includeTurns).toBe(true);
      expect(body.limit).toBe(PAGE_LIMIT);

      if (body.beforeCursor === undefined) initialStartedAt = requestStartedAt;
      const failureKind =
        body.beforeCursor === undefined
          ? undefined
          : PAGE_FAILURES.get(body.beforeCursor);
      if (failureKind !== undefined) {
        const attempt = (failureAttempts.get(failureKind) ?? 0) + 1;
        failureAttempts.set(failureKind, attempt);
        if (attempt === 1 && failureKind === 'truncated') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{"ok":true,"data":{"thread":',
          });
        }
        if (attempt === 1) {
          const timeout = failureKind === 'timeout';
          return route.fulfill({
            status: timeout ? 504 : 503,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: false,
              error: {
                code: timeout ? 'gateway_timeout' : 'service_unavailable',
                reason_code: timeout
                  ? 'external_thread_page_timeout'
                  : 'external_runtime_unavailable',
                message: timeout
                  ? 'The bounded thread page timed out.'
                  : 'The external runtime is temporarily unavailable.',
                retryable: true,
              },
              meta: {
                request_id: 'mega-session-page-failure',
                schema_version: 1,
              },
            }),
          });
        }
      }

      const endExclusive = body.beforeCursor
        ? Number(body.beforeCursor.split(':')[1])
        : TOTAL_TURNS;
      const start = Math.max(0, endExclusive - PAGE_LIMIT);
      const turns = Array.from({ length: endExclusive - start }, (_, offset) =>
        fixtureTurn(start + offset),
      );
      const turnPage = {
        limit: PAGE_LIMIT,
        hasMoreBefore: start > 0,
        beforeCursor: start > 0 ? `before:${start}` : null,
        pageStartCursor: `turn:${start}`,
        pageEndCursor: `turn:${endExclusive - 1}`,
      };
      const responseData = {
        thread: { ...threadSummary, turns },
        turnPage,
      };
      const responseBody = JSON.stringify({
        ok: true,
        data: responseData,
        meta: { request_id: 'mega-session-certification', schema_version: 1 },
      });
      const delayMs = body.beforeCursor === undefined ? 30 : 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: responseBody,
      });
      const completedAt = performance.now();
      if (body.beforeCursor === undefined) initialCompletedAt = completedAt;
      for (const turn of turns) servedTurnIds.add(turn.turnId);
      pageEvidence.push({
        requestedBeforeCursor: body.beforeCursor ?? null,
        returnedBeforeCursor: turnPage.beforeCursor,
        pageStartCursor: turnPage.pageStartCursor,
        pageEndCursor: turnPage.pageEndCursor,
        turnCount: turns.length,
        responseBytes: Buffer.byteLength(responseBody),
        responseContainsHeavyDetail:
          responseBody.includes('heavy-body-loaded-separately') ||
          responseBody.includes('document-body-loaded-separately'),
        serverElapsedMs: completedAt - requestStartedAt,
      });
      return;
    }
    if (url.pathname.endsWith('/events/head')) {
      return ok({ event: null });
    }
    if (url.pathname.endsWith('/events')) {
      return ok({ events: [] });
    }
    if (url.pathname.endsWith('/stream')) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const event = {
        eventId: 'live-10001',
        runtimeId: 'mega-runtime',
        sequenceId: 10_001,
        createdAt: '2026-08-12T08:00:01Z',
        kind: 'assistant_text_delta',
        sessionId: 'mega-session',
        nativeThreadId: 'mega-thread',
        nativeTurnId: 'live-turn-10001',
        itemId: 'live-item-10001',
        payload: {
          nativeMethod: 'item/agentMessage/delta',
          text: LIVE_MARKER,
        },
      };
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `: connected\n\nid: 10001\nevent: assistant_text_delta\ndata: ${JSON.stringify(event)}\n\n`,
      });
    }
    if (
      /\/v1\/external-bindings\/[^/]+\/commands$/.test(url.pathname) &&
      request.method() === 'GET'
    ) {
      return ok(commandCatalog);
    }
    if (url.pathname.endsWith('/raw-details/media-9951')) {
      rawDetailReads += 1;
      return ok({
        detailId: 'media-9951',
        runtimeId: 'mega-runtime',
        json: JSON.stringify({
          image: 'heavy-body-loaded-separately',
          document: 'document-body-loaded-separately',
        }),
        originalSha256: 'fixture-detail-sha256',
        truncated: false,
        redactedKeys: [],
      });
    }
    return route.fulfill({ status: 404, body: 'not mocked' });
  });

  await page.goto('/?api=http://mega-session.test');
  await page.getByTestId('external-agents-tab').click();
  const row = page.locator('[data-thread-id="mega-thread"]');
  await expect(row).toBeVisible();
  const smallRow = page.locator('[data-thread-id="small-thread"]');
  await expect(smallRow).toBeVisible();

  const initialResponse = page.waitForResponse((response) => {
    if (!response.url().endsWith('/threads/read')) return false;
    const body = response.request().postDataJSON() as { beforeCursor?: string };
    return body.beforeCursor === undefined;
  });
  await row.click();
  await initialResponse;

  const initial = pageEvidence[0];
  expect(initial).toBeDefined();
  expect(initial?.turnCount).toBe(PAGE_LIMIT);
  expect(initial?.responseBytes).toBeLessThan(256 * 1024);
  expect(initialCompletedAt - initialStartedAt).toBeLessThan(1_000);
  await expect(page.getByTestId('transcript-viewport')).toContainText(
    'Fixture turn 9999',
  );

  let loadedPageCount = 1;
  while (await page.getByTestId('load-older-external-turns').isVisible()) {
    const button = page.getByTestId('load-older-external-turns');
    const expectedBefore = pageEvidence.at(-1)?.returnedBeforeCursor;
    const response = page.waitForResponse((candidate) => {
      if (!candidate.url().endsWith('/threads/read')) return false;
      const body = candidate.request().postDataJSON() as {
        beforeCursor?: string;
      };
      return body.beforeCursor === expectedBefore;
    });
    await button.click();
    const pageResponse = await response;
    loadedPageCount += 1;

    const failureKind =
      expectedBefore === null ? undefined : PAGE_FAILURES.get(expectedBefore);
    if (failureKind !== undefined && failureAttempts.get(failureKind) === 1) {
      await pageResponse.finished();
      await expect(
        page.getByTestId('external-turn-history-error'),
      ).toContainText('Already-loaded messages were kept');
      const retryResponse = page.waitForResponse((candidate) => {
        if (!candidate.url().endsWith('/threads/read')) return false;
        const retryBody = candidate.request().postDataJSON() as {
          beforeCursor?: string;
        };
        return retryBody.beforeCursor === expectedBefore;
      });
      await page.getByTestId('retry-external-turn-history').click();
      await retryResponse;
      await expect(page.getByTestId('external-turn-history-error')).toHaveCount(
        0,
      );
      recoveredFailures.add(failureKind);
    }

    if (loadedPageCount > TOTAL_TURNS / PAGE_LIMIT + 2) {
      throw new Error('Backward cursor failed to make progress');
    }
  }

  expect(pageEvidence).toHaveLength(TOTAL_TURNS / PAGE_LIMIT);
  expect(servedTurnIds.size).toBe(TOTAL_TURNS);
  expect([...servedTurnIds].sort()).toEqual(
    Array.from({ length: TOTAL_TURNS }, (_, index) => `turn-${index}`).sort(),
  );
  for (const evidence of pageEvidence) {
    expect(evidence.turnCount).toBeLessThanOrEqual(PAGE_LIMIT);
    expect(evidence.responseBytes).toBeLessThan(256 * 1024);
    expect(evidence.responseContainsHeavyDetail).toBe(false);
  }
  expect([...recoveredFailures].sort()).toEqual([
    'timeout',
    'truncated',
    'unavailable',
  ]);
  const hydrationPageEvidence = [...pageEvidence];

  const projected = await page.evaluate(() => {
    const api = (
      window as typeof window & {
        __RUSTY_VIEW_TEST__?: {
          getDisplayedMessages(): readonly {
            id: string;
            text: string;
            blockKinds: readonly string[];
          }[];
        };
      }
    ).__RUSTY_VIEW_TEST__;
    if (api === undefined) throw new Error('Rusty View test API missing');
    return api.getDisplayedMessages();
  });
  const projectedIds = projected.map((message) => message.id);
  const projectedTurnIds = new Set(
    projected.flatMap((message) => {
      const match = /^external:mega-thread:(turn-\d+):/.exec(message.id);
      return match?.[1] === undefined ? [] : [match[1]];
    }),
  );
  expect(projectedTurnIds.size).toBe(TOTAL_TURNS);
  expect(projected.length).toBeGreaterThanOrEqual(TOTAL_TURNS + 1);
  expect(new Set(projectedIds).size).toBe(projectedIds.length);
  expect(projected.some((message) => message.text.includes(LIVE_MARKER))).toBe(
    true,
  );
  expect(
    projected.some((message) => message.text.includes('Fixture turn 0')),
  ).toBe(true);
  expect(
    projected.some((message) => message.text.includes('Fixture turn 9999')),
  ).toBe(true);

  const browserEvidence = await page.evaluate(() => ({
    virtualRows: document.querySelectorAll(
      '[data-testid="transcript-virtual-row"]',
    ).length,
    transcriptItems: document.querySelectorAll(
      '[data-testid="transcript-item"]',
    ).length,
    totalDocumentNodes: document.querySelectorAll('*').length,
    usedHeapBytes:
      (
        performance as Performance & {
          memory?: { usedJSHeapSize: number };
        }
      ).memory?.usedJSHeapSize ?? null,
  }));
  expect(browserEvidence.virtualRows).toBeLessThanOrEqual(64);
  expect(browserEvidence.transcriptItems).toBeLessThanOrEqual(64);

  const viewport = page.getByTestId('transcript-viewport');
  const inputLatencyMs = await page.evaluate(async () => {
    const startedAt = performance.now();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    return performance.now() - startedAt;
  });
  expect(inputLatencyMs).toBeLessThan(250);
  await viewport.press('Home');
  await expect(viewport).toContainText('Fixture turn 0');
  await viewport.press('End');
  await expect(viewport).toContainText(LIVE_MARKER);

  expect(rawDetailReads).toBe(0);
  const detail = await page.evaluate(async () => {
    const response = await fetch(
      'http://mega-session.test/v1/external-runtimes/mega-runtime/raw-details/media-9951',
    );
    return response.json();
  });
  expect(detail).toMatchObject({
    ok: true,
    data: {
      detailId: 'media-9951',
      originalSha256: 'fixture-detail-sha256',
    },
  });
  expect(rawDetailReads).toBe(1);

  await smallRow.click();
  await expect(page.getByTestId('transcript-viewport')).toContainText(
    'Small session 2',
  );
  await expect(page.getByTestId('load-older-external-turns')).toHaveCount(0);
  const smallSessionMessageCount = await displayedMessageCount(page);
  expect(smallSessionMessageCount).toBe(3);

  const refreshedMegaPage = page.waitForResponse((response) => {
    if (!response.url().endsWith('/threads/read')) return false;
    const body = response.request().postDataJSON() as {
      threadId?: string;
      beforeCursor?: string;
    };
    return body.threadId === 'mega-thread' && body.beforeCursor === undefined;
  });
  await row.click();
  await refreshedMegaPage;
  await expect(page.getByTestId('transcript-viewport')).toContainText(
    LIVE_MARKER,
  );
  const refreshedMessages = await displayedMessages(page);
  expect(new Set(refreshedMessages.map((message) => message.id)).size).toBe(
    refreshedMessages.length,
  );
  expect(
    refreshedMessages.filter((message) => message.text.includes(LIVE_MARKER)),
  ).toHaveLength(1);

  const report = {
    totalTurns: TOTAL_TURNS,
    reconstructedTurns: servedTurnIds.size,
    projectedMessages: projected.length,
    projectedSourceTurns: projectedTurnIds.size,
    duplicateProjectedMessages: projected.length - new Set(projectedIds).size,
    initialResponseBytes: initial?.responseBytes,
    initialResponseMs: initialCompletedAt - initialStartedAt,
    pageCount: hydrationPageEvidence.length,
    maxPageBytes: Math.max(...pageEvidence.map((item) => item.responseBytes)),
    recoveredPageFailures: [...recoveredFailures].sort(),
    concurrentLiveMarkerPresent: projected.some((message) =>
      message.text.includes(LIVE_MARKER),
    ),
    rawDetailReads,
    smallSessionMessageCount,
    refreshReadCount: pageEvidence.length - hydrationPageEvidence.length,
    inputNextFrameMs: inputLatencyMs,
    browser: browserEvidence,
    pages: pageEvidence,
  };
  console.log(
    JSON.stringify({
      ...report,
      pages: undefined,
    }),
  );
  await testInfo.attach('mega-session-certification.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(report, null, 2)),
  });
});

async function displayedMessages(page: Page) {
  return page.evaluate(() => {
    const api = (
      window as typeof window & {
        __RUSTY_VIEW_TEST__?: {
          getDisplayedMessages(): readonly {
            id: string;
            text: string;
            blockKinds: readonly string[];
          }[];
        };
      }
    ).__RUSTY_VIEW_TEST__;
    if (api === undefined) throw new Error('Rusty View test API missing');
    return api.getDisplayedMessages();
  });
}

async function displayedMessageCount(page: Page) {
  return page.evaluate(() => {
    const api = (
      window as typeof window & {
        __RUSTY_VIEW_TEST__?: { getDisplayedMessageCount(): number };
      }
    ).__RUSTY_VIEW_TEST__;
    if (api === undefined) throw new Error('Rusty View test API missing');
    return api.getDisplayedMessageCount();
  });
}

function fixtureTurn(index: number) {
  const status =
    index % 211 === 0
      ? 'interrupted'
      : index % 197 === 0
        ? 'failed'
        : 'completed';
  const item =
    index === 9_951
      ? {
          itemId: `item-${index}`,
          kind: 'agentMessage',
          status,
          text: `Fixture turn ${index} image and document handles`,
          rawDetailRef: 'media-9951',
        }
      : index % 5 === 0
        ? {
            itemId: `item-${index}`,
            kind: 'commandExecution',
            status,
            command: 'repeatable-tool',
            text: `Fixture turn ${index} tool summary ${'x'.repeat(512)}`,
          }
        : {
            itemId: `item-${index}`,
            kind: index % 2 === 0 ? 'userMessage' : 'agentMessage',
            status,
            text: `Fixture turn ${index}`,
          };
  return {
    turnId: `turn-${index}`,
    status,
    statusSource: 'fixture',
    terminalReasonCode:
      status === 'failed'
        ? 'fixture_failure'
        : status === 'interrupted'
          ? 'fixture_interrupt'
          : null,
    startedAt: 1_800_000_000 + index * 2,
    completedAt: 1_800_000_001 + index * 2,
    durationMs: 1,
    items: [item],
  };
}

interface PageEvidence {
  requestedBeforeCursor: string | null;
  returnedBeforeCursor: string | null;
  pageStartCursor: string;
  pageEndCursor: string;
  turnCount: number;
  responseBytes: number;
  responseContainsHeavyDetail: boolean;
  serverElapsedMs: number;
}

const runtime = {
  runtimeId: 'mega-runtime',
  kind: 'codex_app_server',
  desiredState: 'enabled',
  observedState: 'ready',
  processOwnership: 'attached',
  endpoint: { transport: 'unix_web_socket', address: '/run/mega.sock' },
  compatibilityState: 'certified',
  consumedContractRevision: 'external-runtime-api-v0',
  observedCliVersion: '0.144.1',
  revision: 1,
  createdAt: '2026-08-12T08:00:00Z',
  updatedAt: '2026-08-12T08:00:00Z',
};

const controller = {
  runtimeId: 'mega-runtime',
  driverState: 'ready',
  controllerInstanceId: 'mega-controller',
  controllerGeneration: 1,
  leaseExpiresAt: '2026-08-12T09:00:00Z',
  observedCliVersion: '0.144.1',
  consumedContractRevision: 'external-runtime-api-v0',
  compatibilityState: 'certified',
  compatibilityDiagnostic: 'certified',
  lastCompatibilityProbe: null,
  bindingResumeFailures: [],
};

const binding = {
  bindingId: 'mega-binding',
  runtimeId: 'mega-runtime',
  nativeThreadId: 'mega-thread',
  sessionId: 'mega-session',
  agentId: 'mega-agent',
  purpose: 'crew_agent',
  status: 'active',
  cwd: '/home/dev/rusty-view',
  taskRef: { project_id: 'rusty-view', task_id: '6796' },
  effectiveConfigFingerprint: 'mega-config',
  messageDeliveryPolicy: 'immediate_steer',
  profileId: 'reviewer',
  profilePromptHash: 'reviewer-prompt-hash',
  profileRevision: 12,
  revision: 1,
  createdAt: '2026-08-12T08:00:00Z',
  updatedAt: '2026-08-12T08:00:00Z',
};

const threadSummary = {
  threadId: 'mega-thread',
  sessionId: 'mega-session',
  parentThreadId: null,
  preview: 'Disposable 10,000-turn certification session',
  ephemeral: false,
  modelProvider: 'openai',
  effectiveModel: 'gpt-5.6-sol',
  createdAt: 1_800_000_000,
  updatedAt: 1_800_020_001,
  status: 'idle',
  cwd: '/home/dev/rusty-view',
  cliVersion: '0.144.1',
  name: 'Mega-session certification',
  agentNickname: 'reviewer',
  agentRole: 'reviewer',
  turns: [],
};

const smallThread = {
  ...threadSummary,
  threadId: 'small-thread',
  sessionId: 'small-session',
  preview: 'Normal small-session regression',
  name: 'Small session',
  status: 'idle',
  turns: Array.from({ length: 3 }, (_, index) => ({
    turnId: `small-turn-${index}`,
    status: 'completed',
    startedAt: 1_800_100_000 + index * 2,
    completedAt: 1_800_100_001 + index * 2,
    durationMs: 1,
    items: [
      {
        itemId: `small-item-${index}`,
        kind: index % 2 === 0 ? 'userMessage' : 'agentMessage',
        status: 'completed',
        text: `Small session ${index}`,
      },
    ],
  })),
};

const smallBinding = {
  ...binding,
  bindingId: 'small-binding',
  nativeThreadId: 'small-thread',
  sessionId: 'small-session',
  agentId: 'small-agent',
  taskRef: null,
  profileId: null,
  profilePromptHash: null,
  profileRevision: null,
};

const commandCatalog = {
  contractVersion: '0.7.0',
  runtimeId: 'mega-runtime',
  bindingId: 'mega-binding',
  nativeThreadId: 'mega-thread',
  commands: [],
  settings: {
    model: 'gpt-5.6-sol',
    modelProvider: 'openai',
    effort: 'xhigh',
  },
  models: [],
};

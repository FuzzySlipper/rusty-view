import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';

type ScrollTrace = {
  readonly reason: string;
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

type SemanticFrame = {
  readonly frame: number;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly bottomError: number;
  readonly renderedMessageIds: readonly string[];
  readonly visibleMessageIds: readonly string[];
  readonly messageTops: Readonly<Record<string, number>>;
  readonly firstFullyVisibleId: string | null;
  readonly firstFullyVisibleTop: number | null;
  readonly lastFullyVisibleId: string | null;
};

type ContractCheck = {
  readonly id: string;
  readonly pass: boolean;
  readonly measurements: Readonly<Record<string, unknown>>;
};

type ContractReport = {
  readonly schemaVersion: 1;
  readonly implementation: 'current-post-churn-fix';
  readonly checks: readonly ContractCheck[];
};

type ChatEventFixture = {
  readonly event_id: string;
  readonly session_id: string;
  readonly sequence_id: number;
  readonly created_at: string;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

const SESSION_A = 'scroll-contract-a';
const SESSION_B = 'scroll-contract-b';
const SESSION_A_PREFIX = `${SESSION_A}:`;
const SESSION_B_PREFIX = `${SESSION_B}:`;
const MAX_SESSION_SWITCH_FRAMES = 18;
const MAX_NAVIGATION_FRAMES = 48;
const MAX_NAVIGATION_RENDERED_MESSAGES = 128;

function envelope(data: unknown): string {
  return JSON.stringify({
    ok: true,
    data,
    meta: { request_id: 'req_scroll_contract', schema_version: 1 },
  });
}

function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: envelope(data),
  });
}

function chatEvent(
  sessionId: string,
  sequence: number,
  kind: string,
  payload: Readonly<Record<string, unknown>>,
): ChatEventFixture {
  return {
    event_id: `${sessionId}:event:${sequence}:${kind}`,
    session_id: sessionId,
    sequence_id: sequence,
    created_at: `2026-08-02T01:${String(Math.floor(sequence / 60)).padStart(2, '0')}:${String(sequence % 60).padStart(2, '0')}Z`,
    kind,
    payload,
  };
}

function messageEvent(
  sessionId: string,
  sequence: number,
  label: string,
  role: 'assistant' | 'user' = sequence % 2 === 0 ? 'assistant' : 'user',
): ChatEventFixture {
  return chatEvent(sessionId, sequence, 'message_created', {
    message_id: `${sessionId}:message:${sequence}`,
    role,
    body: `${label} ${'deterministic variable-height content '.repeat(
      sequence % 7 === 0 ? 16 : 3,
    )}`,
  });
}

function summary(sessionId: string, title: string, count: number) {
  return {
    session_id: sessionId,
    agent_id: 'scroll-contract-agent',
    profile_id: 'scroll-contract-profile',
    kind: 'full',
    status: 'idle',
    title,
    latest_cursor: `${sessionId}:cursor`,
    created_at: '2026-08-02T01:00:00Z',
    updated_at: '2026-08-02T01:05:00Z',
    message_count: count,
    tool_event_count: 0,
  };
}

async function testApi(
  page: Page,
  action: 'enable' | 'clear' | 'refresh' | 'latest',
): Promise<void> {
  await page.evaluate(async (requested) => {
    const api = (window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi })
      .__RUSTY_VIEW_TEST__;
    if (api === undefined) throw new Error('Rusty View test API unavailable');
    if (requested === 'enable') api.setTranscriptScrollDiagnosticsEnabled(true);
    if (requested === 'clear') api.clearTranscriptScrollWriteTrace();
    if (requested === 'refresh') await api.refreshActiveSession();
    if (requested === 'latest') api.scrollTranscriptToLatest();
  }, action);
}

async function applicationWrites(page: Page): Promise<readonly ScrollTrace[]> {
  return page.evaluate(() => {
    return (
      (
        window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi }
      ).__RUSTY_VIEW_TEST__?.getTranscriptScrollWriteTrace() ?? []
    );
  });
}

async function jumpToMessage(page: Page, messageId: string): Promise<void> {
  await page.evaluate((id) => {
    (
      window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi }
    ).__RUSTY_VIEW_TEST__?.scrollToMessageId(id);
  }, messageId);
}

async function semanticFrame(viewport: Locator): Promise<SemanticFrame> {
  return viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const rows = Array.from(
      element.querySelectorAll<HTMLElement>('[data-testid="transcript-item"]'),
    ).map((row) => ({
      id: row.dataset['messageId'] ?? '',
      bounds: row.getBoundingClientRect(),
    }));
    const fullyVisible = rows.filter(
      (row) =>
        row.bounds.top >= bounds.top - 1 &&
        row.bounds.bottom <= bounds.bottom + 1,
    );
    const visible = rows.filter(
      (row) =>
        row.bounds.bottom > bounds.top + 1 &&
        row.bounds.top < bounds.bottom - 1,
    );
    return {
      frame: 0,
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      bottomError: Math.max(
        0,
        element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
      renderedMessageIds: rows.map((row) => row.id),
      visibleMessageIds: visible.map((row) => row.id),
      messageTops: Object.fromEntries(
        rows.map((row) => [row.id, row.bounds.top - bounds.top]),
      ),
      firstFullyVisibleId: fullyVisible.at(0)?.id ?? null,
      firstFullyVisibleTop:
        fullyVisible.length === 0
          ? null
          : (fullyVisible[0]?.bounds.top ?? bounds.top) - bounds.top,
      lastFullyVisibleId: fullyVisible.at(-1)?.id ?? null,
    };
  });
}

async function captureSemanticFrames(
  viewport: Locator,
  count: number,
): Promise<readonly SemanticFrame[]> {
  return viewport.evaluate(async (element, frameCount) => {
    const samples: SemanticFrame[] = [];
    for (let frame = 1; frame <= frameCount; frame += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const bounds = element.getBoundingClientRect();
      const rows = Array.from(
        element.querySelectorAll<HTMLElement>(
          '[data-testid="transcript-item"]',
        ),
      ).map((row) => ({
        id: row.dataset['messageId'] ?? '',
        bounds: row.getBoundingClientRect(),
      }));
      const fullyVisible = rows.filter(
        (row) =>
          row.bounds.top >= bounds.top - 1 &&
          row.bounds.bottom <= bounds.bottom + 1,
      );
      const visible = rows.filter(
        (row) =>
          row.bounds.bottom > bounds.top + 1 &&
          row.bounds.top < bounds.bottom - 1,
      );
      samples.push({
        frame,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        bottomError: Math.max(
          0,
          element.scrollHeight - element.scrollTop - element.clientHeight,
        ),
        renderedMessageIds: rows.map((row) => row.id),
        visibleMessageIds: visible.map((row) => row.id),
        messageTops: Object.fromEntries(
          rows.map((row) => [row.id, row.bounds.top - bounds.top]),
        ),
        firstFullyVisibleId: fullyVisible.at(0)?.id ?? null,
        firstFullyVisibleTop:
          fullyVisible.length === 0
            ? null
            : (fullyVisible[0]?.bounds.top ?? bounds.top) - bounds.top,
        lastFullyVisibleId: fullyVisible.at(-1)?.id ?? null,
      });
    }
    return samples;
  }, count);
}

function reverseMotionFrames(frames: readonly SemanticFrame[]): number[] {
  const reversed: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1];
    const after = frames[index];
    if (
      before !== undefined &&
      after !== undefined &&
      after.scrollHeight >= before.scrollHeight - 1 &&
      after.scrollTop < before.scrollTop - 1
    ) {
      reversed.push(after.frame);
    }
  }
  return reversed;
}

function targetIsVisible(frame: SemanticFrame, messageId: string): boolean {
  return frame.visibleMessageIds.includes(messageId);
}

type AnchorDriftScore = {
  readonly sampleCount: number;
  readonly sameIdEveryFrame: boolean;
  readonly maxPixels: number | null;
  readonly violations: readonly {
    readonly frame: number;
    readonly reason: 'anchor-not-rendered' | 'drift';
    readonly pixels: number | null;
  }[];
};

function scoreAnchorDrift(
  baseline: SemanticFrame,
  samples: readonly SemanticFrame[],
): AnchorDriftScore {
  const anchorId = baseline.firstFullyVisibleId;
  const baselineTop =
    anchorId === null ? undefined : baseline.messageTops[anchorId];
  const measurements = samples.map((sample) => {
    const sampleTop =
      anchorId === null ? undefined : sample.messageTops[anchorId];
    return {
      frame: sample.frame,
      rendered: sampleTop !== undefined,
      pixels:
        baselineTop === undefined || sampleTop === undefined
          ? null
          : Math.abs(sampleTop - baselineTop),
    };
  });
  const violations = measurements.flatMap((measurement) => {
    if (!measurement.rendered) {
      return [
        {
          frame: measurement.frame,
          reason: 'anchor-not-rendered' as const,
          pixels: null,
        },
      ];
    }
    if (measurement.pixels !== null && measurement.pixels > 1) {
      return [
        {
          frame: measurement.frame,
          reason: 'drift' as const,
          pixels: measurement.pixels,
        },
      ];
    }
    return [];
  });
  const pixelMeasurements = measurements.flatMap((measurement) =>
    measurement.pixels === null ? [] : [measurement.pixels],
  );
  return {
    sampleCount: samples.length,
    sameIdEveryFrame:
      anchorId !== null &&
      measurements.every((measurement) => measurement.rendered),
    maxPixels:
      pixelMeasurements.length === 0 ? null : Math.max(...pixelMeasurements),
    violations,
  };
}

async function attachReport(
  testInfo: TestInfo,
  name: string,
  checks: readonly ContractCheck[],
): Promise<void> {
  const report: ContractReport = {
    schemaVersion: 1,
    implementation: 'current-post-churn-fix',
    checks,
  };
  await testInfo.attach(name, {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  console.log(JSON.stringify(report));
  expect(report.checks.map((check) => check.id)).toEqual([
    ...new Set(report.checks.map((check) => check.id)),
  ]);
}

test('semantic scoring rejects recovered drift and overscan-only targets', () => {
  const frame = (
    frameNumber: number,
    anchorTop: number,
    visibleMessageIds: readonly string[] = ['anchor'],
  ): SemanticFrame => ({
    frame: frameNumber,
    scrollTop: 100,
    scrollHeight: 1_000,
    clientHeight: 400,
    bottomError: 500,
    renderedMessageIds: ['anchor', 'overscan-target'],
    visibleMessageIds,
    messageTops: { anchor: anchorTop, 'overscan-target': 500 },
    firstFullyVisibleId: 'anchor',
    firstFullyVisibleTop: anchorTop,
    lastFullyVisibleId: 'anchor',
  });
  const baseline = frame(0, 20);
  const recovered = scoreAnchorDrift(baseline, [
    frame(1, 20),
    frame(2, 28),
    frame(3, 20),
  ]);

  expect(recovered.maxPixels).toBe(8);
  expect(recovered.violations.map((violation) => violation.frame)).toEqual([2]);
  expect(targetIsVisible(baseline, 'overscan-target')).toBe(false);
  expect(
    targetIsVisible(
      frame(1, 20, ['anchor', 'overscan-target']),
      'overscan-target',
    ),
  ).toBe(true);
});

interface ScrollContractFixture {
  appendReplayStep(step: number): string;
  appendPausedTailGrowth(): void;
  appendNewMessage(): void;
  prependHistory(): void;
  appendImage(): void;
  releaseImage(): void;
}

async function installScrollContractFixture(
  page: Page,
): Promise<ScrollContractFixture> {
  const baseA = Array.from({ length: 90 }, (_, index) =>
    messageEvent(SESSION_A, index + 10, `Contract row ${index}`),
  );
  const anchorReasoningEvents = [
    chatEvent(SESSION_A, 54, 'assistant_turn_started', {}),
    chatEvent(SESSION_A, 55, 'assistant_reasoning_delta', {
      wake_id: 'anchor-reasoning',
      text: `Anchor reasoning block.\n${'expandable anchor detail '.repeat(140)}`,
      visibility: 'reasoning',
    }),
    chatEvent(SESSION_A, 56, 'assistant_message_completed', {
      wake_id: 'anchor-reasoning',
      status: 'completed',
      body: [
        'Anchor reasoning answer.',
        '',
        '| Anchor | Stable |',
        '|---|---:|',
        '| Message | yes |',
        '',
        '```typescript',
        'const anchor = "semantic";',
        '```',
      ].join('\n'),
    }),
    chatEvent(SESSION_A, 57, 'assistant_turn_finished', {}),
  ];
  const eventsA: ChatEventFixture[] = [
    ...baseA.slice(0, 45),
    ...anchorReasoningEvents,
    ...baseA.slice(45),
  ];
  const eventsB = Array.from({ length: 24 }, (_, index) =>
    messageEvent(SESSION_B, index + 10, `Replacement row ${index}`),
  );
  let sequence = 200;
  let releaseImageRequest = (): void => undefined;
  const imageRequestGate = new Promise<void>((resolve) => {
    releaseImageRequest = resolve;
  });
  const summaries = [
    summary(SESSION_A, 'Scroll contract A', 100),
    summary(SESSION_B, 'Scroll contract B', 24),
  ];

  await page.route('**/contract-image.svg', async (route) => {
    await imageRequestGate;
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="720" height="480" fill="#268bd2"/></svg>',
    });
  });
  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/coordination/agents', (route) =>
    fulfillJson(route, {
      deploymentRole: 'production',
      agents: [SESSION_A, SESSION_B].map((sessionId) => ({
        agentId: 'scroll-contract-agent',
        displayLabel: 'scroll-contract-agent',
        profileId: 'scroll-contract-profile',
        routable: true,
        runtimeKind: 'direct_brain',
        sessionId,
        sessionKind: 'full',
        sessionStatus: 'idle',
        workdir: '/tmp/scroll-contract',
      })),
    }),
  );
  await page.route('**/v1/chat/sessions*', (route) => {
    const archived =
      new URL(route.request().url()).searchParams.get('status') === 'archived';
    return fulfillJson(route, {
      items: archived ? [] : summaries,
      total: archived ? 0 : summaries.length,
      limit: 100,
      offset: 0,
    });
  });
  await page.route('**/v1/chat/sessions/*', (route) => {
    const sessionB = route.request().url().includes(SESSION_B);
    return fulfillJson(route, {
      session: sessionB ? summaries[1] : summaries[0],
      events: sessionB ? eventsB : eventsA,
    });
  });
  await page.route('**/v1/chat/sessions/*/events*', (route) =>
    fulfillJson(route, { items: [], latest_cursor: null, has_more: false }),
  );
  await page.route('**/v1/chat/sessions/*/stream*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': deterministic scroll contract\n\n',
    }),
  );

  const replaySteps = [
    () => {
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'assistant_turn_started', {}),
      );
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'assistant_reasoning_delta', {
          wake_id: 'scroll-contract-turn',
          text: `Contract streaming reasoning.\n${'reasoning expansion '.repeat(180)}`,
          visibility: 'reasoning',
        }),
      );
      return 'Contract streaming reasoning.';
    },
    () => {
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'tool_call_started', {
          wake_id: 'scroll-contract-turn',
          tool_call_id: 'scroll-contract-tool',
          tool_name: 'contract_probe',
          summary: 'Contract tool running',
          status: 'started',
        }),
      );
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'tool_call_completed', {
          wake_id: 'scroll-contract-turn',
          tool_call_id: 'scroll-contract-tool',
          tool_name: 'contract_probe',
          summary: `Contract tool completed ${'tool output '.repeat(120)}`,
          status: 'completed',
        }),
      );
      return 'Contract tool completed';
    },
    () => {
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'assistant_text_delta', {
          wake_id: 'scroll-contract-turn',
          text: [
            'Contract Markdown completion reflow.',
            '',
            '| Concern | Authority |',
            '|---|---:|',
            '| Scrolling | Browser geometry |',
            '| Identity | Semantic message id |',
            '',
            '```typescript',
            'const contract = "stable";',
            '```',
          ].join('\n'),
        }),
      );
      return 'Contract Markdown completion reflow.';
    },
    () => {
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'assistant_message_completed', {
          wake_id: 'scroll-contract-turn',
          status: 'completed',
          body: 'Contract Markdown completion reflow.',
        }),
      );
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'assistant_turn_finished', {}),
      );
      return 'Contract Markdown completion reflow.';
    },
  ];

  return {
    appendReplayStep(step: number): string {
      const action = replaySteps[step];
      if (action === undefined) throw new Error(`Unknown replay step ${step}`);
      return action();
    },
    appendPausedTailGrowth(): void {
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'assistant_text_delta', {
          wake_id: 'paused-contract-growth',
          text: `Paused tail growth ${'late content '.repeat(160)}`,
        }),
      );
    },
    appendNewMessage(): void {
      eventsA.push(
        messageEvent(
          SESSION_A,
          sequence++,
          'Paused new-message arrival',
          'user',
        ),
      );
    },
    prependHistory(): void {
      eventsA.unshift(messageEvent(SESSION_A, 1, 'Prepended contract history'));
    },
    appendImage(): void {
      const messageId = 'asst:anchor-reasoning';
      const attachment = {
        attachment_id: 'scroll-contract-image',
        session_id: SESSION_A,
        status: 'active',
        filename: 'contract-image.svg',
        mime_type: 'image/svg+xml',
        byte_size: 4096,
        storage_url: 'file:///private/contract-image.svg',
        download_url: '/contract-image.svg',
        thumbnail_url: '/contract-image.svg',
        extracted_text: null,
        extracted_text_truncated: false,
        metadata_json: { source: 'scroll_contract' },
        created_at: '2026-08-02T01:06:00Z',
        updated_at: '2026-08-02T01:06:00Z',
        expires_at: null,
        links: [],
      };
      const link = {
        link_id: 'scroll-contract-image-link',
        attachment_id: 'scroll-contract-image',
        session_id: SESSION_A,
        message_id: messageId,
        block_id: `${messageId}:attachment`,
        scope_id: null,
        metadata_json: { source: 'scroll_contract' },
        created_at: '2026-08-02T01:06:01Z',
      };
      eventsA.push(
        chatEvent(SESSION_A, sequence++, 'attachment_uploaded', { attachment }),
        chatEvent(SESSION_A, sequence++, 'attachment_linked', {
          attachment_id: 'scroll-contract-image',
          attachment: { ...attachment, links: [link] },
          link,
        }),
      );
    },
    releaseImage(): void {
      releaseImageRequest();
    },
  };
}

async function openContractSession(page: Page): Promise<Locator> {
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __RUSTY_VIEW_TEST__?: ScrollTestApi })
            .__RUSTY_VIEW_TEST__ !== undefined,
      ),
    )
    .toBe(true);
  await testApi(page, 'enable');
  return viewport;
}

test('scores following, idle, navigation, and session replacement semantically', async ({
  page,
}, testInfo) => {
  const fixture = await installScrollContractFixture(page);
  const viewport = await openContractSession(page);
  await testApi(page, 'latest');
  await expect
    .poll(async () => (await semanticFrame(viewport)).bottomError)
    .toBeLessThanOrEqual(1);

  const followingCapture = captureSemanticFrames(viewport, 72);
  const expectedBlockCounts = [1, 2, 3, 3] as const;
  const expectedStatuses = [
    'streaming',
    'streaming',
    'streaming',
    'completed',
  ] as const;
  for (let step = 0; step < 4; step += 1) {
    fixture.appendReplayStep(step);
    await testApi(page, 'refresh');
    const turn = viewport.locator(
      '[data-testid="transcript-item"][data-message-id="asst:scroll-contract-turn"]',
    );
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('rv-message-block')).toHaveCount(
      expectedBlockCounts[step] ?? 0,
    );
    await expect(turn.getByTestId('message-row')).toHaveAttribute(
      'data-message-status',
      expectedStatuses[step] ?? 'streaming',
    );
  }
  const followingFrames = await followingCapture;
  const followingViolations = followingFrames.filter(
    (frame) => frame.bottomError > 1,
  );
  const reverseFrames = reverseMotionFrames(followingFrames);

  await testApi(page, 'clear');
  const idleBefore = await semanticFrame(viewport);
  await testApi(page, 'refresh');
  const idleAfter = await semanticFrame(viewport);
  const idleWrites = await applicationWrites(page);

  const navigation: Record<string, unknown>[] = [];
  for (const id of [
    `${SESSION_A}:message:10`,
    `${SESSION_A}:message:55`,
    `${SESSION_A}:message:99`,
  ] as const) {
    await jumpToMessage(page, id);
    const frames = await captureSemanticFrames(viewport, MAX_NAVIGATION_FRAMES);
    const targetFrame = frames.find((frame) => targetIsVisible(frame, id));
    navigation.push({
      id,
      frameToTarget: targetFrame?.frame ?? null,
      maxRenderedCount: Math.max(
        ...frames.map((frame) => frame.renderedMessageIds.length),
      ),
      targetVisible: targetFrame !== undefined,
    });
  }

  await page.getByRole('button', { name: 'Search' }).click();
  await page
    .getByTestId('transcript-search-input')
    .fill('Contract Markdown completion reflow');
  const searchFrames = await captureSemanticFrames(
    viewport,
    MAX_NAVIGATION_FRAMES,
  );
  const searchTargetReached = searchFrames.some((frame) =>
    targetIsVisible(frame, 'asst:scroll-contract-turn'),
  );
  const searchStatus = await page
    .getByTestId('transcript-search-status')
    .textContent();
  await page.getByTestId('transcript-search-clear').click();

  const replacementCapture = captureSemanticFrames(
    viewport,
    MAX_SESSION_SWITCH_FRAMES,
  );
  await page
    .locator(
      `[data-testid="profile-session-row"][data-session-id="${SESSION_B}"]`,
    )
    .click();
  const replacementFrames = await replacementCapture;
  const firstNewFrameIndex = replacementFrames.findIndex((frame) =>
    frame.renderedMessageIds.some((id) => id.startsWith(SESSION_B_PREFIX)),
  );
  const framesAfterReplacement = replacementFrames.slice(
    Math.max(0, firstNewFrameIndex),
  );
  const inheritedAfterReplacement = framesAfterReplacement.flatMap((frame) =>
    frame.renderedMessageIds.filter((id) => id.startsWith(SESSION_A_PREFIX)),
  );
  const replacementTailFrame = framesAfterReplacement.find(
    (frame) =>
      frame.bottomError <= 1 &&
      frame.renderedMessageIds.includes(`${SESSION_B}:message:33`),
  );

  await attachReport(testInfo, 'transcript-scroll-contract-following.json', [
    {
      id: 'following-per-frame',
      pass: followingViolations.length === 0 && reverseFrames.length === 0,
      measurements: {
        sampledFrames: followingFrames.length,
        maxBottomError: Math.max(
          ...followingFrames.map((frame) => frame.bottomError),
        ),
        violatingFrames: followingViolations.map((frame) => frame.frame),
        reverseFrames,
      },
    },
    {
      id: 'idle-identical-projection-null',
      pass:
        idleWrites.length === 0 && idleAfter.scrollTop === idleBefore.scrollTop,
      measurements: {
        applicationWrites: idleWrites.length,
        scrollTopBefore: idleBefore.scrollTop,
        scrollTopAfter: idleAfter.scrollTop,
      },
    },
    {
      id: 'search-first-middle-last',
      pass:
        navigation.every(
          (entry) =>
            entry['targetVisible'] === true &&
            Number(entry['maxRenderedCount']) <=
              MAX_NAVIGATION_RENDERED_MESSAGES,
        ) && searchTargetReached,
      measurements: {
        frameBudget: MAX_NAVIGATION_FRAMES,
        renderedMessageBudget: MAX_NAVIGATION_RENDERED_MESSAGES,
        targets: navigation,
        searchTargetReached,
        searchStatus,
      },
    },
    {
      id: 'session-replacement-bounded',
      pass:
        firstNewFrameIndex >= 0 &&
        replacementTailFrame !== undefined &&
        replacementFrames.every(
          (frame) => frame.renderedMessageIds.length > 0,
        ) &&
        inheritedAfterReplacement.length === 0,
      measurements: {
        frameBudget: MAX_SESSION_SWITCH_FRAMES,
        firstNewFrame: firstNewFrameIndex < 0 ? null : firstNewFrameIndex + 1,
        tailFrame: replacementTailFrame?.frame ?? null,
        emptyFrames: replacementFrames
          .filter((frame) => frame.renderedMessageIds.length === 0)
          .map((frame) => frame.frame),
        inheritedAfterReplacement,
      },
    },
  ]);
});

test('scores paused anchoring, write ownership, and user input modes semantically', async ({
  page,
}, testInfo) => {
  const fixture = await installScrollContractFixture(page);
  const viewport = await openContractSession(page);
  await jumpToMessage(page, 'asst:anchor-reasoning');
  await expect
    .poll(async () => (await semanticFrame(viewport)).firstFullyVisibleId)
    .not.toBeNull();
  await viewport.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, deltaY: -36 }),
    );
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(viewport).toHaveAttribute('data-tail-following', 'false');
  fixture.appendImage();
  await testApi(page, 'refresh');
  await expect(page.getByAltText('contract-image.svg')).toHaveCount(1);
  await testApi(page, 'clear');
  const anchorBefore = await semanticFrame(viewport);
  const driftMeasurements: Record<string, unknown> = {};

  const imageFramesPromise = captureSemanticFrames(viewport, 24);
  fixture.releaseImage();
  await expect(page.getByAltText('contract-image.svg')).toBeVisible();
  driftMeasurements['imageDecode'] = scoreAnchorDrift(
    anchorBefore,
    await imageFramesPromise,
  );

  const tailGrowthFrames = captureSemanticFrames(viewport, 24);
  fixture.appendPausedTailGrowth();
  await testApi(page, 'refresh');
  driftMeasurements['tailGrowth'] = scoreAnchorDrift(
    anchorBefore,
    await tailGrowthFrames,
  );

  const newMessageFrames = captureSemanticFrames(viewport, 24);
  fixture.appendNewMessage();
  await testApi(page, 'refresh');
  driftMeasurements['newMessage'] = scoreAnchorDrift(
    anchorBefore,
    await newMessageFrames,
  );

  const prependFrames = captureSemanticFrames(viewport, 24);
  fixture.prependHistory();
  await testApi(page, 'refresh');
  driftMeasurements['prepend'] = scoreAnchorDrift(
    anchorBefore,
    await prependFrames,
  );

  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  const reasoningFrames = captureSemanticFrames(viewport, 24);
  await page.getByTestId('appearance-auto-expand-reasoning').check();
  driftMeasurements['reasoningExpansion'] = scoreAnchorDrift(
    anchorBefore,
    await reasoningFrames,
  );
  const fontFrames = captureSemanticFrames(viewport, 24);
  await page.getByLabel('Font Scale').evaluate((input: HTMLInputElement) => {
    input.value = '1.1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  driftMeasurements['fontAndCodeReflow'] = scoreAnchorDrift(
    anchorBefore,
    await fontFrames,
  );
  await page.locator('.rv-options__close').click();

  const pausedWrites = await applicationWrites(page);

  const inputMeasurements: Record<string, unknown> = {};
  await testApi(page, 'clear');
  await viewport.evaluate((element) => {
    for (const deltaY of [-24, -18, -12, -6]) {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
      element.scrollTop = Math.max(0, element.scrollTop + deltaY);
      element.dispatchEvent(new Event('scroll'));
    }
  });
  inputMeasurements['wheelTrackpadPaused'] =
    (await viewport.getAttribute('data-tail-following')) === 'false';

  const touchSupported = await viewport.evaluate(async (element) => {
    try {
      element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
      for (const delta of [-18, -14, -10]) {
        element.scrollTop = Math.max(0, element.scrollTop + delta);
        element.dispatchEvent(new Event('scroll'));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      element.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
      // Momentum continues after touchend on mobile browsers. Replaying the
      // post-touch frames here keeps the ownership contract deterministic in
      // desktop CI while the mobile matrix exercises native touch input.
      for (const delta of [-8, -4, -2]) {
        element.scrollTop = Math.max(0, element.scrollTop + delta);
        element.dispatchEvent(new Event('scroll'));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      return true;
    } catch {
      return false;
    }
  });
  inputMeasurements['touchSupported'] = touchSupported;
  inputMeasurements['touchPaused'] =
    (await viewport.getAttribute('data-tail-following')) === 'false';

  await viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: bounds.right - 1,
        clientY: bounds.top + bounds.height / 2,
      }),
    );
    element.scrollTop = Math.max(0, element.scrollTop - 30);
    element.dispatchEvent(new Event('scroll'));
    element.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: bounds.right - 1,
        clientY: bounds.top + bounds.height / 2,
      }),
    );
  });
  inputMeasurements['scrollbarDragPaused'] =
    (await viewport.getAttribute('data-tail-following')) === 'false';

  await viewport.click({ position: { x: 20, y: 20 } });
  const keyboardBefore = await semanticFrame(viewport);
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Home');
  const homeFrame = await semanticFrame(viewport);
  await page.keyboard.press('End');
  const endFrame = await semanticFrame(viewport);
  const inputWrites = await applicationWrites(page);
  inputMeasurements['applicationWritesBeforeResume'] = inputWrites.length;
  const keyboard = {
    pageUpOrHomeMoved: homeFrame.scrollTop < keyboardBefore.scrollTop,
    homeReachedTop: homeFrame.scrollTop <= 1,
    endReachedBottom: endFrame.bottomError <= 1,
  };
  inputMeasurements['keyboard'] = keyboard;

  await page
    .getByTestId('transcript-scroll-to-bottom')
    .evaluateAll((buttons: HTMLButtonElement[]) => buttons.at(0)?.click());
  await expect
    .poll(async () => (await semanticFrame(viewport)).bottomError)
    .toBeLessThanOrEqual(1);
  inputMeasurements['latestResumed'] =
    (await viewport.getAttribute('data-tail-following')) === 'true';

  const drifts = Object.values(driftMeasurements) as AnchorDriftScore[];
  await attachReport(testInfo, 'transcript-scroll-contract-paused.json', [
    {
      id: 'paused-keyed-anchor',
      pass: drifts.every(
        (drift) =>
          drift.sameIdEveryFrame &&
          drift.maxPixels !== null &&
          drift.violations.length === 0,
      ),
      measurements: {
        anchorId: anchorBefore.firstFullyVisibleId,
        anchorTop: anchorBefore.firstFullyVisibleTop,
        mutations: driftMeasurements,
      },
    },
    {
      id: 'paused-application-write-ownership',
      pass: pausedWrites.length === 0,
      measurements: {
        writeCount: pausedWrites.length,
        reasons: [...new Set(pausedWrites.map((entry) => entry.reason))],
      },
    },
    {
      id: 'input-modes',
      pass:
        inputMeasurements['wheelTrackpadPaused'] === true &&
        inputMeasurements['touchPaused'] === true &&
        inputMeasurements['scrollbarDragPaused'] === true &&
        keyboard.pageUpOrHomeMoved &&
        keyboard.homeReachedTop &&
        keyboard.endReachedBottom &&
        inputWrites.length === 0 &&
        inputMeasurements['latestResumed'] === true,
      measurements: inputMeasurements,
    },
  ]);
});

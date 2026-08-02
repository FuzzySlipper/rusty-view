import { expect, test, type Route } from '@playwright/test';

/**
 * Transcript rendering regression test (task #3241).
 *
 * Proves that selecting a session renders actual message ROWS in the transcript
 * — not just that the viewport element mounts. The transcript uses CDK virtual
 * scroll, which only renders rows supplied through `*cdkVirtualFor`; an earlier
 * version used a plain `@for` and rendered zero rows while every unit test still
 * passed (they asserted the input/projection, never the DOM). This test would
 * fail on that bug.
 *
 * Backend-independent: the rusty-crew endpoints are mocked with `page.route`,
 * so it runs anywhere and exercises real browser layout + virtual scroll.
 */

const SESSION_ID = 'render-fixture-session';

const SESSION_SUMMARY = {
  session_id: SESSION_ID,
  agent_id: 'narrator',
  profile_id: 'rp',
  kind: 'full',
  status: 'idle',
  title: 'Render Fixture',
  latest_cursor: `${SESSION_ID}:2`,
  created_at: '2026-06-22T09:00:00Z',
  updated_at: '2026-06-22T10:00:00Z',
  message_count: 3,
  tool_event_count: 0,
};

const USER_BODY = 'The door creaks open.';
const REPRESENTATIVE_TABLE = [
  '| Concern | Stable semantic authority | Variable product composition |',
  '|---|---:|---:|',
  '| Capability state and mutation | Rust | Never TS |',
  '| Rule semantics and appliers | Rust | TS selects/configures |',
  '| Intent validation | Rust | TS constructs intents |',
  '| Formula/predicate meaning | Rust | TS composes typed ASTs |',
  '| Runtime scheduling/timing | Rust | TS chooses declared modes |',
  '| Content and project assembly | Rust validates | TS authors |',
  '| Policy | Rust bounds | TS proposes |',
  '| Workflow and UI | Rust exposes facts | TS orchestrates/presents |',
  '| Proof and certification | Owners expose invariants | External consumers compose evidence |',
].join('\n');
const ASSISTANT_LEAD =
  'A figure steps through the doorway, into the amber light.';
const ASSISTANT_LINK_LABEL = 'Open the encounter report';
const ASSISTANT_LINK_URL = 'https://example.com/encounter-report';
const REPRESENTATIVE_CODE =
  '```ts\nconst lanterns: number = 3;\nconsole.log("amber", lanterns);\n```';
const ASSISTANT_BODY = `${ASSISTANT_LEAD}\n\n[${ASSISTANT_LINK_LABEL}](${ASSISTANT_LINK_URL})\n\n${REPRESENTATIVE_TABLE}\n\n${REPRESENTATIVE_CODE}`;
const TOOL_DEBUG_DETAIL_ID = 'debug_tc1';
const LIVE_SCROLL_SESSION_ID = 'render-live-scroll-session';
const LIVE_SCROLL_ASSISTANT_ID = 'msg_live_scroll_asst';

const MESSAGE_EVENTS = [
  {
    event_id: `${SESSION_ID}:1`,
    session_id: SESSION_ID,
    sequence_id: 1,
    created_at: '2026-06-22T10:00:01Z',
    kind: 'message_created',
    payload: { message_id: 'msg_user_1', role: 'user', body: USER_BODY },
  },
  {
    event_id: `${SESSION_ID}:2`,
    session_id: SESSION_ID,
    sequence_id: 2,
    created_at: '2026-06-22T10:00:02Z',
    kind: 'assistant_turn_started',
    payload: {},
  },
  {
    event_id: `${SESSION_ID}:3`,
    session_id: SESSION_ID,
    sequence_id: 3,
    created_at: '2026-06-22T10:00:02Z',
    kind: 'assistant_text_delta',
    payload: { message_id: 'msg_asst_1', delta: ASSISTANT_BODY },
  },
  {
    event_id: `${SESSION_ID}:4`,
    session_id: SESSION_ID,
    sequence_id: 4,
    created_at: '2026-06-22T10:00:03Z',
    kind: 'tool_call_started',
    payload: {
      tool_call_id: 'tc1',
      tool_name: 'search_lore',
      summary: 'Searching lore for "amber lantern"',
      debug_detail_id: TOOL_DEBUG_DETAIL_ID,
    },
  },
  {
    event_id: `${SESSION_ID}:5`,
    session_id: SESSION_ID,
    sequence_id: 5,
    created_at: '2026-06-22T10:00:04Z',
    kind: 'tool_call_completed',
    payload: {
      tool_call_id: 'tc1',
      tool_name: 'search_lore',
      summary: 'Searching lore for "amber lantern"',
      metadata: { debugDetailId: TOOL_DEBUG_DETAIL_ID },
      result_ref: { hits: 3 },
    },
  },
  {
    event_id: `${SESSION_ID}:6`,
    session_id: SESSION_ID,
    sequence_id: 6,
    created_at: '2026-06-22T10:00:05Z',
    kind: 'assistant_message_completed',
    payload: {
      message_id: 'msg_asst_1',
      status: 'completed',
      summary: 'responses replay wake completed',
    },
  },
  {
    event_id: `${SESSION_ID}:7`,
    session_id: SESSION_ID,
    sequence_id: 7,
    created_at: '2026-06-22T10:00:06Z',
    kind: 'message_created',
    payload: {
      message_id: 'msg_user_2',
      role: 'user',
      body: 'What happens next?',
    },
  },
];

function envelope(data: unknown): string {
  return JSON.stringify({
    ok: true,
    data,
    meta: { request_id: 'req_test', schema_version: 1 },
  });
}

function sseFrame(
  sessionId: string,
  eventId: string,
  sequenceId: number,
  kind: string,
  payload: unknown,
): string {
  const data = JSON.stringify({
    event_id: eventId,
    session_id: sessionId,
    sequence_id: sequenceId,
    created_at: '2026-06-22T10:10:00Z',
    kind,
    payload,
  });
  return `id: ${eventId}\ndata: ${data}\n\n`;
}

function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: envelope(data),
  });
}

function fulfillSessionPage(route: Route, session: unknown): Promise<void> {
  const archived =
    new URL(route.request().url()).searchParams.get('status') === 'archived';
  return fulfillJson(route, {
    items: archived ? [] : [session],
    total: archived ? 0 : 1,
    limit: 100,
    offset: 0,
  });
}

const TOOL_DEBUG_DETAIL = {
  debug_detail_id: TOOL_DEBUG_DETAIL_ID,
  tool_call_id: 'tc1',
  session_id: SESSION_ID,
  wake_id: 'wake_tc1',
  tool_name: 'search_lore',
  status: 'completed',
  arguments: {
    value: { query: 'amber lantern' },
    truncated: false,
    redacted: true,
    sha256: 'sha256:debug-args',
  },
  partial_updates: [
    {
      recorded_at: '2026-06-22T10:00:03Z',
      partial_result: {
        value: { progress: 'searching' },
        truncated: true,
        redacted: false,
        originalJsonChars: 2048,
      },
    },
  ],
  final_result: {
    value: { hits: 3 },
    truncated: false,
    redacted: false,
  },
  source_metadata: { adapter: 'fixture' },
  started_at: '2026-06-22T10:00:03Z',
  updated_at: '2026-06-22T10:00:04Z',
  expires_at: '2026-06-22T11:00:04Z',
  limits: { max_chars: 1024 },
};

test('selecting a session renders message rows in the transcript', async ({
  page,
}) => {
  // Order matters: Playwright matches the most-recently-registered route first,
  // so register the broad list route first and the specific ones after.
  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/chat/sessions*', (route) =>
    fulfillSessionPage(route, SESSION_SUMMARY),
  );
  await page.route('**/v1/chat/sessions/*/events*', (route) =>
    fulfillJson(route, { items: [] }),
  );
  // SSE stream: keep it benign — the rows come from openSession before the
  // stream connects, so an empty event-stream is enough.
  await page.route('**/v1/chat/sessions/*/stream*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ':\n\n',
    }),
  );
  await page.route('**/v1/chat/sessions/*', (route) =>
    fulfillJson(route, { session: SESSION_SUMMARY, events: MESSAGE_EVENTS }),
  );
  await page.route('**/v1/chat/sessions/*/tool-calls/*', (route) =>
    fulfillJson(route, TOOL_DEBUG_DETAIL),
  );

  await page.goto('/');

  const session = page.locator(
    `[data-testid="profile-session-row"][data-session-id="${SESSION_ID}"]`,
  );
  await expect(session).toBeVisible({ timeout: 10_000 });
  await session.click();

  const sessionStatus = page.getByTestId('session-status-bar');
  await expect(sessionStatus).toHaveAttribute('data-surface', 'profile');
  await expect(sessionStatus).toHaveAttribute('data-activity', 'idle');
  await expect(sessionStatus).toContainText('Crew profile');
  await expect(sessionStatus).toContainText('Profile: rp');

  // The real assertion: message ROWS render, not just the viewport shell.
  const items = page.locator('.rv-transcript__item');
  await expect(items).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByText(USER_BODY)).toBeVisible();
  await expect(page.getByText(ASSISTANT_LEAD, { exact: false })).toBeVisible();
  await expect(page.locator('.rv-message--assistant')).not.toContainText(
    'responses replay wake completed',
  );

  const transcriptLink = page.getByRole('link', {
    name: ASSISTANT_LINK_LABEL,
  });
  await expect(transcriptLink).toHaveAttribute('href', ASSISTANT_LINK_URL);
  await expect(transcriptLink).toHaveAttribute('target', '_blank');
  await expect(transcriptLink).toHaveAttribute('rel', 'noopener noreferrer');

  // Role classes are applied (user vs assistant), proving the rows are real
  // message items and not placeholders.
  await expect(page.locator('.rv-message--user')).toHaveCount(2);
  await expect(page.locator('.rv-message--assistant')).toHaveCount(1);

  // GFM tables use semantic structure and preserve delimiter alignment in the
  // shared renderer used by native Profiles and Codex Agent transcripts.
  const tableScroll = page.locator(
    '.rv-message--assistant .rv-md-table-scroll',
  );
  const table = tableScroll.locator('table.rv-md-table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('thead th')).toHaveCount(3);
  await expect(table.locator('tbody tr')).toHaveCount(9);
  await expect(table.locator('thead th').nth(1)).toHaveCSS(
    'text-align',
    'right',
  );
  await expect(table.locator('tbody tr').last().locator('td').nth(2)).toHaveCSS(
    'text-align',
    'right',
  );
  await expect(table.locator('thead th').first()).toHaveCSS(
    'background-color',
    /rgba?\(/,
  );

  // Fenced code is tokenized in the transcript worker, while the palette
  // remains a separately persisted Appearance choice.
  const codeBlock = page.locator('.rv-message--assistant .rv-md-code');
  const keyword = codeBlock.locator('.hljs-keyword');
  const codeString = codeBlock.locator('.hljs-string');
  await expect(codeBlock).toBeVisible();
  await expect(keyword).toHaveText('const');
  await expect(codeString).toHaveText('"amber"');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByTestId('appearance-syntax-theme').selectOption('dracula');
  await page.locator('.rv-options__close').click();
  await expect(keyword).toHaveCSS('color', 'rgb(255, 121, 198)');
  await expect(codeString).toHaveCSS('color', 'rgb(241, 250, 140)');

  // At a portrait viewport, the wide table scrolls inside its own container
  // while the transcript remains contained by the browser viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      tableScroll.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    )
    .toBe(true);
  const containment = await page
    .getByTestId('transcript-viewport')
    .evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      right: element.getBoundingClientRect().right,
      viewportWidth: window.innerWidth,
    }));
  expect(containment.scrollWidth).toBeLessThanOrEqual(
    containment.clientWidth + 1,
  );
  expect(containment.right).toBeLessThanOrEqual(containment.viewportWidth + 1);
  await page.setViewportSize({ width: 1280, height: 720 });

  // The same submission-history behavior is wired to native Crew Profile
  // transcripts, including forward navigation back to the unsent draft.
  const composer = page.getByTestId('message-input-field');
  await composer.fill('profile draft');
  await composer.press('ArrowUp');
  await expect(composer).toHaveValue('profile draft');
  await composer.press('ArrowUp');
  await expect(composer).toHaveValue('What happens next?');
  await composer.press('ArrowUp');
  await expect(composer).toHaveValue(USER_BODY);
  await composer.press('ArrowDown');
  await composer.press('ArrowDown');
  await composer.press('ArrowDown');
  await expect(composer).toHaveValue('profile draft');
  await composer.fill('');

  // Message actions stay visually quiet until their owning message is hovered.
  // The action row remains in the DOM so keyboard focus can reveal it via the
  // message's :focus-within state.
  const assistantMessage = page.locator('.rv-message--assistant');
  const messageActions = assistantMessage.locator('.rv-revision__actions');
  await expect(messageActions).toHaveCSS('opacity', '0');
  await assistantMessage.hover();
  await expect(messageActions).toHaveCSS('opacity', '1');
  await page.locator('.rv-message--user').first().hover();
  await expect(messageActions).toHaveCSS('opacity', '0');

  // The tool call renders inline as a collapsible block with name + status,
  // collapsed by default (no huge result JSON dumped).
  const toolBlock = page.locator('.rv-block--tool');
  await expect(toolBlock).toHaveCount(1);
  await expect(toolBlock).toContainText('search_lore');
  await expect(toolBlock.locator('.rv-block__tool-status')).toHaveText(
    'completed',
  );
  await expect(toolBlock.locator('.rv-block__content')).toHaveCount(0);

  // Expanding reveals the result detail; collapsing hides it again (stable
  // disclosure affordance).
  await toolBlock.locator('.rv-block__tool-header').click();
  await expect(toolBlock.locator('.rv-block__content')).toContainText('hits');
  await toolBlock.locator('.rv-block__tool-header').click();
  await expect(toolBlock.locator('.rv-block__content')).toHaveCount(0);

  const rawDebug = toolBlock.locator('[data-testid="tool-call-debug-toggle"]');
  await expect(rawDebug).toBeVisible();
  await rawDebug.click();
  const debugPanel = toolBlock.locator('[data-testid="tool-call-debug-panel"]');
  await expect(debugPanel).toContainText('redacted');
  await expect(debugPanel).toContainText('truncated');
  await expect(debugPanel).toContainText('sha256:debug-args');
  await expect(debugPanel).toContainText('2048 original JSON chars');
  await expect(debugPanel).toContainText('"query": "amber lantern"');
});

test('scrollToMessageId materializes a live assistant row beyond the bounded window', async ({
  page,
}) => {
  const historicalMessageCount = 96;
  const historicalEvents = Array.from(
    { length: historicalMessageCount },
    (_, index) => ({
      event_id: `${LIVE_SCROLL_SESSION_ID}:${index + 1}`,
      session_id: LIVE_SCROLL_SESSION_ID,
      sequence_id: index + 1,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'message_created',
      payload: {
        message_id: `msg_live_scroll_user_${index + 1}`,
        role: 'user',
        body: [
          `Historical prompt ${index + 1}`,
          'This row is intentionally tall so the keyed transcript window must preserve variable-height layout.',
          'It mimics accumulated live-test history with long prompts, tool requests, and diagnostic instructions above the new assistant turn.',
          'The target assistant row lands after these messages and must still be reachable through scrollToMessageId.',
        ].join('\n'),
      },
    }),
  );
  const liveAssistantDomainEvents = [
    {
      event_id: `${LIVE_SCROLL_SESSION_ID}:97`,
      session_id: LIVE_SCROLL_SESSION_ID,
      sequence_id: 97,
      created_at: '2026-06-22T10:10:00Z',
      kind: 'assistant_turn_started',
      payload: {},
    },
    {
      event_id: `${LIVE_SCROLL_SESSION_ID}:98`,
      session_id: LIVE_SCROLL_SESSION_ID,
      sequence_id: 98,
      created_at: '2026-06-22T10:10:01Z',
      kind: 'assistant_text_delta',
      payload: {
        message_id: LIVE_SCROLL_ASSISTANT_ID,
        delta: 'Assistant row rendered after state update and tall history.',
      },
    },
    {
      event_id: `${LIVE_SCROLL_SESSION_ID}:99`,
      session_id: LIVE_SCROLL_SESSION_ID,
      sequence_id: 99,
      created_at: '2026-06-22T10:10:02Z',
      kind: 'assistant_message_completed',
      payload: {
        message_id: LIVE_SCROLL_ASSISTANT_ID,
        status: 'completed',
      },
    },
  ];
  const liveAssistantEvents = [
    sseFrame(
      LIVE_SCROLL_SESSION_ID,
      `${LIVE_SCROLL_SESSION_ID}:97`,
      97,
      'assistant_turn_started',
      {},
    ),
    sseFrame(
      LIVE_SCROLL_SESSION_ID,
      `${LIVE_SCROLL_SESSION_ID}:98`,
      98,
      'assistant_text_delta',
      {
        message_id: LIVE_SCROLL_ASSISTANT_ID,
        delta: 'Assistant row rendered after state update and tall history.',
      },
    ),
    sseFrame(
      LIVE_SCROLL_SESSION_ID,
      `${LIVE_SCROLL_SESSION_ID}:99`,
      99,
      'assistant_message_completed',
      {
        message_id: LIVE_SCROLL_ASSISTANT_ID,
        status: 'completed',
      },
    ),
  ];
  const liveSessionSummary = {
    session_id: LIVE_SCROLL_SESSION_ID,
    agent_id: 'tester',
    profile_id: 'tester',
    kind: 'full',
    status: 'idle',
    title: 'Live Scroll Fixture',
    latest_cursor: `${LIVE_SCROLL_SESSION_ID}:${historicalMessageCount}`,
    created_at: '2026-06-22T09:00:00Z',
    updated_at: '2026-06-22T10:00:00Z',
    message_count: historicalMessageCount + 1,
    tool_event_count: 0,
  };

  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/coordination/agents', (route) =>
    fulfillJson(route, {
      deploymentRole: 'production',
      agents: [
        {
          agentId: 'tester',
          displayLabel: 'tester',
          profileId: 'tester',
          routable: true,
          runtimeKind: 'direct_brain',
          sessionId: LIVE_SCROLL_SESSION_ID,
          sessionKind: 'full',
          sessionStatus: 'idle',
          workdir: '/tmp/render-live-scroll',
        },
      ],
    }),
  );
  await page.route('**/v1/chat/sessions*', (route) =>
    fulfillSessionPage(route, liveSessionSummary),
  );
  await page.route('**/v1/chat/sessions/*/events*', (route) =>
    fulfillJson(route, {
      items: liveAssistantDomainEvents,
      latest_cursor: `${LIVE_SCROLL_SESSION_ID}:99`,
      has_more: false,
    }),
  );
  await page.route('**/v1/chat/sessions/*/stream*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: liveAssistantEvents.join(''),
    }),
  );
  await page.route('**/v1/chat/sessions/*', (route) =>
    fulfillJson(route, {
      session: liveSessionSummary,
      events: historicalEvents,
    }),
  );

  await page.goto('/');

  await page
    .locator(
      `[data-testid="profile-session-row"][data-session-id="${LIVE_SCROLL_SESSION_ID}"]`,
    )
    .click();
  await page.evaluate(async () => {
    const api = (
      window as Window & {
        __RUSTY_VIEW_TEST__?: { refreshActiveSession(): Promise<void> };
      }
    ).__RUSTY_VIEW_TEST__;
    if (api === undefined) throw new Error('Rusty View test API unavailable');
    await api.refreshActiveSession();
  });
  await expect
    .poll(() =>
      page.evaluate((messageId) => {
        const api = (
          window as Window & {
            __RUSTY_VIEW_TEST__?: {
              getMessages(): readonly { readonly id: string }[];
            };
          }
        ).__RUSTY_VIEW_TEST__;
        return api?.getMessages().some((message) => message.id === messageId);
      }, LIVE_SCROLL_ASSISTANT_ID),
    )
    .toBe(true);

  await page.getByTestId('transcript-viewport').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: bounds.right - 1,
        clientY: bounds.top + 20,
      }),
    );
    element.scrollTo({ top: 0 });
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(
    page.locator(
      `[data-testid="message-row"][data-message-id="${LIVE_SCROLL_ASSISTANT_ID}"]`,
    ),
  ).toHaveCount(0);
  await expect(page.getByTestId('transcript-item')).toHaveCount(64);

  await page.evaluate((messageId) => {
    const api = (
      window as Window & {
        __RUSTY_VIEW_TEST__?: { scrollToMessageId(id: string): void };
      }
    ).__RUSTY_VIEW_TEST__;
    api?.scrollToMessageId(messageId);
  }, LIVE_SCROLL_ASSISTANT_ID);

  const assistantRow = page.locator(
    `[data-testid="message-row"][data-message-id="${LIVE_SCROLL_ASSISTANT_ID}"]`,
  );
  await expect(assistantRow).toBeVisible({ timeout: 10_000 });
  await expect(assistantRow).toContainText(
    'Assistant row rendered after state update',
  );
});

/**
 * Variable-height transcript test (task #3277).
 *
 * Proves that expanding a tool block reflows without overlapping adjacent
 * messages. Expanding a tool block must let native keyed-window layout reflow
 * without overlapping the next message.
 */
test('expanding a tool block does not overlap adjacent messages', async ({
  page,
}) => {
  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/chat/sessions*', (route) =>
    fulfillSessionPage(route, SESSION_SUMMARY),
  );
  await page.route('**/v1/chat/sessions/*/events*', (route) =>
    fulfillJson(route, { items: [] }),
  );
  await page.route('**/v1/chat/sessions/*/stream*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ':\n\n',
    }),
  );
  await page.route('**/v1/chat/sessions/*', (route) =>
    fulfillJson(route, { session: SESSION_SUMMARY, events: MESSAGE_EVENTS }),
  );

  await page.goto('/');

  const session = page.locator(
    `[data-testid="profile-session-row"][data-session-id="${SESSION_ID}"]`,
  );
  await expect(session).toBeVisible({ timeout: 10_000 });
  await session.click();

  // Wait for the transcript to render.
  const items = page.locator('.rv-transcript__item');
  // Now 3 messages: user, assistant (with tool), user reply.
  await expect(items).toHaveCount(3, { timeout: 10_000 });

  // Expand the tool block.
  const toolBlock = page.locator('.rv-block--tool');
  await expect(toolBlock).toBeVisible({ timeout: 5_000 });
  await toolBlock.locator('.rv-block__tool-header').click();
  await expect(toolBlock.locator('.rv-block__content')).toBeVisible();

  // Give native layout a frame to reflow.
  await page.waitForTimeout(200);

  // Bounding box check: the assistant message (index 1) should not overlap
  // the user reply message (index 2). The assistant message's bottom must be
  // at or above the user reply's top.
  const assistantItem = items.nth(1);
  const userReplyItem = items.nth(2);

  const assistantBox = await assistantItem.boundingBox();
  const userReplyBox = await userReplyItem.boundingBox();

  expect(assistantBox).not.toBeNull();
  expect(userReplyBox).not.toBeNull();

  if (assistantBox && userReplyBox) {
    const assistantBottom = assistantBox.y + assistantBox.height;
    const userReplyTop = userReplyBox.y;
    // The assistant message's bottom must not extend past the user reply's top.
    expect(assistantBottom).toBeLessThanOrEqual(userReplyTop + 1); // +1px tolerance
  }
});

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
const ASSISTANT_BODY =
  'A figure steps through the doorway, into the amber light.';

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
    kind: 'assistant_text_delta',
    payload: { message_id: 'msg_asst_1', delta: ASSISTANT_BODY },
  },
  {
    event_id: `${SESSION_ID}:3`,
    session_id: SESSION_ID,
    sequence_id: 3,
    created_at: '2026-06-22T10:00:03Z',
    kind: 'tool_call_started',
    payload: {
      tool_call_id: 'tc1',
      tool_name: 'search_lore',
      summary: 'Searching lore for "amber lantern"',
    },
  },
  {
    event_id: `${SESSION_ID}:4`,
    session_id: SESSION_ID,
    sequence_id: 4,
    created_at: '2026-06-22T10:00:04Z',
    kind: 'tool_call_completed',
    payload: {
      tool_call_id: 'tc1',
      tool_name: 'search_lore',
      summary: 'Searching lore for "amber lantern"',
      result_ref: { hits: 3 },
    },
  },
  {
    event_id: `${SESSION_ID}:5`,
    session_id: SESSION_ID,
    sequence_id: 5,
    created_at: '2026-06-22T10:00:05Z',
    kind: 'assistant_message_completed',
    payload: { message_id: 'msg_asst_1', body: ASSISTANT_BODY },
  },
  {
    event_id: `${SESSION_ID}:6`,
    session_id: SESSION_ID,
    sequence_id: 6,
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

function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: envelope(data),
  });
}

test('selecting a session renders message rows in the transcript', async ({
  page,
}) => {
  // Order matters: Playwright matches the most-recently-registered route first,
  // so register the broad list route first and the specific ones after.
  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/chat/sessions', (route) =>
    fulfillJson(route, {
      items: [SESSION_SUMMARY],
      total: 1,
      limit: 100,
      offset: 0,
    }),
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

  await page.goto('/');

  // Profile loaded from the mocked list.
  const profile = page.locator('.rv-profile').first();
  await expect(profile).toBeVisible({ timeout: 10_000 });
  await profile.click();

  // The real assertion: message ROWS render, not just the viewport shell.
  const items = page.locator('.rv-transcript__item');
  await expect(items).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByText(USER_BODY)).toBeVisible();
  await expect(page.getByText(ASSISTANT_BODY, { exact: false })).toBeVisible();

  // Role classes are applied (user vs assistant), proving the rows are real
  // message items and not placeholders.
  await expect(page.locator('.rv-message--user')).toHaveCount(2);
  await expect(page.locator('.rv-message--assistant')).toHaveCount(1);

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
});

/**
 * Variable-height autosize test (task #3277).
 *
 * Proves that expanding a tool block reflows without overlapping adjacent
 * messages. The transcript uses CDK autosize virtual scroll which measures
 * real item heights. With a fixed 50px item size, expanding a tool block
 * would cause its message to grow past its allocated slot and overlap the
 * next message. The autosize strategy should remeasure and reflow.
 */
test('expanding a tool block does not overlap adjacent messages', async ({
  page,
}) => {
  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/chat/sessions', (route) =>
    fulfillJson(route, {
      items: [SESSION_SUMMARY],
      total: 1,
      limit: 100,
      offset: 0,
    }),
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

  const profile = page.locator('.rv-profile').first();
  await expect(profile).toBeVisible({ timeout: 10_000 });
  await profile.click();

  // Wait for the transcript to render.
  const items = page.locator('.rv-transcript__item');
  // Now 3 messages: user, assistant (with tool), user reply.
  await expect(items).toHaveCount(3, { timeout: 10_000 });

  // Expand the tool block.
  const toolBlock = page.locator('.rv-block--tool');
  await expect(toolBlock).toBeVisible({ timeout: 5_000 });
  await toolBlock.locator('.rv-block__tool-header').click();
  await expect(toolBlock.locator('.rv-block__content')).toBeVisible();

  // Give the autosize strategy a frame to remeasure.
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

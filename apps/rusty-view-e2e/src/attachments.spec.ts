import { expect, test, type Route } from '@playwright/test';

const SESSION_ID = 'attachment-fixture-session';
const CONTENT_URL = `/v1/chat/sessions/${SESSION_ID}/attachments/att_active/content`;
const THUMBNAIL_URL = `/v1/chat/sessions/${SESSION_ID}/attachments/att_active/thumbnail`;

const SESSION = {
  session_id: SESSION_ID,
  agent_id: 'media-agent',
  profile_id: 'media-profile',
  kind: 'full',
  status: 'idle',
  title: 'Attachment Fixture',
  latest_cursor: `${SESSION_ID}:9`,
  created_at: '2026-07-26T06:00:00Z',
  updated_at: '2026-07-26T06:01:00Z',
  message_count: 4,
  tool_event_count: 0,
};

function envelope(data: unknown): string {
  return JSON.stringify({
    ok: true,
    data,
    meta: { request_id: 'req_attachment_test', schema_version: 1 },
  });
}

function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: envelope(data),
  });
}

function link(
  attachmentId: string,
  messageId: string,
  blockId: string,
): Record<string, unknown> {
  return {
    link_id: `link_${attachmentId}`,
    attachment_id: attachmentId,
    session_id: SESSION_ID,
    message_id: messageId,
    block_id: blockId,
    scope_id: null,
    metadata_json: { source: 'browser_fixture' },
    created_at: '2026-07-26T06:00:01Z',
  };
}

function attachment(
  attachmentId: string,
  links: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    attachment_id: attachmentId,
    session_id: SESSION_ID,
    status: 'active',
    filename: `${attachmentId}.png`,
    mime_type: 'image/png',
    byte_size: 8192,
    storage_url: `file:///private/${attachmentId}.png`,
    download_url: null,
    thumbnail_url: null,
    extracted_text: null,
    extracted_text_truncated: false,
    metadata_json: { source: 'browser_fixture' },
    created_at: '2026-07-26T06:00:01Z',
    updated_at: '2026-07-26T06:00:01Z',
    expires_at: null,
    links,
    ...overrides,
  };
}

function event(
  sequenceId: number,
  kind: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    event_id: `${SESSION_ID}:${sequenceId}`,
    session_id: SESSION_ID,
    sequence_id: sequenceId,
    created_at: `2026-07-26T06:00:0${Math.min(sequenceId, 9)}Z`,
    kind,
    payload,
  };
}

test('attachment events render stable responsive image blocks and lifecycle states', async ({
  page,
}) => {
  const activeLink = link('att_active', 'message_active', 'block_active');
  const missingLink = link('att_missing', 'message_missing', 'block_missing');
  const removedLink = link('att_removed', 'message_removed', 'block_removed');
  const activeInitial = attachment('att_active', [activeLink], {
    download_url: `${CONTENT_URL}?revision=1`,
    thumbnail_url: THUMBNAIL_URL,
  });
  const activeUpdated = attachment('att_active', [activeLink], {
    download_url: `${CONTENT_URL}?revision=2`,
    thumbnail_url: THUMBNAIL_URL,
    updated_at: '2026-07-26T06:00:05Z',
  });
  const events = [
    // The link deliberately precedes its target message.
    event(1, 'attachment_linked', {
      attachment_id: 'att_active',
      attachment: activeInitial,
      link: activeLink,
    }),
    // A replayed duplicate must not create a second block.
    event(2, 'attachment_linked', {
      attachment_id: 'att_active',
      attachment: activeInitial,
      link: activeLink,
    }),
    event(3, 'message_created', {
      message_id: 'message_active',
      role: 'assistant',
      body: 'Generated image',
    }),
    event(4, 'attachment_updated', {
      attachment_id: 'att_active',
      attachment: activeUpdated,
    }),
    event(5, 'message_created', {
      message_id: 'message_missing',
      role: 'assistant',
      body: 'Unavailable image',
    }),
    event(6, 'attachment_linked', {
      attachment_id: 'att_missing',
      attachment: attachment('att_missing', [missingLink]),
      link: missingLink,
    }),
    event(7, 'message_created', {
      message_id: 'message_removed',
      role: 'assistant',
      body: 'Removed image',
    }),
    event(8, 'attachment_removed', {
      attachment_id: 'att_removed',
      attachment: attachment('att_removed', [removedLink], {
        status: 'removed',
        updated_at: '2026-07-26T06:00:08Z',
      }),
    }),
    event(9, 'message_created', {
      message_id: 'message_after',
      role: 'assistant',
      body: 'Message after generated media',
    }),
  ];

  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/chat/sessions', (route) =>
    fulfillJson(route, {
      items: [SESSION],
      total: 1,
      limit: 100,
      offset: 0,
    }),
  );
  await page.route('**/v1/chat/sessions/*/events*', (route) =>
    fulfillJson(route, { items: [], latest_cursor: SESSION.latest_cursor }),
  );
  await page.route('**/v1/chat/sessions/*/stream*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ':\n\n',
    }),
  );
  await page.route(`**${THUMBNAIL_URL}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">',
        '<rect width="960" height="540" fill="#586e75"/>',
        '<circle cx="480" cy="270" r="120" fill="#b58900"/>',
        '</svg>',
      ].join(''),
    }),
  );
  await page.route('**/v1/chat/sessions/*', (route) =>
    fulfillJson(route, { session: SESSION, events }),
  );

  await page.goto('/');
  await page.locator('.rv-profile').first().click();

  const activeRow = page.locator(
    '[data-testid="message-row"][data-message-id="message_active"]',
  );
  const activeBlock = activeRow.locator('.rv-attachment');
  await expect(activeBlock).toHaveCount(1);
  const image = activeBlock.locator('.rv-attachment__image');
  await expect(image).toBeVisible();
  await expect(activeBlock).not.toContainText('Loading image');
  const openLink = activeBlock.locator('.rv-attachment__image-link');
  await expect(openLink).toHaveAttribute('href', `${CONTENT_URL}?revision=2`);
  await expect(openLink).toHaveAttribute('target', '_blank');
  await expect(openLink).toHaveAttribute('rel', 'noopener noreferrer');

  await expect(
    page
      .locator('[data-testid="message-row"][data-message-id="message_missing"]')
      .locator('.rv-attachment'),
  ).toContainText('Image unavailable');
  await expect(
    page
      .locator('[data-testid="message-row"][data-message-id="message_removed"]')
      .locator('.rv-attachment'),
  ).toContainText('Attachment removed');

  const afterRow = page.locator(
    '[data-testid="message-row"][data-message-id="message_after"]',
  );
  await expect(afterRow).toBeVisible();
  await expect
    .poll(async () => {
      const [activeBottom, afterTop] = await Promise.all([
        activeRow.evaluate((element) => element.getBoundingClientRect().bottom),
        afterRow.evaluate((element) => element.getBoundingClientRect().top),
      ]);
      return activeBottom <= afterTop + 1;
    })
    .toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const responsiveGeometry = await activeBlock.evaluate((element) => ({
    blockWidth: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    transcriptScrollWidth: element.closest(
      '[data-testid="transcript-viewport"]',
    )?.scrollWidth,
    transcriptClientWidth: element.closest(
      '[data-testid="transcript-viewport"]',
    )?.clientWidth,
  }));
  expect(responsiveGeometry.blockWidth).toBeLessThanOrEqual(
    responsiveGeometry.viewportWidth,
  );
  expect(responsiveGeometry.transcriptScrollWidth).toBeLessThanOrEqual(
    (responsiveGeometry.transcriptClientWidth ?? 0) + 1,
  );
});

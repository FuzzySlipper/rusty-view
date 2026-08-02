import { expect } from '@playwright/test';

import { test } from './live/live-fixture';

/**
 * Live streaming E2E test (task #3205).
 *
 * Proves the full send-message → streamed-assistant-response round-trip in the
 * browser: user types a message → transport POSTs to the backend → SSE stream
 * delivers assistant response events → the transcript renders the response.
 *
 * Uses the shared opt-in live fixture, which defaults to rusty-crew-debug,
 * creates an isolated profile/session, and archives/deletes it during teardown.
 *
 * This test uses a generous timeout (120s) because streamed responses depend
 * on model/agent latency.
 */

test('send message → assistant response appears in transcript @live-agent', async ({
  live,
  page,
}) => {
  await live.requireLiveRun();

  test.setTimeout(120_000); // 120s for model/agent response latency

  // Capture console errors for debugging.
  page.on('pageerror', (err) =>
    console.log('PAGE ERROR during streaming test:', err.message),
  );

  await live.openAppAndSelectProfile();

  // Type a message in the input and send it.
  const textarea = page.locator('.rv-input__field');
  await expect(textarea).toBeVisible({ timeout: 5_000 });
  await textarea.fill('Hello, please respond with a short greeting.');
  await textarea.press('Enter');

  // First, verify the user message appears (it should appear immediately as a
  // message_created event from the SSE stream or the send response).
  const userMessage = page.locator('.rv-message--user');
  await expect(userMessage.first()).toBeVisible({ timeout: 30_000 });

  // Now wait for the assistant response. The response renders in a
  // .rv-message--assistant element. We don't assert on exact content (the
  // model's response is non-deterministic) — just that SOME assistant text
  // appears.
  const assistantMessage = page.locator('.rv-message--assistant');
  await expect(assistantMessage.first()).toBeVisible({ timeout: 120_000 });

  // Verify there is non-empty text content in the assistant message.
  await expect(assistantMessage.first()).not.toHaveText('');
  const assistantText = await assistantMessage.first().innerText();
  expect(assistantText.trim().length).toBeGreaterThan(0);

  // The raw event inspector should show streamed events.
  const eventList = page.locator('.rv-event');
  const eventCount = await eventList.count();
  expect(eventCount).toBeGreaterThan(0);
});

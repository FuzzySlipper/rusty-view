import { expect, test } from '@playwright/test';

/**
 * Live streaming E2E test (task #3205).
 *
 * Proves the full send-message → streamed-assistant-response round-trip in the
 * browser: user types a message → transport POSTs to the backend → SSE stream
 * delivers assistant response events → the transcript renders the response.
 *
 * Requires a running rusty-crew backend at http://127.0.0.1:9347 with an
 * active agent profile that can respond to messages. Auto-skips if the backend
 * is unreachable.
 *
 * This test uses a generous timeout (120s) because streamed responses depend
 * on model/agent latency.
 */

const BACKEND_URL = 'http://127.0.0.1:9347';

async function isBackendReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/v1/chat/sessions`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

test('send message → assistant response appears in transcript', async ({
  page,
}) => {
  const reachable = await isBackendReachable();
  test.skip(!reachable, 'backend not reachable at ' + BACKEND_URL);

  test.setTimeout(120_000); // 120s for model/agent response latency

  // Capture console errors for debugging.
  page.on('pageerror', (err) =>
    console.log('PAGE ERROR during streaming test:', err.message),
  );

  await page.goto('/');

  // Wait for sessions to load.
  const sessionButtons = page.locator('.rv-session');
  await expect(sessionButtons.first()).toBeVisible({ timeout: 10_000 });

  // Prefer an idle/active session (archived sessions may not respond to wakes).
  // Try to find a non-archived session; fall back to the first.
  const count = await sessionButtons.count();
  let targetIndex = 0;
  for (let i = 0; i < count; i++) {
    const text = await sessionButtons.nth(i).textContent();
    if (text !== null && !text.includes('archived')) {
      targetIndex = i;
      break;
    }
  }

  await sessionButtons.nth(targetIndex).click();
  await expect(page.locator('rv-transcript-viewport')).toBeVisible({
    timeout: 10_000,
  });

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

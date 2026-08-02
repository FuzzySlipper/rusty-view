import { test, expect } from './live-fixture';

test('scroll interaction during a real streaming turn leaves visual evidence @live-agent @streaming @scroll', async ({
  live,
}) => {
  test.setTimeout(420_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const prompt = [
    'Live UI scroll-while-streaming verification:',
    'Do not call tools, inspect files, or modify anything. Respond with text only.',
    'Write a long, structured analysis of failure modes in virtualized chat transcripts while assistant text streams in.',
    'Cover scroll anchoring, tail-follow behavior, streamed reasoning blocks, tool-call rows, late completion events, and refresh recovery.',
    'Use at least 14 numbered sections with concrete examples and tradeoffs.',
  ].join('\n');
  const beforeUsers = await live.userStateCount();
  await live.sendPrompt(prompt);
  await live.screenshot('scroll-streaming-prompt-sent');

  const sentUser = await live.waitForSentUserMessage(
    prompt,
    beforeUsers,
    180_000,
  );
  let assistant = await live.waitForNextAssistantMessageAfterUser(
    sentUser.id,
    180_000,
  );
  assistant = await live.waitForVisibleAssistantContentAfterUser(
    sentUser.id,
    (await assistant.getAttribute('data-message-id')) ?? undefined,
    180_000,
  );
  await expect(assistant).toHaveAttribute('data-message-status', 'streaming');

  const viewport = live.page.getByTestId('transcript-viewport');
  await expect
    .poll(
      async () =>
        viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(300);
  await expect(assistant).toHaveAttribute('data-message-status', 'streaming');

  await live.expectVisibleImpact(
    'scroll-during-real-streaming',
    async () => {
      await viewport.hover();
      await live.page.mouse.wheel(0, -900);
      await live.page.mouse.wheel(0, 600);
    },
    {
      region: live.page.getByTestId('transcript-shell'),
      settleMs: 500,
      minChangedBytes: 200,
    },
  );

  await live.waitForAssistantCompletedAfterUser(sentUser.id, 360_000);
  await live.screenshot('scroll-streaming-assistant-complete');
  await live.captureDebugSnapshot('scroll-streaming-assistant-complete');
  live.note(
    'Manual close criterion: compare scroll-during-real-streaming screenshots and confirm the transcript remained coherent while a real assistant turn streamed.',
  );
});

test('refresh after a live turn preserves the rendered assistant response @live-agent @refresh @conversation', async ({
  live,
}) => {
  test.setTimeout(300_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const sentinel = `RV_REFRESH_SENTINEL_${Date.now()}`;
  await live.runTurn({
    prompt: [
      'Live UI refresh verification:',
      `Include the exact marker ${sentinel} in your visible answer.`,
      'Then add one sentence about why refresh recovery matters for a streaming chat client.',
    ].join('\n'),
    assistantCompletedTimeoutMs: 180_000,
  });

  await expect(live.page.getByTestId('transcript-shell')).toContainText(
    sentinel,
  );
  await live.screenshot('refresh-before-reload');
  await live.captureDebugSnapshot('refresh-before-reload');

  await live.page.reload();
  await expect(live.page.getByTestId('debug-shell')).toBeVisible({
    timeout: 10_000,
  });
  await live.openAppAndSelectProfile();

  await expect(live.page.getByTestId('transcript-shell')).toContainText(
    sentinel,
    { timeout: 30_000 },
  );
  await live.screenshot('refresh-after-reload');
  await live.captureDebugSnapshot('refresh-after-reload');
  live.note(
    'Manual close criterion: inspect refresh-before-reload and refresh-after-reload screenshots; the sentinel response must be visible after reload without sending another message.',
  );
});

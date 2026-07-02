import { test, expect } from './live-fixture';

test('scroll interaction during a real streaming turn leaves visual evidence @live-agent @streaming @scroll', async ({
  live,
}) => {
  test.setTimeout(420_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const before = await live.assistantStateCount();
  await live.sendPrompt(
    [
      'Live UI scroll-while-streaming verification:',
      'Write a long, structured analysis of failure modes in virtualized chat transcripts while assistant text streams in.',
      'Cover scroll anchoring, tail-follow behavior, streamed reasoning blocks, tool-call rows, late completion events, and refresh recovery.',
      'Use at least 14 numbered sections with concrete examples and tradeoffs.',
    ].join('\n'),
  );
  await live.screenshot('scroll-streaming-prompt-sent');

  const assistant = await live.waitForNextAssistantMessage(before, 180_000);
  await live.waitForVisibleAssistantContent(assistant, 60_000);

  await live.expectVisibleImpact(
    'scroll-during-real-streaming',
    async () => {
      await live.page.getByTestId('transcript-viewport').hover();
      await live.page.mouse.wheel(0, -900);
      await live.page.mouse.wheel(0, 600);
    },
    {
      region: live.page.getByTestId('transcript-shell'),
      settleMs: 500,
      minChangedBytes: 200,
    },
  );

  await live.waitForAssistantCompletedAfter(before, 360_000);
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

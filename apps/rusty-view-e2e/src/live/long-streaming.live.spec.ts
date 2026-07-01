import { test } from './live-fixture';

const DEFAULT_MIN_STREAMING_MS = 15_000;

// Assertions live in the shared live fixture helpers so every scenario leaves
// the same artifact packet.
// eslint-disable-next-line playwright/expect-expect
test('long real LLM streaming leaves visual evidence @live-agent @streaming', async ({
  live,
}) => {
  test.setTimeout(360_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const minStreamingMs = Number(
    process.env['RV_LIVE_MIN_STREAMING_MS'] ?? DEFAULT_MIN_STREAMING_MS,
  );

  await live.runTurn({
    prompt: [
      'Live UI long-stream verification:',
      'Write a deliberately long answer with at least 18 numbered items.',
      'Each item should be two or three sentences.',
      'The content can be about practical frontend streaming failure modes.',
      'Do not summarize early; the goal is to keep a real response streaming long enough for UI observation.',
    ].join('\n'),
    minStreamingMs,
    assistantStartedTimeoutMs: 180_000,
    assistantCompletedTimeoutMs: 300_000,
  });

  live.note(
    `Manual close criterion: inspect the streaming-in-progress screenshot; it must show the actual rendered assistant response while streaming for at least ${minStreamingMs}ms.`,
  );
});

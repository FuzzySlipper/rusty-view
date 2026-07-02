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
      'Examine the projects at /home/dev/voxelforge, /home/dev/asha, and /home/dev/asha-studio.',
      'Analyze whether it makes sense to port voxelforge functionality into asha core, asha-studio, or a new asha-focused repo.',
      'Use concrete project-architecture criteria: ownership boundaries, UI/editor needs, data model fit, build/runtime coupling, migration risk, and testing strategy.',
      'Write a detailed recommendation with at least 10 sections and include tradeoffs for all three placement options.',
      'Do not rush or summarize early; the purpose of this scenario is to produce a naturally long real LLM response that remains observable while Rusty View renders it.',
    ].join('\n'),
    minStreamingMs,
    assistantStartedTimeoutMs: 180_000,
    assistantCompletedTimeoutMs: 300_000,
  });

  live.note(
    `Manual close criterion: inspect the streaming-in-progress screenshot; it must show the actual rendered assistant response while streaming for at least ${minStreamingMs}ms.`,
  );
});

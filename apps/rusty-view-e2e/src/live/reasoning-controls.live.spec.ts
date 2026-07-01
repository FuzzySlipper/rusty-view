import { test } from './live-fixture';

// Assertions live in the shared live fixture helpers so every scenario leaves
// the same artifact packet.
// eslint-disable-next-line playwright/expect-expect
test('reasoning block control visibly expands when rendered @live-agent @reasoning @controls', async ({
  live,
}) => {
  test.setTimeout(300_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const assistant = await live.runTurn({
    prompt: [
      'Live UI reasoning verification:',
      'If your configured model/profile emits reasoning or planning blocks, use that mode for a short plan before the visible answer.',
      'Then answer with two bullet points about why visual testing of chat controls matters.',
    ].join('\n'),
    assistantCompletedTimeoutMs: 240_000,
  });

  const reasoningToggle = assistant.getByTestId('reasoning-toggle').first();
  // This is a real-profile scenario: some configured profiles/models simply do
  // not emit reasoning blocks.
  // eslint-disable-next-line playwright/no-conditional-in-test
  if ((await reasoningToggle.count()) === 0) {
    live.note(
      'No reasoning block was rendered by the real profile/model; this scenario cannot verify reasoning controls in this run.',
    );
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(true, 'real profile/model did not render a reasoning block');
  }

  await live.expectVisibleImpact(
    'reasoning-toggle-expands-rendered-content',
    async () => {
      await reasoningToggle.click();
    },
    {
      region: assistant,
      minChangedBytes: 250,
    },
  );

  live.note(
    'Manual close criterion: compare the reasoning-toggle before/after screenshots and confirm the rendered reasoning content visibly changed.',
  );
});

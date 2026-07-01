import { test, expect } from './live-fixture';

test('baseline multi-turn real conversation @live-agent @conversation', async ({
  live,
}) => {
  test.setTimeout(300_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const assistantBefore = await live.assistantMessages().count();
  const userBefore = await live.userMessages().count();

  await live.runTurn({
    prompt:
      'Live UI verification turn 1: reply with a concise checklist of three visible UI states a chat client should preserve while streaming.',
    assistantCompletedTimeoutMs: 180_000,
  });

  await live.runTurn({
    prompt:
      'Live UI verification turn 2: refer to your prior answer and add one more item. Keep the response short.',
    assistantCompletedTimeoutMs: 180_000,
  });

  await expect
    .poll(async () => live.assistantMessages().count())
    .toBeGreaterThanOrEqual(assistantBefore + 2);
  await expect
    .poll(async () => live.userMessages().count())
    .toBeGreaterThanOrEqual(userBefore + 2);

  live.note(
    'Manual close criterion: inspect the screenshots and visible-transcript.txt; both turns must appear in the rendered chat UI.',
  );
});

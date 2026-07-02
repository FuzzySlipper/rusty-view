import { test, expect } from './live-fixture';

test('tool or command activity stays attached to the rendered assistant turn @live-agent @activity @tools', async ({
  live,
}) => {
  test.setTimeout(300_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const assistant = await live.runTurn({
    prompt: [
      'Live UI activity-block verification:',
      'Use any available project, notification, message, or filesystem context tools that are relevant before answering.',
      'Then write a concise answer explaining what you checked and why activity blocks should remain attached to the final assistant turn.',
    ].join('\n'),
    assistantCompletedTimeoutMs: 240_000,
  });

  const messageId = await assistant.getAttribute('data-message-id');
  const snapshot = await live.captureDebugSnapshot('activity-block-final');
  const state = snapshot?.messages.find((message) => message.id === messageId);
  const hasActivityBlock =
    state?.blockKinds.includes('tool_call') ||
    state?.blockKinds.includes('command');

  // This is intentionally a real-profile template: not every provider/tool
  // configuration will choose to call a tool for this prompt.
  // eslint-disable-next-line playwright/no-conditional-in-test
  if (!hasActivityBlock) {
    live.note(
      'No tool_call or command block rendered in this run; inspect the evidence packet to decide whether the profile had useful tools available.',
    );
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(true, 'real profile did not emit activity blocks');
  }

  await expect(assistant).toHaveAttribute('data-message-status', 'completed');
  live.note(
    'Manual close criterion: inspect the assistant-complete screenshot and evidence packet; tool/command activity must be inside the completed assistant row, not stranded as a typing row.',
  );
});

test('rapid followup after completion renders as a second completed assistant turn @live-agent @conversation @followup', async ({
  live,
}) => {
  test.setTimeout(300_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const before = await live.assistantStateCount();
  await live.runTurn({
    prompt:
      'Live UI rapid-followup turn 1: give two short risks for chat streaming UIs.',
    assistantCompletedTimeoutMs: 180_000,
  });
  await live.runTurn({
    prompt:
      'Live UI rapid-followup turn 2: immediately add one mitigation for the second risk.',
    assistantCompletedTimeoutMs: 180_000,
  });

  await expect
    .poll(async () => live.assistantStateCount())
    .toBeGreaterThanOrEqual(before + 2);
  live.note(
    'Manual close criterion: inspect final screenshots and visible-transcript.txt; the immediate followup must render as its own completed assistant response.',
  );
});

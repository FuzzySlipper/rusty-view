import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

import { expect, test } from './live-fixture';

const serviceUnit = 'rusty-crew-debug.service';

test('logical turn stays visible across yields and a service restart @live-agent @logical-turn', async ({
  page,
  live,
}) => {
  test.setTimeout(300_000);
  await live.requireLiveRun();
  expect(live.backendUrl).toBe('http://127.0.0.1:9348');
  await live.openAppAndSelectProfile();

  const before = await live.assistantStateCount();
  await live.sendPrompt(sequentialToolPrompt('browser-restart-resume'));
  const status = page.getByTestId('logical-turn-status');
  await expect(status).toContainText(/continuation [1-9]/, {
    timeout: 120_000,
  });
  await live.screenshot('logical-turn-before-restart');

  execFileSync('systemctl', ['--user', 'restart', serviceUnit]);
  await expect(page.getByTestId('stream-status')).toContainText(/connected/i, {
    timeout: 120_000,
  });
  await expect(status).toContainText(/continuation [2-9]/, {
    timeout: 180_000,
  });
  await live.screenshot('logical-turn-after-restart');

  await expect
    .poll(() => live.assistantStateCount(), { timeout: 240_000 })
    .toBeGreaterThan(before);
  await expect(live.latestAssistantMessage()).toHaveAttribute(
    'data-message-status',
    'completed',
    { timeout: 240_000 },
  );
  await openContextInspector(page);
  const diagnostic = page.getByTestId('logical-turn-diagnostics');
  await expect(diagnostic).toContainText('completed');
  await expect(diagnostic).toContainText('Provider operations');
  await expect(diagnostic).toContainText('Tool operations');
  await diagnostic.scrollIntoViewIfNeeded();
  await live.screenshot('logical-turn-completed-diagnostics');
});

test('operator can cancel a queued logical turn from View @live-agent @logical-turn', async ({
  page,
  live,
}) => {
  test.setTimeout(240_000);
  await live.requireLiveRun();
  expect(live.backendUrl).toBe('http://127.0.0.1:9348');
  await live.openAppAndSelectProfile();

  await live.sendPrompt(
    [
      'Call terminal with `sleep 8; git status --short` in /home/dev/rusty-crew.',
      'Then read /home/dev/rusty-crew/README.md and summarize it.',
    ].join('\n'),
  );
  const cancel = page.getByTestId('cancel-logical-turn');
  await expect(cancel).toBeVisible({ timeout: 120_000 });
  await cancel.click();

  await openContextInspector(page);
  const diagnostic = page.getByTestId('logical-turn-diagnostics');
  await expect(diagnostic).toContainText('cancelled', { timeout: 120_000 });
  await diagnostic.scrollIntoViewIfNeeded();
  await live.screenshot('logical-turn-cancelled');
});

async function openContextInspector(page: Page) {
  const inspector = page.getByTestId('inspector-tab-context');
  if ((await inspector.count()) === 0) {
    await page.getByTestId('inspector-toggle').click();
  }
  await page.getByTestId('inspector-tab-context').click();
}

function sequentialToolPrompt(label: string): string {
  return [
    `Live logical-turn certification ${label}.`,
    'Call these tools one at a time and use each result before continuing:',
    '1. git_status for /home/dev/rusty-crew.',
    '2. read_file for /home/dev/rusty-crew/README.md.',
    '3. read_file for /home/dev/rusty-crew/docs/adr/0026-durable-logical-turn-continuation.md.',
    '4. search_files for logical_turn in /home/dev/rusty-crew/crates/brains.',
    'Then give one short summary. Do not skip a tool.',
  ].join('\n');
}

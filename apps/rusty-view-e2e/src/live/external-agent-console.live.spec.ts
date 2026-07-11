import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const live = process.env['RV_EXTERNAL_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('external agent console @live-agent', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_LIVE_RUN=1 for the real Codex app-server scenario',
  );

  test('completes a Den-mapped edit, steers, interrupts a peer, and recovers after refresh', async ({
    page,
  }, testInfo) => {
    test.setTimeout(8 * 60_000);
    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();

    const search = page.getByLabel('Search agent sessions');
    await search.fill('5516');
    const primary = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5516' })
      .first();
    await expect(primary).toBeVisible({ timeout: 30_000 });
    await expect(primary).toHaveAttribute('data-thread-id', /.+/);
    const primaryThreadId = await primary.evaluate((element) =>
      element.getAttribute('data-thread-id'),
    );
    expect(primaryThreadId).toBeTruthy();
    await primary.click();

    const prompt = [
      'Work Den task 5664 now.',
      'Its canonical Den project_id is rusty-view (the local bootstrap text naming rusty-crew does not match this task record).',
      'Read its exact scope from Den and obey it narrowly.',
      `Your native thread id is ${primaryThreadId}.`,
      'Use plan updates, inspect the current Rusty View external-agent implementation, create only the requested certification markdown file, run the requested Prettier check, and post the Den completion handoff.',
      'Do not commit or push.',
    ].join(' ');
    await page.getByTestId('message-input-field').fill(prompt);
    await page.getByTestId('send-message').click();
    const turnStatus = page.getByTestId('external-turn-status');
    await expect(turnStatus).toContainText('active', { timeout: 45_000 });
    await expect(turnStatus).toHaveAttribute('data-active-turn-id', /.+/);
    const primaryTurnId = await turnStatus.evaluate((element) =>
      element.getAttribute('data-active-turn-id'),
    );
    expect(primaryTurnId).toBeTruthy();

    await page
      .getByTestId('message-input-field')
      .fill(
        'Steer: include one sentence confirming that agent fleet attention remains visible independently of the selected transcript, then continue the same task.',
      );
    await page.getByTestId('send-message').click();

    await expect(turnStatus).not.toHaveAttribute(
      'data-active-turn-id',
      primaryTurnId ?? '',
      { timeout: 5 * 60_000 },
    );
    await expect(turnStatus).toContainText('completed');
    await revealTranscriptBlock(page, 'pnpm exec prettier', 'command');
    await revealCertificationFileChange(page);
    await page.screenshot({
      path: testInfo.outputPath('01-primary-completed.png'),
      fullPage: true,
    });

    await search.fill('5529');
    const peer = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5529' })
      .first();
    await expect(peer).toBeVisible();
    await peer.click();
    await page
      .getByTestId('message-input-field')
      .fill(
        'Run a shell command that sleeps for 45 seconds, then report PEER_SHOULD_HAVE_BEEN_INTERRUPTED. Start immediately.',
      );
    await page.getByTestId('send-message').click();
    await expect(page.getByTestId('external-interrupt')).toBeEnabled({
      timeout: 45_000,
    });
    await page.getByTestId('external-interrupt').click();
    await expect(page.getByTestId('external-turn-status')).toContainText(
      'interrupted',
      { timeout: 60_000 },
    );

    await search.clear();
    const completedPrimary = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5516' })
      .first();
    await completedPrimary.click();
    await expect(completedPrimary).toHaveAttribute('data-status', 'completed', {
      timeout: 60_000,
    });
    await expect(peer).toHaveAttribute('data-status', 'interrupted', {
      timeout: 30_000,
    });
    await expect(peer).toContainText('attention');
    await page.screenshot({
      path: testInfo.outputPath('02-peer-interrupted.png'),
      fullPage: true,
    });

    await page.reload();
    await page.getByTestId('external-agents-tab').click();
    await search.fill('5516');
    const recovered = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5516' })
      .first();
    await expect(recovered).toHaveAttribute(
      'data-thread-id',
      primaryThreadId ?? '',
    );
    await recovered.click();
    await expect(page.getByTestId('external-turn-status')).toContainText(
      'completed',
      { timeout: 30_000 },
    );
    await revealCertificationFileChange(page);
    await page.screenshot({
      path: testInfo.outputPath('03-refresh-recovered.png'),
      fullPage: true,
    });
  });

  test('recovers the persisted certification thread and transcript', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();
    const search = page.getByLabel('Search agent sessions');
    await search.fill('5516');
    const row = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5516' })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByTestId('external-turn-status')).toBeVisible();
    await revealTranscriptBlock(page, 'pnpm exec prettier', 'command');
    await revealCertificationFileChange(page);
    await page.screenshot({
      path: testInfo.outputPath('persisted-thread.png'),
      fullPage: true,
    });
  });
});

async function revealCertificationFileChange(page: Page): Promise<void> {
  await revealTranscriptBlock(
    page,
    'external-agent-console-certification.md',
    'file_change',
  );
}

async function revealTranscriptBlock(
  page: Page,
  query: string,
  blockKind: string,
): Promise<void> {
  const searchInput = page.getByTestId('transcript-search-input');
  if (!(await searchInput.isVisible())) {
    await page.getByTestId('transcript-search-toggle').click();
  }
  await searchInput.fill(query);
  await expect(page.getByTestId('transcript-search-status')).not.toContainText(
    '0 results',
  );
  const block = page.locator(`[data-block-kind="${blockKind}"]`).first();
  for (let index = 0; index < 12 && (await block.count()) === 0; index++) {
    await page.getByTestId('transcript-search-next').click();
    await page.waitForTimeout(100);
  }
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(block).toBeInViewport();
}

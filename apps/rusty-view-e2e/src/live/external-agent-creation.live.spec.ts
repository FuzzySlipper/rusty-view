import { expect, test } from '@playwright/test';

const live = process.env['RV_EXTERNAL_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const profile = process.env['RV_LIVE_PROFILE'] ?? 'tester';
const marker = 'EXTERNAL_SESSION_CREATED_5675';

test.describe('external agent creation @live-agent', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_LIVE_RUN=1 for the real Codex app-server scenario',
  );

  test('creates, uses, and reloads a real Codex session from the UI', async ({
    page,
  }, testInfo) => {
    test.setTimeout(5 * 60_000);
    await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();
    await expect(page.getByTestId('external-agent-create')).toBeEnabled({
      timeout: 30_000,
    });

    await page.getByTestId('external-agent-create').click();
    await page.getByLabel('Codex session profile').selectOption(profile);
    await page
      .getByPlaceholder('/home/dev/project')
      .fill('/home/dev/rusty-view');
    await page
      .getByPlaceholder('Optional session name')
      .fill('Rusty View external creation proof');
    await page.getByLabel('Den project').fill('rusty-crew');
    await page.getByLabel('Task').fill('5675');
    await page.screenshot({
      path: testInfo.outputPath('01-real-create-form.png'),
      fullPage: true,
    });
    await page.getByTestId('external-agent-create-submit').click();

    const selected = page.locator(
      '[data-testid="external-agent-row"].rv-agent--selected',
    );
    await expect(selected).toBeVisible({ timeout: 60_000 });
    await expect(selected).toHaveAttribute('data-thread-id', /\S+/);
    await expect(selected).toContainText('#5675');
    const threadId = await selected.evaluate(
      (element) => (element as HTMLElement).dataset['threadId'] ?? '',
    );
    await page.screenshot({
      path: testInfo.outputPath('02-real-created-selected.png'),
      fullPage: true,
    });

    await page
      .getByTestId('message-input-field')
      .fill(
        `Reply with exactly ${marker} and no other text. Do not call tools.`,
      );
    await page.getByTestId('send-message').click();
    const turnStatus = page.getByTestId('external-turn-status');
    await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active', {
      timeout: 45_000,
    });
    await expect(turnStatus).toHaveAttribute('data-turn-phase', 'completed', {
      timeout: 3 * 60_000,
    });
    const assistant = page
      .getByTestId('message-row')
      .and(page.locator('[data-message-role="assistant"]'))
      .filter({ hasText: marker })
      .last();
    await expect(assistant).toHaveAttribute('data-message-status', 'completed');
    await page.screenshot({
      path: testInfo.outputPath('03-real-response.png'),
      fullPage: true,
    });

    await page.reload();
    await page.getByTestId('external-agents-tab').click();
    const recovered = page.locator(
      `[data-testid="external-agent-row"][data-thread-id="${threadId}"]`,
    );
    await expect(recovered).toBeVisible({ timeout: 30_000 });
    await expect(recovered).toContainText('#5675');
    await recovered.click();
    const recoveredAssistant = page
      .getByTestId('message-row')
      .and(page.locator('[data-message-role="assistant"]'))
      .filter({ hasText: marker });
    await expect(recoveredAssistant).toHaveCount(1, { timeout: 30_000 });
    await expect(recoveredAssistant).toHaveAttribute(
      'data-message-status',
      'completed',
    );
    await expect(
      page.getByRole('button', { name: 'Tool running' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('04-real-reloaded.png'),
      fullPage: true,
    });
  });
});

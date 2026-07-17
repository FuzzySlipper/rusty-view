import { expect, test } from '@playwright/test';

const live = process.env['RV_EXTERNAL_NEW_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const profile = process.env['RV_LIVE_PROFILE'] ?? 'tester';

test.describe('external /new replacement @live-agent @commands', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_NEW_LIVE_RUN=1 for the real Crew debug /new scenario',
  );

  test('selects the replacement thread and immediately sends on the stable binding', async ({
    page,
  }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const marker = `RV_EXTERNAL_NEW_${Date.now()}`;
    let commandBindingId: string | undefined;
    let messageBindingId: string | undefined;
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      const match = new URL(request.url()).pathname.match(
        /\/v1\/external-bindings\/([^/]+)\/(commands|messages)$/,
      );
      if (match === null) return;
      const bindingId = decodeURIComponent(match[1] ?? '');
      if (match[2] === 'commands') commandBindingId = bindingId;
      if (match[2] === 'messages') messageBindingId = bindingId;
    });

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
      .fill('Rusty View /new replacement proof');
    await page.getByLabel('Den project').fill('rusty-view');
    await page.getByLabel('Task').fill('5888');
    await page.getByTestId('external-agent-create-submit').click();

    const selected = page.locator(
      '[data-testid="external-agent-row"].rv-agent--selected',
    );
    await expect(selected).toBeVisible({ timeout: 60_000 });
    await expect(selected).toHaveAttribute('data-thread-id', /\S+/);
    const previousThreadId = await selected.evaluate(
      (element) => (element as HTMLElement).dataset['threadId'] ?? '',
    );
    expect(previousThreadId).toBeTruthy();

    const input = page.getByTestId('message-input-field');
    await input.fill('/new');
    await page.getByTestId('send-message').click();

    await expect(selected).not.toHaveAttribute(
      'data-thread-id',
      previousThreadId,
      { timeout: 60_000 },
    );
    const replacementThreadId = await selected.evaluate(
      (element) => (element as HTMLElement).dataset['threadId'] ?? '',
    );
    expect(replacementThreadId).toBeTruthy();

    await input.fill(`Reply with exactly ${marker} and nothing else.`);
    await page.getByTestId('send-message').click();
    await expect(
      page.locator('.rv-message--user').filter({ hasText: marker }),
    ).toBeVisible({ timeout: 5_000 });
    expect(commandBindingId).toBeTruthy();
    expect(messageBindingId).toBe(commandBindingId);

    await expect(
      page
        .locator('[data-message-role="assistant"]')
        .filter({ hasText: marker })
        .last(),
    ).toHaveAttribute('data-message-status', 'completed', {
      timeout: 3 * 60_000,
    });
    await expect(page.getByTestId('external-turn-status')).toHaveAttribute(
      'data-turn-phase',
      'completed',
    );
    await page.screenshot({
      path: testInfo.outputPath('external-new-replacement.png'),
      fullPage: true,
    });
  });
});

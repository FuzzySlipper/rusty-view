import { expect, test } from '@playwright/test';

const live = process.env['RV_EXTERNAL_PHASE_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const threadId =
  process.env['RV_EXTERNAL_PHASE_THREAD_ID'] ??
  '019f564d-6d32-7812-ac90-97ec7b8762e6';

test('reviewed Crew history renders commentary and one final answer after reload @live-agent @phases', async ({
  page,
}) => {
  test.skip(
    !live,
    'set RV_EXTERNAL_PHASE_LIVE_RUN=1 for the reviewed Crew phase proof',
  );

  await page.goto(`/?api=${encodeURIComponent(backend)}`);
  await page.getByTestId('external-agents-tab').click();
  await page.getByTestId('external-agent-mode-archived').click();
  const row = page.locator(`[data-thread-id="${threadId}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.rv-agent__select').click();

  await expect(page.locator('[data-message-phase="commentary"]')).toContainText(
    'two-step plan',
  );
  await expect(page.locator('[data-message-phase="final_answer"]')).toHaveCount(
    1,
  );
  await expect(
    page.locator('[data-message-phase="final_answer"]'),
  ).toContainText('PHASE_LIVE_5699_OK');

  await page.reload();
  await page.getByTestId('external-agents-tab').click();
  await page.getByTestId('external-agent-mode-archived').click();
  await page
    .locator(`[data-thread-id="${threadId}"] .rv-agent__select`)
    .click();
  await expect(page.locator('[data-message-phase="commentary"]')).toHaveCount(
    1,
  );
  await expect(page.locator('[data-message-phase="final_answer"]')).toHaveCount(
    1,
  );
});

import { expect, test } from '@playwright/test';

const live = process.env['RV_DYNAMIC_TOOL_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const bindingId = process.env['RV_DYNAMIC_TOOL_BINDING_ID'] ?? '';
const expectedReason =
  process.env['RV_DYNAMIC_TOOL_EXPECTED_REASON'] ??
  'No active routed review is bound to this reviewer wake.';

test.describe('external dynamic tool failure @live-agent @tools', () => {
  test.skip(
    !live || bindingId === '',
    'set RV_DYNAMIC_TOOL_LIVE_RUN=1 and RV_DYNAMIC_TOOL_BINDING_ID for a real failed dynamic tool call',
  );

  test('shows one terminal tool card with the authoritative failure reason', async ({
    page,
  }) => {
    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();

    const row = page.locator(
      `[data-testid="external-agent-row"][data-binding-id="${bindingId}"]`,
    );
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await page.getByTestId('load-external-event-history').click();

    const tool = page
      .getByTestId('tool-call-block')
      .filter({ hasText: 'complete_routed_review' });
    await expect(tool).toHaveCount(1, { timeout: 30_000 });
    await expect(tool).toHaveAttribute('data-status', 'failed');
    await expect(tool).toContainText(expectedReason);

    await tool.getByTestId('tool-call-toggle').click();
    await expect(tool.getByTestId('tool-call-detail')).toContainText(
      expectedReason,
    );
  });
});

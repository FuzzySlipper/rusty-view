import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator } from '@playwright/test';

const live = process.env['RV_CLIPBOARD_UPLOAD_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const sessionUnderTest =
  process.env['RV_CLIPBOARD_UPLOAD_SESSION'] ??
  'rv-6699-dynamic-tool-cert-session';
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAfKpZVQAAAAASUVORK5CYII=';

test.describe('Crew clipboard image upload @live-agent', () => {
  test.skip(
    !live,
    'set RV_CLIPBOARD_UPLOAD_LIVE_RUN=1 for the real Crew debug scenario',
  );

  test('pastes, uploads, sends, and replays one real PNG attachment', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(3 * 60_000);
    const marker = `RV_CLIPBOARD_UPLOAD_6658_${Date.now()}`;
    let sessionId = '';
    let attachmentId = '';

    try {
      await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
      const sessionRow = page.locator(
        `[data-testid="profile-session-row"][data-session-id="${sessionUnderTest}"]`,
      );
      await expect(sessionRow).toBeVisible({ timeout: 30_000 });
      await sessionRow.click();
      await expect(sessionRow).toHaveClass(/rv-profile-session--selected/, {
        timeout: 30_000,
      });
      sessionId = (await sessionRow.getAttribute('data-session-id')) ?? '';
      expect(sessionId).not.toBe('');

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const api = (
                window as unknown as {
                  __RUSTY_VIEW_TEST__?: {
                    getActiveSessionId(): string | null;
                  };
                }
              ).__RUSTY_VIEW_TEST__;
              return api?.getActiveSessionId() ?? null;
            }),
          { timeout: 30_000 },
        )
        .toBe(sessionId);

      const uploadResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/attachments/upload'),
      );
      const pastePrevented = await page
        .getByTestId('message-input-field')
        .evaluate((textarea, encodedPng) => {
          const bytes = Uint8Array.from(atob(encodedPng), (value) =>
            value.charCodeAt(0),
          );
          const clipboard = new DataTransfer();
          clipboard.items.add(
            new File([bytes], 'clipboard-proof.png', { type: 'image/png' }),
          );
          const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard,
          });
          textarea.dispatchEvent(event);
          return event.defaultPrevented;
        }, pngBase64);
      expect(pastePrevented).toBe(true);
      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok()).toBe(true);
      attachmentId = String(
        asRecord(
          asRecord(asRecord(await uploadResponse.json())['data'])['attachment'],
        )['attachment_id'] ?? '',
      );
      expect(attachmentId).not.toBe('');

      const chip = page.getByTestId('message-attachment-chip');
      await expect(chip).toHaveCount(1);
      await expect(chip).toHaveAttribute('data-status', 'uploaded', {
        timeout: 30_000,
      });
      await expect(chip.locator('img')).toHaveAttribute('src', /^blob:/);

      await page.getByTestId('message-input-field').fill(marker);
      await page.getByTestId('send-message').click();

      const sentRow = page
        .locator('[data-message-role="user"]')
        .filter({ hasText: marker })
        .last();
      await expect(sentRow).toBeVisible({ timeout: 30_000 });
      await expectLoadedImage(sentRow.locator('.rv-attachment__image'));
      await page.screenshot({
        path: testInfo.outputPath('01-clipboard-image-sent.png'),
        fullPage: true,
      });

      await page.reload();
      await expect(chip).toHaveCount(0);
      const replayedRow = page
        .locator('[data-message-role="user"]')
        .filter({ hasText: marker })
        .last();
      await expect(replayedRow).toBeVisible({ timeout: 30_000 });
      await expectLoadedImage(replayedRow.locator('.rv-attachment__image'));
      await page.screenshot({
        path: testInfo.outputPath('02-clipboard-image-replayed.png'),
        fullPage: true,
      });
    } finally {
      if (attachmentId !== '' && sessionId !== '') {
        await removeAttachment(request, sessionId, attachmentId);
      }
    }
  });
});

async function expectLoadedImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
}

async function removeAttachment(
  request: APIRequestContext,
  sessionId: string,
  attachmentId: string,
): Promise<void> {
  const response = await request.delete(
    `${backend}/v1/chat/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  expect(response.ok()).toBe(true);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

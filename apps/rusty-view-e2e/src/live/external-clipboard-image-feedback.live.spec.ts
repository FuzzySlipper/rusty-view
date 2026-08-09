import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
} from '@playwright/test';

const live = process.env['RV_EXTERNAL_CLIPBOARD_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const lanBackend = process.env['RV_LIVE_LAN_URL'] ?? 'http://192.168.1.22:9348';
const profile = process.env['RV_LIVE_PROFILE'] ?? 'rv-6699-dynamic-tool-cert';

test.describe('external clipboard image feedback @live-agent @media', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_CLIPBOARD_LIVE_RUN=1 for the real external image scenario',
  );

  test('delivers one raw clipboard image to the same Codex session and replays it', async ({
    browser,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(10 * 60_000);
    page.setDefaultTimeout(30_000);
    const marker = `RV_EXTERNAL_CLIPBOARD_6731_${Date.now()}`;
    const imagePath = testInfo.outputPath(`${marker}.png`);
    let target: LiveExternalTarget | undefined;
    let attachmentId = '';
    let sessionId = '';

    await generateFeedbackImage(page, imagePath);
    const imageBytes = await readFile(imagePath);
    const expectedSha256 = createHash('sha256')
      .update(imageBytes)
      .digest('hex');

    try {
      await openExternalAgents(page, backend);
      await page.getByTestId('external-agent-create').click();
      await page.getByTestId('agent-create-mode-codex').click();
      await page.getByLabel(/session profile/i).selectOption(profile);
      await page
        .getByPlaceholder('/home/dev/project')
        .fill('/home/dev/rusty-view');
      await page.getByPlaceholder('Optional session name').fill(marker);
      await page.getByLabel('Den project').fill('rusty-crew');
      await page.getByLabel('Task').fill('6731');
      await page.getByTestId('external-agent-create-submit').click();

      const row = page.getByTestId('external-agent-row').filter({
        hasText: marker,
      });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await expect(row).toHaveAttribute('data-thread-id', /\S+/);
      const threadId = (await row.getAttribute('data-thread-id')) ?? '';
      expect(threadId).not.toBe('');
      target = await bindingForThread(request, threadId);
      sessionId = target.sessionId;
      await row.click();

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
            new File([bytes], 'external-clipboard-proof.png', {
              type: 'image/png',
            }),
          );
          const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard,
          });
          textarea.dispatchEvent(event);
          return event.defaultPrevented;
        }, imageBytes.toString('base64'));
      expect(pastePrevented).toBe(true);
      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok()).toBe(true);
      const uploadData = await responseData(uploadResponse);
      attachmentId = String(
        asRecord(asRecord(uploadData['attachment']))['attachment_id'] ?? '',
      );
      expect(attachmentId).not.toBe('');

      const chip = page.getByTestId('message-attachment-chip');
      await expect(chip).toHaveCount(1);
      await expect(chip).toHaveAttribute('data-status', 'uploaded');
      await expect(chip.locator('img')).toHaveAttribute('src', /^blob:/);

      await page.getByLabel('External message mode').selectOption('auto');
      await page
        .getByTestId('message-input-field')
        .fill(
          `${marker}: inspect the attached raw clipboard image. Reply with the exact TOKEN, COLOR, and NUMBER shown in it.`,
        );
      const messageResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/v1\/external-bindings\/[^/]+\/messages$/.test(
            new URL(response.url()).pathname,
          ),
      );
      await page.getByTestId('send-message').click();
      const messageResponse = await messageResponsePromise;
      expect(messageResponse.ok()).toBe(true);
      const delivery = await responseData(messageResponse);
      const deliveryRequest = asRecord(delivery['request']);
      const deliveryId = String(deliveryRequest['deliveryId'] ?? '');
      expect(deliveryId).not.toBe('');
      expect(deliveryRequest['imageAttachmentIds']).toEqual([attachmentId]);

      const userRow = page
        .locator('[data-message-role="user"]')
        .filter({ hasText: marker })
        .last();
      await expect(userRow).toBeVisible({ timeout: 45_000 });

      const assistantRow = page
        .locator('[data-message-role="assistant"]')
        .filter({ hasText: 'RV_IMAGE_FEEDBACK_6731' })
        .last();
      await expect(assistantRow).toContainText('CERULEAN', {
        timeout: 3 * 60_000,
      });
      await expect(assistantRow).toContainText('29');
      await expect(page.getByTestId('external-turn-status')).toHaveAttribute(
        'data-turn-phase',
        'completed',
        { timeout: 3 * 60_000 },
      );

      const terminalDelivery = await readDelivery(request, deliveryId);
      expect(terminalDelivery['status']).toBe('accepted');
      expect(
        asRecord(terminalDelivery['request'])['imageAttachmentIds'],
      ).toEqual([attachmentId]);
      const activation = asRecord(terminalDelivery['activation']);
      const requestId = String(activation['requestId'] ?? '');
      expect(requestId).not.toBe('');

      const thread = await readThread(request, target);
      const inputImage = thread.turns
        .flatMap((turn) => turn.items)
        .flatMap((item) => item.inputImages ?? [])
        .find((image) => image.attachmentId === attachmentId);
      expect(inputImage).toBeDefined();
      expect(inputImage?.sha256).toBe(expectedSha256);
      await expectLoadedImage(userRow.locator('.rv-attachment__image'));

      console.log(
        JSON.stringify({
          marker,
          attachmentId,
          sha256: expectedSha256,
          sessionId,
          bindingId: target.bindingId,
          runtimeId: target.runtimeId,
          nativeThreadId: target.threadId,
          deliveryId,
          externalTurnRequestId: requestId,
          nativeTurnId: thread.turns[0]?.turnId,
        }),
      );

      await page.reload();
      await openExternalAgents(page, backend);
      const recovered = page.getByTestId('external-agent-row').filter({
        hasText: marker,
      });
      await recovered.click();
      const replayedRow = page
        .locator('[data-message-role="user"]')
        .filter({ hasText: marker })
        .last();
      await expectLoadedImage(replayedRow.locator('.rv-attachment__image'));

      await proveLanReplay(browser, marker);
    } finally {
      if (attachmentId !== '' && sessionId !== '') {
        await removeAttachment(request, sessionId, attachmentId);
      }
      if (target !== undefined) await deleteThread(request, target);
    }
  });
});

async function generateFeedbackImage(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.setContent(`
    <main style="box-sizing:border-box;width:100vw;height:100vh;padding:58px;background:#071923;color:#f5f7fa;font:700 38px/1.5 sans-serif">
      <div style="border:10px solid #2574a9;padding:38px">
        <div>RAW CLIPBOARD IMAGE</div>
        <div>TOKEN: RV_IMAGE_FEEDBACK_6731</div>
        <div>COLOR: CERULEAN</div>
        <div>NUMBER: 29</div>
      </div>
    </main>
  `);
  await page.screenshot({ path });
}

async function openExternalAgents(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/?api=${encodeURIComponent(origin)}`);
  await expect(page.getByTestId('external-agents-tab')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('external-agents-tab').click();
}

async function expectLoadedImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
}

interface LiveExternalTarget {
  readonly runtimeId: string;
  readonly bindingId: string;
  readonly sessionId: string;
  readonly threadId: string;
}

async function bindingForThread(
  request: APIRequestContext,
  threadId: string,
): Promise<LiveExternalTarget> {
  const response = await request.get(`${backend}/v1/external-bindings`);
  expect(response.ok()).toBe(true);
  const bindings = (await responseData(response))['bindings'];
  if (!Array.isArray(bindings)) throw new Error('bindings response is missing');
  const binding = bindings
    .map(asRecord)
    .find((candidate) => candidate['nativeThreadId'] === threadId);
  if (binding === undefined) throw new Error(`binding missing for ${threadId}`);
  return {
    runtimeId: String(binding['runtimeId']),
    bindingId: String(binding['bindingId']),
    sessionId: String(binding['sessionId']),
    threadId,
  };
}

async function readDelivery(
  request: APIRequestContext,
  deliveryId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(
    `${backend}/v1/agent-deliveries/${encodeURIComponent(deliveryId)}`,
  );
  expect(response.ok()).toBe(true);
  return responseData(response);
}

interface ThreadProjection {
  readonly turns: Array<{
    readonly items: Array<{
      readonly inputImages?: Array<{
        readonly attachmentId: string;
        readonly sha256: string | null;
      }>;
    }>;
  }>;
}

async function readThread(
  request: APIRequestContext,
  target: LiveExternalTarget,
): Promise<ThreadProjection> {
  const response = await request.post(
    `${backend}/v1/external-runtimes/${encodeURIComponent(target.runtimeId)}/threads/read`,
    { data: { threadId: target.threadId, includeTurns: true } },
  );
  expect(response.ok()).toBe(true);
  return (await responseData(response))['thread'] as ThreadProjection;
}

async function proveLanReplay(browser: Browser, marker: string): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await openExternalAgents(page, lanBackend);
    const row = page.getByTestId('external-agent-row').filter({
      hasText: marker,
    });
    await expect(row).toBeVisible({ timeout: 45_000 });
    await row.click();
    const replayedRow = page
      .locator('[data-message-role="user"]')
      .filter({ hasText: marker })
      .last();
    await expectLoadedImage(replayedRow.locator('.rv-attachment__image'));
    await expect(
      page
        .locator('[data-message-role="assistant"]')
        .filter({ hasText: 'RV_IMAGE_FEEDBACK_6731' })
        .last(),
    ).toContainText('CERULEAN');
  } finally {
    await context.close();
  }
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

async function deleteThread(
  request: APIRequestContext,
  target: LiveExternalTarget,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.post(
          `${backend}/v1/external-runtimes/${encodeURIComponent(target.runtimeId)}/threads/${encodeURIComponent(target.threadId)}/delete`,
        );
        return response.status();
      },
      { timeout: 60_000 },
    )
    .toBe(200);
}

async function responseData(response: {
  json(): Promise<unknown>;
}): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  return asRecord(asRecord(body)['data']);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

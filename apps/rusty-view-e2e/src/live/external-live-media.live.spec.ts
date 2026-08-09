import { expect, test } from '@playwright/test';
import type {
  APIRequestContext,
  APIResponse,
  Browser,
  Page,
} from '@playwright/test';

const live = process.env['RV_EXTERNAL_MEDIA_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const lanBackend = process.env['RV_LIVE_LAN_URL'] ?? 'http://192.168.1.22:9348';
const profile = process.env['RV_LIVE_PROFILE'] ?? 'rv-6699-dynamic-tool-cert';

test.describe('external active-turn media @live-agent @media', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_MEDIA_LIVE_RUN=1 for the real Crew media scenario',
  );

  test('shows two viewed screenshots before completion and survives refresh and LAN replay', async ({
    browser,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(10 * 60_000);
    page.setDefaultTimeout(30_000);
    const marker = `RV_MEDIA_${Date.now()}`;
    const correctionMarker = `${marker}_CORRECTION_RECEIVED`;
    const firstImage = testInfo.outputPath(`${marker}-first.png`);
    const secondImage = testInfo.outputPath(`${marker}-second.png`);
    let target: LiveExternalTarget | undefined;

    await generateProofImage(
      page,
      firstImage,
      'Checkpoint one',
      'Status: AMBER',
      '#b58900',
    );
    await generateProofImage(
      page,
      secondImage,
      'Checkpoint two',
      'Rotate clockwise? NO',
      '#268bd2',
    );

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
      await expect(page.getByTestId('external-agents-tab')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId('external-agents-tab').click();
      await page.getByTestId('external-agent-create').click();
      await page.getByTestId('agent-create-mode-codex').click();
      await page.getByLabel(/session profile/i).selectOption(profile);
      await page
        .getByPlaceholder('/home/dev/project')
        .fill('/home/dev/rusty-view');
      await page.getByPlaceholder('Optional session name').fill(marker);
      await page.getByLabel('Den project').fill('rusty-crew');
      await page.getByLabel('Task').fill('6657');
      await page.getByTestId('external-agent-create-submit').click();

      const row = page.getByTestId('external-agent-row').filter({
        hasText: marker,
      });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await expect(row).toHaveAttribute('data-thread-id', /\S+/);
      const threadId = await row.evaluate((element) =>
        element.getAttribute('data-thread-id'),
      );
      expect(threadId).toBeTruthy();
      target = await bindingForThread(request, threadId ?? '');
      await row.click();

      await sendAutoPrompt(
        page,
        [
          `Inspect ${firstImage} with view_image and comment on its status.`,
          `Then inspect ${secondImage} with a separate view_image call and comment on its rotate instruction.`,
          'After both image calls complete, run the shell command sleep 45.',
          'Only after the sleep returns, write a final response summarizing both images and any operator correction received during the sleep.',
        ].join(' '),
      );
      const turnStatus = page.getByTestId('external-turn-status');
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active', {
        timeout: 45_000,
      });

      const groups = page.getByTestId('external-media-group');
      await expect(groups).toHaveCount(2, { timeout: 3 * 60_000 });
      const images = groups.locator('.rv-attachment__image');
      await expect(images).toHaveCount(2);
      await expect(images.nth(0)).toHaveAttribute('src', /^blob:/);
      await expect(images.nth(1)).toHaveAttribute('src', /^blob:/);
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active');
      const browserArrivalAt = new Date().toISOString();

      await groups.nth(1).locator('.rv-attachment__image-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      const correctionReceipt = await sendAutoPrompt(
        page,
        `Correction: the second screenshot should say YES, not NO. Include ${correctionMarker} in your response so receipt is explicit.`,
      );
      expect(correctionReceipt.status).toMatch(/^(accepted|pending)$/);
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active');
      const correctionAcknowledgement = page
        .getByTestId('message-row')
        .and(page.locator('[data-message-role="assistant"]'))
        .filter({ hasText: correctionMarker });
      await expect(correctionAcknowledgement).toBeVisible({
        timeout: 3 * 60_000,
      });
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'completed', {
        timeout: 3 * 60_000,
      });

      const mediaEvidence = await mediaEvidenceForThread(request, target);
      expect(mediaEvidence).toHaveLength(2);
      console.log(
        JSON.stringify({
          marker,
          browserArrivalAt,
          correctionDeliveryId: correctionReceipt.deliveryId,
          mediaEvidence,
        }),
      );

      await page.reload();
      console.log(JSON.stringify({ marker, stage: 'refresh-loaded' }));
      await page.getByTestId('external-agents-tab').click();
      const recovered = page.getByTestId('external-agent-row').filter({
        hasText: marker,
      });
      await recovered.click();
      await expect(page.getByTestId('external-media-group')).toHaveCount(2, {
        timeout: 45_000,
      });
      console.log(JSON.stringify({ marker, stage: 'refresh-media-restored' }));

      await proveLanReplay(browser, marker);
      console.log(JSON.stringify({ marker, stage: 'lan-media-restored' }));
    } finally {
      if (target !== undefined) await deleteThread(request, target);
    }
  });
});

async function generateProofImage(
  page: Page,
  path: string,
  heading: string,
  detail: string,
  color: string,
): Promise<void> {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.setContent(
    `<main style="box-sizing:border-box;width:100vw;height:100vh;padding:64px;background:#002b36;color:#fdf6e3;font:32px sans-serif"><h1>${heading}</h1><p style="padding:24px;border:8px solid ${color}">${detail}</p></main>`,
  );
  await page.screenshot({ path });
}

async function sendAutoPrompt(
  page: Page,
  prompt: string,
): Promise<{ readonly status: string; readonly deliveryId?: string }> {
  await page.getByLabel('External message mode').selectOption('auto');
  await page.getByTestId('message-input-field').fill(prompt);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/messages'),
  );
  await page.getByTestId('send-message').click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const data = await responseData(response);
  const request = asRecord(data['request']);
  const deliveryId =
    typeof request['deliveryId'] === 'string'
      ? request['deliveryId']
      : typeof data['deliveryId'] === 'string'
        ? data['deliveryId']
        : undefined;
  return {
    status: String(data['status']),
    ...(deliveryId === undefined ? {} : { deliveryId }),
  };
}

interface LiveExternalTarget {
  readonly runtimeId: string;
  readonly bindingId: string;
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
    threadId,
  };
}

interface MediaEvidence {
  readonly sequenceId: number;
  readonly nativeTurnId: string;
  readonly itemId: string;
  readonly attachmentId: string;
  readonly mediaIndex: number;
  readonly contentUrl: string;
}

async function mediaEvidenceForThread(
  request: APIRequestContext,
  target: LiveExternalTarget,
): Promise<readonly MediaEvidence[]> {
  const response = await request.get(
    `${backend}/v1/external-runtimes/${encodeURIComponent(target.runtimeId)}/events?native_thread_id=${encodeURIComponent(target.threadId)}&limit=1000`,
  );
  expect(response.ok()).toBe(true);
  const events = (await responseData(response))['events'];
  if (!Array.isArray(events)) throw new Error('runtime events are missing');
  const projected = events.map(asRecord).flatMap((event) => {
    const payload = asRecord(event['payload']);
    const media = payload['media'];
    if (!Array.isArray(media)) return [];
    return media.map((value) => {
      const reference = asRecord(value);
      return {
        sequenceId: Number(event['sequenceId']),
        nativeTurnId: String(event['nativeTurnId']),
        itemId: String(event['itemId']),
        attachmentId: String(reference['attachmentId']),
        mediaIndex: Number(reference['mediaIndex']),
        contentUrl: String(reference['contentUrl']),
      };
    });
  });
  const firstByAttachment = new Map<string, MediaEvidence>();
  for (const evidence of projected) {
    if (!firstByAttachment.has(evidence.attachmentId)) {
      firstByAttachment.set(evidence.attachmentId, evidence);
    }
  }
  return [...firstByAttachment.values()];
}

async function proveLanReplay(browser: Browser, marker: string): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(`${lanBackend}/?api=${encodeURIComponent(lanBackend)}`);
    console.log(JSON.stringify({ marker, stage: 'lan-loaded' }));
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    const row = page
      .getByTestId('external-agent-row')
      .filter({ hasText: marker });
    await expect(row).toBeVisible({ timeout: 45_000 });
    console.log(JSON.stringify({ marker, stage: 'lan-session-visible' }));
    await row.click();
    const groups = page.getByTestId('external-media-group');
    await expect(groups).toHaveCount(2, { timeout: 45_000 });
    console.log(JSON.stringify({ marker, stage: 'lan-media-groups-visible' }));
    await expect(groups.locator('img').nth(0)).toHaveAttribute('src', /^blob:/);
    await expect(groups.locator('img').nth(1)).toHaveAttribute('src', /^blob:/);
  } finally {
    await context.close();
  }
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

async function responseData(
  response: APIResponse,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  return asRecord(asRecord(body)['data']);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

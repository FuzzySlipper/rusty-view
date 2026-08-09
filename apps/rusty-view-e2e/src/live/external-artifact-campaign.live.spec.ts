import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {
  APIRequestContext,
  APIResponse,
  Browser,
  Locator,
  Page,
} from '@playwright/test';

const live = process.env['RV_ARTIFACT_CAMPAIGN_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const lanBackend = process.env['RV_LIVE_LAN_URL'] ?? 'http://192.168.1.22:9348';
const profile = process.env['RV_LIVE_PROFILE'] ?? 'rv-6699-dynamic-tool-cert';

test.describe('external artifact campaign @live-agent @media @documents', () => {
  test.skip(
    !live,
    'set RV_ARTIFACT_CAMPAIGN_LIVE_RUN=1 for the combined campaign scenario',
  );

  test('keeps live media, documents, and clipboard feedback collaborative in one session', async ({
    browser,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(12 * 60_000);
    page.setDefaultTimeout(30_000);
    const marker = `RV_ARTIFACT_CAMPAIGN_6659_${Date.now()}`;
    const screenshotPath = testInfo.outputPath(`${marker}-screenshot.png`);
    const feedbackPath = testInfo.outputPath(`${marker}-feedback.png`);
    const markdownPath = testInfo.outputPath(`${marker}-checkpoint.md`);
    const sourcePath = testInfo.outputPath(`${marker}-checkpoint.rs`);
    let target: LiveExternalTarget | undefined;
    let feedbackAttachmentId = '';

    await generateProofImage(
      page,
      screenshotPath,
      'WORK IN PROGRESS',
      'EXPECTED ORIENTATION: EAST',
      '#d97706',
    );
    await generateProofImage(
      page,
      feedbackPath,
      'OPERATOR FEEDBACK',
      'TOKEN: RV_CAMPAIGN_FEEDBACK_6659 · COLOR: MAGENTA · NUMBER: 47',
      '#d946ef',
    );
    await writeFile(
      markdownPath,
      '# Campaign checkpoint\n\nRV_CAMPAIGN_MARKDOWN_6659\n',
      'utf8',
    );
    await writeFile(
      sourcePath,
      'pub const CAMPAIGN_CHECKPOINT: &str = "RV_CAMPAIGN_RUST_6659";\n',
      'utf8',
    );
    const feedbackBytes = await readFile(feedbackPath);
    const feedbackSha256 = createHash('sha256')
      .update(feedbackBytes)
      .digest('hex');

    try {
      await openExternalAgents(page, backend);
      await createExternalSession(page, marker);
      const row = page.getByTestId('external-agent-row').filter({
        hasText: marker,
      });
      await expect(row).toBeVisible({ timeout: 60_000 });
      const threadId = (await row.getAttribute('data-thread-id')) ?? '';
      expect(threadId).not.toBe('');
      target = await bindingForThread(request, threadId);
      await row.click();

      await sendAutoPrompt(
        page,
        [
          `Inspect ${screenshotPath} with view_image and read ${markdownPath} and ${sourcePath}.`,
          'Then send one commentary update containing this exact block:',
          '7. Screenshot checked',
          '8. Documents ready',
          `[Markdown checkpoint](${markdownPath})`,
          `[Rust checkpoint](${sourcePath})`,
          'Immediately after the commentary, run the exact shell command sleep 45.',
          'During the sleep the operator will send image feedback. After sleep, reply with the exact TOKEN, COLOR, and NUMBER shown in that feedback image.',
        ].join('\n'),
      );

      const turnStatus = page.getByTestId('external-turn-status');
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active', {
        timeout: 45_000,
      });
      await expect(page.getByTestId('external-media-group')).toHaveCount(1, {
        timeout: 3 * 60_000,
      });
      await expect(page.getByTestId('external-document-card')).toHaveCount(2, {
        timeout: 3 * 60_000,
      });
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active');
      await expect(
        page
          .locator('rv-message-block ol[start="7"]')
          .filter({ hasText: 'Screenshot checked' }),
      ).toContainText('Documents ready');
      await openCheckpoint(page, 0, 'RV_CAMPAIGN_MARKDOWN_6659');
      await openCheckpoint(page, 1, 'RV_CAMPAIGN_RUST_6659');
      await page
        .getByTestId('external-media-group')
        .locator('.rv-attachment__image-button')
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');

      feedbackAttachmentId = await pasteImage(page, feedbackBytes);
      const delivery = await sendAutoPrompt(
        page,
        `${marker}: the attached image is the operator correction. Use it when the current turn resumes.`,
      );
      expect(delivery.imageAttachmentIds).toEqual([feedbackAttachmentId]);
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active');

      const answer = page
        .locator('[data-message-role="assistant"]')
        .filter({ hasText: 'RV_CAMPAIGN_FEEDBACK_6659' })
        .last();
      await expect(answer).toContainText('MAGENTA', { timeout: 3 * 60_000 });
      await expect(answer).toContainText('47');
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'completed', {
        timeout: 3 * 60_000,
      });

      const steeredUser = page
        .locator('[data-message-role="user"]')
        .filter({ hasText: marker })
        .last();
      await expectLoadedImage(steeredUser.locator('.rv-attachment__image'));
      const thread = await readThread(request, target);
      const inputImage = thread.turns
        .flatMap((turn) => turn.items)
        .flatMap((item) => item.inputImages ?? [])
        .find((image) => image.attachmentId === feedbackAttachmentId);
      expect(inputImage?.sha256).toBe(feedbackSha256);

      const evidence = await artifactEvidence(request, target);
      expect(evidence.media).toHaveLength(1);
      expect(evidence.documents).toHaveLength(2);
      console.log(
        JSON.stringify({
          marker,
          crewHead: '179b6266c70406c21052800ad40a896752148477',
          viewHead: process.env['RV_VIEW_HEAD'] ?? 'unknown',
          runtimeId: target.runtimeId,
          bindingId: target.bindingId,
          sessionId: target.sessionId,
          nativeThreadId: target.threadId,
          nativeTurnId: thread.turns[0]?.turnId,
          feedbackAttachmentId,
          feedbackSha256,
          deliveryId: delivery.deliveryId,
          evidence,
        }),
      );

      await page.reload();
      await selectSession(page, backend, marker);
      await expect(page.getByTestId('external-media-group')).toHaveCount(1);
      await expect(page.getByTestId('external-document-card')).toHaveCount(2);
      await expectLoadedImage(
        page
          .locator('[data-message-role="user"]')
          .filter({ hasText: marker })
          .last()
          .locator('.rv-attachment__image'),
      );

      await proveLanReplay(browser, marker);
    } finally {
      if (target !== undefined && feedbackAttachmentId !== '') {
        await removeAttachment(request, target.sessionId, feedbackAttachmentId);
      }
      if (target !== undefined) await deleteThread(request, target);
    }
  });
});

async function createExternalSession(
  page: Page,
  marker: string,
): Promise<void> {
  await page.getByTestId('external-agent-create').click();
  await page.getByTestId('agent-create-mode-codex').click();
  await page.getByLabel(/session profile/i).selectOption(profile);
  await page.getByPlaceholder('/home/dev/project').fill('/home/dev/rusty-view');
  await page.getByPlaceholder('Optional session name').fill(marker);
  await page.getByLabel('Den project').fill('rusty-crew');
  await page.getByLabel('Task').fill('6659');
  await page.getByTestId('external-agent-create-submit').click();
}

async function generateProofImage(
  page: Page,
  path: string,
  heading: string,
  detail: string,
  color: string,
): Promise<void> {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.setContent(
    `<main style="box-sizing:border-box;width:100vw;height:100vh;padding:58px;background:#071923;color:#f5f7fa;font:700 32px/1.5 sans-serif"><div style="border:10px solid ${color};padding:38px"><h1>${heading}</h1><p>${detail}</p></div></main>`,
  );
  await page.screenshot({ path });
}

async function pasteImage(page: Page, bytes: Buffer): Promise<string> {
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/attachments/upload'),
  );
  const prevented = await page
    .getByTestId('message-input-field')
    .evaluate((textarea, encoded) => {
      const data = Uint8Array.from(atob(encoded), (value) =>
        value.charCodeAt(0),
      );
      const clipboard = new DataTransfer();
      clipboard.items.add(
        new File([data], 'campaign-feedback.png', { type: 'image/png' }),
      );
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      });
      textarea.dispatchEvent(event);
      return event.defaultPrevented;
    }, bytes.toString('base64'));
  expect(prevented).toBe(true);
  const response = await upload;
  expect(response.ok()).toBe(true);
  const attachment = asRecord((await responseData(response))['attachment']);
  const id = String(attachment['attachment_id'] ?? '');
  expect(id).not.toBe('');
  await expect(page.getByTestId('message-attachment-chip')).toHaveCount(1);
  return id;
}

async function sendAutoPrompt(
  page: Page,
  prompt: string,
): Promise<{
  readonly deliveryId: string;
  readonly imageAttachmentIds: unknown;
}> {
  await page.getByLabel('External message mode').selectOption('auto');
  await page.getByTestId('message-input-field').fill(prompt);
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/messages'),
  );
  await page.getByTestId('send-message').click();
  const response = await sent;
  expect(response.ok()).toBe(true);
  const data = await responseData(response);
  const request = asRecord(data['request']);
  return {
    deliveryId: String(request['deliveryId'] ?? ''),
    imageAttachmentIds: request['imageAttachmentIds'],
  };
}

async function openExternalAgents(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/?api=${encodeURIComponent(origin)}`);
  await expect(page.getByTestId('external-agents-tab')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('external-agents-tab').click();
}

async function selectSession(
  page: Page,
  origin: string,
  marker: string,
): Promise<void> {
  await openExternalAgents(page, origin);
  const row = page
    .getByTestId('external-agent-row')
    .filter({ hasText: marker });
  await expect(row).toBeVisible({ timeout: 45_000 });
  await row.click();
}

async function openCheckpoint(
  page: Page,
  index: number,
  token: string,
): Promise<void> {
  await page
    .getByTestId('external-document-card')
    .nth(index)
    .locator('.rv-document__open')
    .click();
  const viewer = page.getByTestId('external-document-viewer');
  await expect(viewer).toContainText(token);
  await viewer.getByRole('button', { name: 'Close' }).click();
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

interface ThreadProjection {
  readonly turns: Array<{
    readonly turnId: string;
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

async function artifactEvidence(
  request: APIRequestContext,
  target: LiveExternalTarget,
): Promise<{ readonly media: string[]; readonly documents: string[] }> {
  const response = await request.get(
    `${backend}/v1/external-runtimes/${encodeURIComponent(target.runtimeId)}/events?native_thread_id=${encodeURIComponent(target.threadId)}&limit=1000`,
  );
  expect(response.ok()).toBe(true);
  const events = (await responseData(response))['events'];
  if (!Array.isArray(events)) throw new Error('runtime events are missing');
  const media = new Set<string>();
  const documents = new Set<string>();
  for (const eventValue of events) {
    const payload = asRecord(asRecord(eventValue)['payload']);
    for (const value of Array.isArray(payload['media'])
      ? payload['media']
      : []) {
      const id = asRecord(value)['attachmentId'];
      if (typeof id === 'string') media.add(id);
    }
    for (const value of Array.isArray(payload['documents'])
      ? payload['documents']
      : []) {
      const id = asRecord(value)['attachmentId'];
      if (typeof id === 'string') documents.add(id);
    }
  }
  return { media: [...media], documents: [...documents] };
}

async function proveLanReplay(browser: Browser, marker: string): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await selectSession(page, lanBackend, marker);
    await expect(page.getByTestId('external-media-group')).toHaveCount(1);
    await expect(page.getByTestId('external-document-card')).toHaveCount(2);
    await openCheckpoint(page, 0, 'RV_CAMPAIGN_MARKDOWN_6659');
    await openCheckpoint(page, 1, 'RV_CAMPAIGN_RUST_6659');
    await expectLoadedImage(
      page
        .locator('[data-message-role="user"]')
        .filter({ hasText: marker })
        .last()
        .locator('.rv-attachment__image'),
    );
    await expect(
      page
        .locator('[data-message-role="assistant"]')
        .filter({ hasText: 'RV_CAMPAIGN_FEEDBACK_6659' })
        .last(),
    ).toContainText('MAGENTA');
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
      { timeout: 3 * 60_000 },
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

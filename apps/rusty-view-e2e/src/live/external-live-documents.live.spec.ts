import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {
  APIRequestContext,
  APIResponse,
  Browser,
  Page,
} from '@playwright/test';

const live = process.env['RV_EXTERNAL_DOCUMENT_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const lanBackend = process.env['RV_LIVE_LAN_URL'] ?? 'http://192.168.1.22:9348';
const profile = process.env['RV_LIVE_PROFILE'] ?? 'rv-6699-dynamic-tool-cert';

test.describe('external live document checkpoints @live-agent @documents', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_DOCUMENT_LIVE_RUN=1 for the real Crew document scenario',
  );

  test('opens immutable Markdown and source revisions during the turn, refresh, and LAN replay', async ({
    browser,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(10 * 60_000);
    page.setDefaultTimeout(30_000);
    const marker = `RV_DOCUMENT_${Date.now()}`;
    const markdownPath = testInfo.outputPath(`${marker}-checkpoint.md`);
    const sourcePath = testInfo.outputPath(`${marker}-checkpoint.rs`);
    let target: LiveExternalTarget | undefined;

    await writeCheckpointFiles(markdownPath, sourcePath, 'V1');
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
      await page.getByLabel('Task').fill('6725');
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
          'First read both checkpoint files.',
          'Then send a commentary progress update containing exactly these two Markdown links on separate lines:',
          `[Markdown checkpoint](${markdownPath})`,
          `[Rust checkpoint](${sourcePath})`,
          'Immediately after that commentary, run the exact shell command sleep 30.',
          'Only after sleep completes, send a short final response.',
        ].join('\n'),
      );
      const turnStatus = page.getByTestId('external-turn-status');
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active', {
        timeout: 45_000,
      });
      const cards = page.getByTestId('external-document-card');
      await expect(cards).toHaveCount(2, { timeout: 3 * 60_000 });
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active');
      await expectCheckpoint(page, 0, 'RV_DOCUMENT_MARKDOWN_V1');
      await expectCheckpoint(page, 1, 'RV_DOCUMENT_RUST_V1');

      await writeCheckpointFiles(markdownPath, sourcePath, 'V2');
      await page.reload();
      await openExternalAgents(page, backend);
      const recovered = page.getByTestId('external-agent-row').filter({
        hasText: marker,
      });
      await recovered.click();
      await expect(page.getByTestId('external-document-card')).toHaveCount(2, {
        timeout: 45_000,
      });
      await expectCheckpoint(page, 0, 'RV_DOCUMENT_MARKDOWN_V1');
      await expectCheckpoint(page, 1, 'RV_DOCUMENT_RUST_V1');
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'completed', {
        timeout: 2 * 60_000,
      });

      await sendAutoPrompt(
        page,
        [
          'Reply with exactly these two Markdown links on separate lines:',
          `[Markdown checkpoint V2](${markdownPath})`,
          `[Rust checkpoint V2](${sourcePath})`,
          'Do not mention another local path.',
        ].join('\n'),
      );
      await expect(page.getByTestId('external-document-card')).toHaveCount(4, {
        timeout: 2 * 60_000,
      });
      await expectCheckpoint(page, 0, 'RV_DOCUMENT_MARKDOWN_V1');
      await expectCheckpoint(page, 1, 'RV_DOCUMENT_RUST_V1');
      await expectCheckpoint(page, 2, 'RV_DOCUMENT_MARKDOWN_V2');
      await expectCheckpoint(page, 3, 'RV_DOCUMENT_RUST_V2');

      const evidence = await documentEvidenceForThread(request, target);
      expect(evidence).toHaveLength(4);
      expect(new Set(evidence.map((item) => item.attachmentId)).size).toBe(4);
      console.log(JSON.stringify({ marker, evidence }));

      await proveLanReplay(browser, marker);
    } finally {
      if (target !== undefined) await deleteThread(request, target);
    }
  });
});

async function writeCheckpointFiles(
  markdownPath: string,
  sourcePath: string,
  revision: 'V1' | 'V2',
): Promise<void> {
  await writeFile(
    markdownPath,
    `# Live checkpoint\n\nRV_DOCUMENT_MARKDOWN_${revision}\n`,
    'utf8',
  );
  await writeFile(
    sourcePath,
    `pub const CHECKPOINT: &str = "RV_DOCUMENT_RUST_${revision}";\n`,
    'utf8',
  );
}

async function openExternalAgents(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/?api=${encodeURIComponent(origin)}`);
  await expect(page.getByTestId('external-agents-tab')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('external-agents-tab').click();
}

async function sendAutoPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByLabel('External message mode').selectOption('auto');
  await page.getByTestId('message-input-field').fill(prompt);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/messages'),
  );
  await page.getByTestId('send-message').click();
  expect((await responsePromise).ok()).toBe(true);
}

async function expectCheckpoint(
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
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText(token);
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toBeHidden();
}

interface LiveExternalTarget {
  readonly runtimeId: string;
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
  return { runtimeId: String(binding['runtimeId']), threadId };
}

interface DocumentEvidence {
  readonly sequenceId: number;
  readonly attachmentId: string;
  readonly documentIndex: number;
  readonly sha256: string;
}

async function documentEvidenceForThread(
  request: APIRequestContext,
  target: LiveExternalTarget,
): Promise<readonly DocumentEvidence[]> {
  const response = await request.get(
    `${backend}/v1/external-runtimes/${encodeURIComponent(target.runtimeId)}/events?native_thread_id=${encodeURIComponent(target.threadId)}&limit=1000`,
  );
  expect(response.ok()).toBe(true);
  const events = (await responseData(response))['events'];
  if (!Array.isArray(events)) throw new Error('runtime events are missing');
  const projected = events.map(asRecord).flatMap((event) => {
    const documents = asRecord(event['payload'])['documents'];
    if (!Array.isArray(documents)) return [];
    return documents.map((value) => {
      const reference = asRecord(value);
      return {
        sequenceId: Number(event['sequenceId']),
        attachmentId: String(reference['attachmentId']),
        documentIndex: Number(reference['documentIndex']),
        sha256: String(reference['sha256']),
      };
    });
  });
  const firstByAttachment = new Map<string, DocumentEvidence>();
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
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
    page.on('requestfailed', (request) =>
      failures.push(
        `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
      ),
    );
    await openExternalAgents(page, lanBackend);
    const row = page
      .getByTestId('external-agent-row')
      .filter({ hasText: marker });
    await expect(row).toBeVisible({ timeout: 45_000 });
    await expect(row).toHaveAttribute('data-thread-id', /\S+/);
    const threadId = await row.evaluate((element) =>
      element.getAttribute('data-thread-id'),
    );
    expect(threadId).toBeTruthy();
    const historyResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname.endsWith('/events') &&
        url.searchParams.get('native_thread_id') === threadId &&
        url.searchParams.get('after') === null
      );
    });
    await row.click();
    await expect(row).toHaveClass(/rv-agent--selected/);
    const replay = await historyResponse;
    expect(replay.ok()).toBe(true);
    const replayEvents = asRecord(
      asRecord((await replay.json()) as unknown)['data'],
    )['events'];
    expect(Array.isArray(replayEvents)).toBe(true);
    expect(
      Array.isArray(replayEvents)
        ? replayEvents.filter((event) =>
            Array.isArray(asRecord(asRecord(event)['payload'])['documents']),
          ).length
        : 0,
    ).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('external-document-card')).toHaveCount(4, {
      timeout: 45_000,
    });
    await expectCheckpoint(page, 0, 'RV_DOCUMENT_MARKDOWN_V1');
    await expectCheckpoint(page, 1, 'RV_DOCUMENT_RUST_V1');
    expect(failures).toEqual([]);
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

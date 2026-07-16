import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const live = process.env['RV_EXTERNAL_AUTHORITY_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('external message authority @live-agent @authority', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_AUTHORITY_LIVE_RUN=1 for the real Crew authority scenario',
  );

  test('keeps auto delivery in Crew and exposes a stale explicit steer rejection', async ({
    page,
    request,
  }) => {
    test.setTimeout(6 * 60_000);
    const marker = `RV_AUTHORITY_${Date.now()}`;
    let target: LiveExternalTarget | undefined;

    try {
      await page.goto(`/?api=${encodeURIComponent(backend)}`);
      await page.getByTestId('external-agents-tab').click();
      await page.getByTestId('external-agent-create').click();
      await page
        .getByLabel('Codex session profile')
        .selectOption({ label: 'Live Tester' });
      await page
        .getByPlaceholder('/home/dev/project')
        .fill('/home/dev/rusty-view');
      await page.getByPlaceholder('Optional session name').fill(marker);
      await page.getByTestId('external-agent-create-submit').click();

      const row = page
        .getByTestId('external-agent-row')
        .filter({ hasText: marker });
      await expect(row).toBeVisible({ timeout: 45_000 });
      const threadId = await row.evaluate((element) =>
        element.getAttribute('data-thread-id'),
      );
      expect(threadId).toBeTruthy();
      target = await bindingForThread(request, threadId ?? '');
      await row.click();

      const firstMarker = `${marker}_FIRST`;
      const firstReceipt = await sendAutoPrompt(
        page,
        `Reply exactly ${firstMarker} and nothing else. Do not use tools.`,
      );
      expect(firstReceipt.status).toMatch(/^(accepted|pending)$/);
      expect(firstReceipt.deliveryId).toBeTruthy();
      await expect(page.getByTestId('transcript-shell')).toContainText(
        firstMarker,
        { timeout: 2 * 60_000 },
      );
      await expect(page.getByTestId('external-turn-status')).toHaveAttribute(
        'data-turn-phase',
        'completed',
        { timeout: 2 * 60_000 },
      );

      const secondMarker = `${marker}_SECOND`;
      const secondReceipt = await sendAutoPrompt(
        page,
        `Reply exactly ${secondMarker} and nothing else. Do not use tools.`,
      );
      expect(secondReceipt.status).toMatch(/^(accepted|pending)$/);
      expect(secondReceipt.deliveryId).toBeTruthy();
      expect(secondReceipt.deliveryId).not.toBe(firstReceipt.deliveryId);
      await expect(page.getByTestId('transcript-shell')).toContainText(
        secondMarker,
        { timeout: 2 * 60_000 },
      );
      await expect(page.getByTestId('external-turn-status')).toHaveAttribute(
        'data-turn-phase',
        'completed',
        { timeout: 2 * 60_000 },
      );

      await sendAutoPrompt(
        page,
        [
          'Run this shell command now: sleep 20.',
          `After it finishes reply exactly ${marker}_SLEEP_DONE.`,
        ].join(' '),
      );
      const turnStatus = page.getByTestId('external-turn-status');
      await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active', {
        timeout: 45_000,
      });
      const staleTurnId = await turnStatus.evaluate((element) =>
        element.getAttribute('data-active-turn-id'),
      );
      expect(staleTurnId).toBeTruthy();

      await page.context().setOffline(true);
      const interrupt = await request.post(
        `${backend}/v1/external-bindings/${encodeURIComponent(target.bindingId)}/controls`,
        {
          data: {
            kind: 'interrupt_turn',
            expectedNativeTurnId: staleTurnId,
            payload: { threadId: target.threadId, turnId: staleTurnId },
          },
        },
      );
      if (interrupt.ok()) {
        await expect
          .poll(
            async () =>
              await turnStatusFromCrew(
                request,
                target?.runtimeId ?? '',
                target?.threadId ?? '',
                staleTurnId ?? '',
              ),
            { timeout: 60_000 },
          )
          .toMatch(/^(completed|failed|interrupted)$/);
      } else {
        const interruptBody = asRecord(await interrupt.json());
        expect(
          String(asRecord(interruptBody['error'])['reason_code']),
        ).not.toBe('undefined');
      }

      await page.getByLabel('External message mode').selectOption('steer');
      await page
        .getByTestId('message-input-field')
        .fill(`${marker}_STALE_STEER`);
      await page.context().setOffline(false);
      const staleResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith(
            `/external-bindings/${target?.bindingId ?? ''}/controls`,
          ),
      );
      await page.getByTestId('send-message').click();
      const staleResponse = await staleResponsePromise;
      const staleBody = asRecord(await staleResponse.json());
      const staleError = asRecord(staleBody['error']);
      const staleReceipt = asRecord(staleBody['data']);
      const staleReason = String(
        staleError['reason_code'] ?? staleReceipt['reasonCode'],
      );
      expect(staleReason).not.toBe('undefined');
      expect(
        staleResponse.status() >= 400 ||
          ['rejected', 'failed'].includes(String(staleReceipt['status'])),
      ).toBe(true);

      const stalePrompt = page
        .locator('.rv-message--user')
        .filter({ hasText: `${marker}_STALE_STEER` });
      await expect(stalePrompt).toHaveAttribute('data-message-status', 'error');
      const inspector = stalePrompt.getByTestId('message-delivery-failure');
      await expect(inspector).toContainText(staleReason);
      if (staleResponse.status() >= 400) {
        await expect(inspector).toContainText(
          `HTTP status${staleResponse.status()}`,
        );
      }
      await expect(inspector).toContainText(
        `/v1/external-bindings/${target.bindingId}/controls`,
      );
    } finally {
      await page.context().setOffline(false);
      if (target !== undefined) await deleteThread(request, target);
    }
  });
});

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
  const body = asRecord(await response.json());
  const data = asRecord(body['data']);
  const request = asRecord(data['request']);
  return {
    status: String(data['status']),
    ...(typeof request['deliveryId'] === 'string'
      ? { deliveryId: request['deliveryId'] }
      : typeof data['deliveryId'] === 'string'
        ? { deliveryId: data['deliveryId'] }
        : {}),
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
  const body = asRecord(await response.json());
  const bindings = asRecord(body['data'])['bindings'];
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

async function turnStatusFromCrew(
  request: APIRequestContext,
  runtimeId: string,
  threadId: string,
  turnId: string,
): Promise<string> {
  const response = await request.post(
    `${backend}/v1/external-runtimes/${encodeURIComponent(runtimeId)}/threads/read`,
    { data: { threadId, includeTurns: true } },
  );
  expect(response.ok()).toBe(true);
  const body = asRecord(await response.json());
  const thread = asRecord(asRecord(body['data'])['thread']);
  const turns = thread['turns'];
  if (!Array.isArray(turns)) return 'missing';
  return String(
    turns.map(asRecord).find((turn) => turn['turnId'] === turnId)?.['status'] ??
      'missing',
  );
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

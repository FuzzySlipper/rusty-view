import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

const live = process.env['RV_EXTERNAL_COMMANDS_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('external agent commands @live-agent @commands', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_COMMANDS_LIVE_RUN=1 for the real Crew command API scenario',
  );

  test('routes status and same-value settings through Crew without a Codex user turn', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(3 * 60_000);
    const target = await commandTarget(request);
    const before = await readThread(request, target.runtimeId, target.threadId);
    let commandPosts = 0;
    let messagePosts = 0;
    page.on('request', (browserRequest) => {
      if (browserRequest.method() !== 'POST') return;
      const pathname = new URL(browserRequest.url()).pathname;
      if (pathname.endsWith(`/external-bindings/${target.bindingId}/commands`))
        commandPosts += 1;
      if (pathname.endsWith(`/external-bindings/${target.bindingId}/messages`))
        messagePosts += 1;
    });

    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();
    const row = page.locator(
      `[data-testid="external-agent-row"][data-thread-id="${target.threadId}"]`,
    );
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button').first().click();
    await expect(page.getByTestId('external-current-model')).toHaveText(
      target.model,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('external-current-effort')).toHaveText(
      target.effort,
    );

    const input = page.getByTestId('message-input-field');
    await input.fill('/model ');
    await expect(
      page
        .getByTestId('message-command-hint')
        .filter({ hasText: target.model }),
    ).toBeVisible();
    await input.fill(`/model ${target.model}`);
    await page.getByTestId('send-message').click();
    await expect(page.getByTestId('transcript-shell')).toContainText(
      `Model set to ${target.model}`,
      { timeout: 30_000 },
    );

    await input.fill('/effort ');
    await expect(
      page.getByRole('option', {
        name: new RegExp(`^effort ${escapeRegExp(target.effort)}\\b`),
      }),
    ).toBeVisible();
    await input.fill(`/effort ${target.effort}`);
    await page.getByTestId('send-message').click();
    await expect(page.getByTestId('transcript-shell')).toContainText(
      `Reasoning effort set to ${target.effort}`,
      { timeout: 30_000 },
    );

    await input.fill('/comp');
    await expect(
      page.getByTestId('message-command-hint').filter({ hasText: 'compact' }),
    ).toBeVisible();
    await input.fill('/status');
    await page.getByTestId('send-message').click();
    await expect(page.getByTestId('transcript-shell')).toContainText(
      `Runtime: ${target.runtimeId} (ready)`,
      { timeout: 30_000 },
    );

    expect(commandPosts).toBe(3);
    expect(messagePosts).toBe(0);
    const after = await readThread(request, target.runtimeId, target.threadId);
    expect(threadSignature(after)).toEqual(threadSignature(before));

    await page.reload();
    await page.getByTestId('external-agents-tab').click();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button').first().click();
    await expect(page.getByTestId('transcript-shell')).toContainText(
      `Runtime: ${target.runtimeId} (ready)`,
      { timeout: 30_000 },
    );
    await page.screenshot({
      path: testInfo.outputPath('external-command-status-replayed.png'),
      fullPage: true,
    });
  });
});

async function commandTarget(request: APIRequestContext) {
  const bindingId = process.env['RV_EXTERNAL_COMMAND_BINDING_ID'];
  const bindingsResponse = await request.get(`${backend}/v1/external-bindings`);
  expect(bindingsResponse.ok()).toBe(true);
  const bindings = (await bindingsResponse.json()) as {
    data: {
      bindings: Array<{
        bindingId: string;
        runtimeId: string;
        nativeThreadId?: string | null;
        status: string;
      }>;
    };
  };
  const candidates = bindings.data.bindings.filter(
    (candidate) =>
      candidate.nativeThreadId != null &&
      candidate.status === 'active' &&
      (bindingId === undefined || candidate.bindingId === bindingId),
  );
  let binding = candidates[0];
  let catalogResponse: APIResponse | undefined;
  for (const candidate of candidates) {
    const response = await request.get(
      `${backend}/v1/external-bindings/${encodeURIComponent(candidate.bindingId)}/commands`,
    );
    if (!response.ok()) continue;
    binding = candidate;
    catalogResponse = response;
    break;
  }
  expect(binding, 'an active command-capable external binding').toBeDefined();
  expect(catalogResponse?.ok()).toBe(true);
  if (binding === undefined || catalogResponse === undefined) {
    throw new Error('No active command-capable external binding was found.');
  }
  const catalog = (await catalogResponse.json()) as {
    data: { settings: { model: string; effort: string | null } };
  };
  return {
    bindingId: binding.bindingId,
    runtimeId: binding.runtimeId,
    threadId: binding.nativeThreadId ?? '',
    model: catalog.data.settings.model,
    effort: catalog.data.settings.effort ?? 'medium',
  };
}

async function readThread(
  request: APIRequestContext,
  runtimeId: string,
  threadId: string,
) {
  const response = await request.post(
    `${backend}/v1/external-runtimes/${encodeURIComponent(runtimeId)}/threads/read`,
    { data: { threadId, includeTurns: true } },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    data: {
      thread: {
        turns: Array<{ turnId: string; items: Array<{ itemId: string }> }>;
      };
    };
  };
}

function threadSignature(value: Awaited<ReturnType<typeof readThread>>) {
  return value.data.thread.turns.map((turn) => ({
    turnId: turn.turnId,
    itemIds: turn.items.map((item) => item.itemId),
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

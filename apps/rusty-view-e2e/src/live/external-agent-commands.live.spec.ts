import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

const live = process.env['RV_EXTERNAL_COMMANDS_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('external agent commands @live-agent @commands', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_COMMANDS_LIVE_RUN=1 for the real Crew command API scenario',
  );

  test('routes commands separately and carries live settings into the next Codex turn', async ({
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

    try {
      await input.fill('/effort ');
      await expect(
        page.getByRole('option', {
          name: new RegExp(
            `^effort ${escapeRegExp(target.alternateEffort)}\\b`,
          ),
        }),
      ).toBeVisible();
      await input.fill(`/effort ${target.alternateEffort}`);
      await page.getByTestId('send-message').click();
      await expect(page.getByTestId('transcript-shell')).toContainText(
        `Reasoning effort set to ${target.alternateEffort}`,
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('external-current-effort')).toHaveText(
        target.alternateEffort,
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
      const afterCommands = await readThread(
        request,
        target.runtimeId,
        target.threadId,
      );
      expect(threadSignature(afterCommands)).toEqual(threadSignature(before));

      const marker = `RV_EXTERNAL_SETTINGS_${Date.now()}`;
      await input.fill(`Reply with exactly ${marker} and nothing else.`);
      await page.getByTestId('send-message').click();
      await expect
        .poll(
          async () => {
            const projection = await readThread(
              request,
              target.runtimeId,
              target.threadId,
            );
            return projection.data.thread.turns.length;
          },
          { timeout: 2 * 60_000 },
        )
        .toBe(before.data.thread.turns.length + 1);
      await expect
        .poll(
          async () => {
            const projection = await readThread(
              request,
              target.runtimeId,
              target.threadId,
            );
            return projection.data.thread.turns.at(-1)?.status;
          },
          { timeout: 2 * 60_000 },
        )
        .toBe('completed');
      expect(commandPosts).toBe(3);
      expect(messagePosts).toBe(1);
      const settingsAfterTurn = await readCatalog(request, target.bindingId);
      expect(settingsAfterTurn.settings.effort).toBe(target.alternateEffort);
      const afterTurn = await readThread(
        request,
        target.runtimeId,
        target.threadId,
      );
      expect(afterTurn.data.thread.turns).toHaveLength(
        before.data.thread.turns.length + 1,
      );
      expect(afterTurn.data.thread.turns.at(-1)?.items).toEqual([
        expect.objectContaining({
          kind: 'userMessage',
          text: expect.stringContaining(marker),
        }),
        expect.objectContaining({ kind: 'agentMessage', text: marker }),
      ]);
      await expect(page.getByTestId('external-turn-status')).toHaveAttribute(
        'data-turn-phase',
        'completed',
      );

      await page.reload();
      await page.getByTestId('external-agents-tab').click();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole('button').first().click();
      await expect(page.getByTestId('external-current-effort')).toHaveText(
        target.alternateEffort,
        { timeout: 30_000 },
      );
      await page.screenshot({
        path: testInfo.outputPath('external-command-settings-replayed.png'),
        fullPage: true,
      });
    } finally {
      await restoreEffort(request, target.bindingId, target.effort);
    }
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
  const catalog = (await catalogResponse.json()) as CommandCatalogEnvelope;
  const model = catalog.data.models.find(
    (candidate) =>
      candidate.id === catalog.data.settings.model ||
      candidate.model === catalog.data.settings.model,
  );
  const effort = catalog.data.settings.effort;
  expect(
    effort,
    'the selected live thread must expose an effort that can be restored',
  ).not.toBeNull();
  const alternateEffort = model?.supportedEfforts.find(
    (candidate) => candidate.value !== effort,
  )?.value;
  expect(
    alternateEffort,
    'the selected live model must advertise an alternate effort',
  ).toBeDefined();
  return {
    bindingId: binding.bindingId,
    runtimeId: binding.runtimeId,
    threadId: binding.nativeThreadId ?? '',
    model: catalog.data.settings.model,
    effort: effort ?? alternateEffort ?? 'medium',
    alternateEffort: alternateEffort ?? effort,
  };
}

interface CommandCatalogEnvelope {
  readonly data: {
    readonly settings: {
      readonly model: string;
      readonly effort: string | null;
    };
    readonly models: readonly {
      readonly id: string;
      readonly model: string;
      readonly supportedEfforts: readonly { readonly value: string }[];
    }[];
  };
}

async function readCatalog(request: APIRequestContext, bindingId: string) {
  const response = await request.get(
    `${backend}/v1/external-bindings/${encodeURIComponent(bindingId)}/commands`,
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as CommandCatalogEnvelope).data;
}

async function restoreEffort(
  request: APIRequestContext,
  bindingId: string,
  effort: string,
): Promise<void> {
  const response = await request.post(
    `${backend}/v1/external-bindings/${encodeURIComponent(bindingId)}/commands`,
    {
      data: {
        input: `/effort ${effort}`,
        idempotencyKey: `rusty-view-live-restore:${Date.now()}`,
      },
    },
  );
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as {
    readonly data: { readonly status: string; readonly message: string };
  };
  expect(result.data.status, result.data.message).toBe('applied');
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
        turns: Array<{
          turnId: string;
          status: string;
          items: Array<{ itemId: string; kind: string; text?: string }>;
        }>;
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

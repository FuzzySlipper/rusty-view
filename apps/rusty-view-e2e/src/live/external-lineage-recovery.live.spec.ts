import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const live = process.env['RV_EXTERNAL_LINEAGE_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

interface Lineage {
  readonly predecessorBindingId: string;
  readonly predecessorNativeThreadId: string;
  readonly predecessorSessionId: string;
}

interface Binding {
  readonly bindingId: string;
  readonly nativeThreadId?: string | null;
  readonly runtimeId: string;
  readonly sessionId?: string | null;
  readonly lineage: Lineage | null;
}

interface BindingEnvelope {
  readonly data: { readonly bindings: readonly Binding[] };
}

interface ThreadEnvelope {
  readonly data: {
    readonly thread: {
      readonly nativeMaterialized: boolean;
      readonly threadId: string;
      readonly turns: readonly unknown[];
    };
  };
}

test.describe('external lineage recovery @live-agent', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_LINEAGE_LIVE_RUN=1 for read-only deployed lineage proof',
  );

  test('shows a populated predecessor beside its empty replacement after reconnect', async ({
    page,
    request,
  }, testInfo) => {
    const bindingResponse = await request.get(
      `${backend}/v1/external-bindings`,
    );
    expect(bindingResponse.ok()).toBe(true);
    const bindingEnvelope: BindingEnvelope = await bindingResponse.json();
    let evidence:
      | {
          readonly predecessor: Binding;
          readonly predecessorThread: ThreadEnvelope['data']['thread'];
          readonly successor: Binding;
          readonly successorThread: ThreadEnvelope['data']['thread'];
        }
      | undefined;

    for (const successor of bindingEnvelope.data.bindings) {
      if (successor.lineage === null || successor.nativeThreadId == null) {
        continue;
      }
      const predecessor = bindingEnvelope.data.bindings.find(
        (binding) =>
          binding.bindingId === successor.lineage?.predecessorBindingId,
      );
      if (predecessor?.nativeThreadId == null) continue;
      const predecessorRead = await readThread(request, predecessor);
      const successorRead = await readThread(request, successor);
      if (
        predecessorRead.turns.length > 0 &&
        successorRead.turns.length === 0
      ) {
        evidence = {
          predecessor,
          predecessorThread: predecessorRead,
          successor,
          successorThread: successorRead,
        };
        break;
      }
    }

    expect(
      evidence,
      'a populated predecessor plus empty successor is required',
    ).toBeDefined();
    if (evidence === undefined) return;
    await testInfo.attach('external-lineage-evidence.json', {
      body: JSON.stringify(
        {
          predecessorBindingId: evidence.predecessor.bindingId,
          predecessorSessionId: evidence.predecessor.sessionId,
          predecessorThreadId: evidence.predecessorThread.threadId,
          predecessorTurnCount: evidence.predecessorThread.turns.length,
          successorBindingId: evidence.successor.bindingId,
          successorSessionId: evidence.successor.sessionId,
          successorThreadId: evidence.successorThread.threadId,
          successorTurnCount: evidence.successorThread.turns.length,
          successorNativeMaterialized:
            evidence.successorThread.nativeMaterialized,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();
    await assertLineageRows(page, evidence);
    const predecessorRow = page.locator(
      `[data-testid="external-agent-row"][data-binding-id="${evidence.predecessor.bindingId}"]`,
    );
    await predecessorRow.click();
    await expect(page.getByTestId('transcript-shell')).toBeVisible();
    await expect(page.getByTestId('message-row').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('message-input-field')).toBeEnabled();

    await page.reload();
    await page.getByTestId('external-agents-tab').click();
    await assertLineageRows(page, evidence);
  });
});

async function readThread(
  request: APIRequestContext,
  binding: Binding,
): Promise<ThreadEnvelope['data']['thread']> {
  const response = await request.post(
    `${backend}/v1/external-runtimes/${encodeURIComponent(binding.runtimeId)}/threads/read`,
    {
      data: { threadId: binding.nativeThreadId, includeTurns: true },
    },
  );
  expect(response.ok()).toBe(true);
  const envelope: ThreadEnvelope = await response.json();
  return envelope.data.thread;
}

async function assertLineageRows(
  page: Page,
  evidence: {
    readonly predecessor: Binding;
    readonly successor: Binding;
  },
): Promise<void> {
  const predecessor = page.locator(
    `[data-testid="external-agent-row"][data-binding-id="${evidence.predecessor.bindingId}"]`,
  );
  const successor = page.locator(
    `[data-testid="external-agent-row"][data-binding-id="${evidence.successor.bindingId}"]`,
  );
  await expect(predecessor).toBeVisible({ timeout: 30_000 });
  await expect(predecessor).toContainText('Recovered predecessor');
  await expect(successor).toBeVisible();
  await expect(successor).toContainText('replacement');
  await expect(successor).toContainText('predecessor history preserved');
}

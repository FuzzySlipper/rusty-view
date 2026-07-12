import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const live = process.env['RV_EXTERNAL_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const peerBindingId =
  process.env['RV_EXTERNAL_PEER_BINDING_ID'] ?? 'rv-codex-5516-b-binding';

test.describe('external agent console @live-agent', () => {
  test.skip(
    !live,
    'set RV_EXTERNAL_LIVE_RUN=1 for the real Codex app-server scenario',
  );

  test('completes a Den-mapped edit, steers, interrupts a peer, and recovers after refresh', async ({
    page,
  }, testInfo) => {
    test.setTimeout(8 * 60_000);
    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();

    const search = page.getByLabel('Search loaded agent sessions');
    await search.fill('5516');
    const primary = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5516' })
      .first();
    await expect(primary).toBeVisible({ timeout: 30_000 });
    await expect(primary).toHaveAttribute('data-thread-id', /.+/);
    const primaryThreadId = await primary.evaluate((element) =>
      element.getAttribute('data-thread-id'),
    );
    expect(primaryThreadId).toBeTruthy();
    await primary.click();

    const prompt = [
      'Work Den task 5664 now.',
      'Its canonical Den project_id is rusty-view (the local bootstrap text naming rusty-crew does not match this task record).',
      'Read its exact scope from Den and obey it narrowly.',
      `Your native thread id is ${primaryThreadId}.`,
      'Use plan updates, inspect the current Rusty View external-agent implementation, create only the requested certification markdown file, run the requested Prettier check, and post the Den completion handoff.',
      'Do not commit or push.',
    ].join(' ');
    await page.getByTestId('message-input-field').fill(prompt);
    await page.getByTestId('send-message').click();
    const turnStatus = page.getByTestId('external-turn-status');
    await expect(turnStatus).toHaveAttribute('data-turn-phase', 'active', {
      timeout: 45_000,
    });
    await expect(turnStatus).toHaveAttribute('data-active-turn-id', /.+/);
    const primaryTurnId = await turnStatus.evaluate((element) =>
      element.getAttribute('data-active-turn-id'),
    );
    expect(primaryTurnId).toBeTruthy();

    await page
      .getByTestId('message-input-field')
      .fill(
        'Steer: include one sentence confirming that agent fleet attention remains visible independently of the selected transcript, then continue the same task.',
      );
    await page.getByTestId('send-message').click();

    await expect(turnStatus).not.toHaveAttribute(
      'data-active-turn-id',
      primaryTurnId ?? '',
      { timeout: 5 * 60_000 },
    );
    await expect(turnStatus).toHaveAttribute('data-turn-phase', 'completed');
    await revealTranscriptBlock(page, 'pnpm exec prettier', 'command');
    await revealCertificationFileChange(page);
    expect(await revealTranscriptBlock(page, 'Plan updated', 'plan')).toBe(
      'completed',
    );
    expect(
      await revealTranscriptBlock(page, 'Aggregate diff', 'file_change'),
    ).toBe('completed');
    await inspectRawDiffEvent(page);
    await page.screenshot({
      path: testInfo.outputPath('01-primary-completed.png'),
      fullPage: true,
    });

    await search.fill('5529');
    const peer = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5529' })
      .first();
    await expect(peer).toBeVisible();
    await peer.click();
    await page
      .getByTestId('message-input-field')
      .fill(
        'Run a shell command that sleeps for 45 seconds, then report PEER_SHOULD_HAVE_BEEN_INTERRUPTED. Start immediately.',
      );
    await page.getByTestId('send-message').click();
    await expect(page.getByTestId('external-interrupt')).toBeEnabled({
      timeout: 45_000,
    });
    await page.getByTestId('external-interrupt').click();
    await expect(page.getByTestId('external-turn-status')).toHaveAttribute(
      'data-turn-phase',
      'interrupted',
      { timeout: 60_000 },
    );

    await search.clear();
    const completedPrimary = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5516' })
      .first();
    await completedPrimary.click();
    await expect(completedPrimary).toHaveAttribute('data-status', 'completed', {
      timeout: 60_000,
    });
    await expect(peer).toHaveAttribute('data-status', 'interrupted', {
      timeout: 30_000,
    });
    await expect(peer).toContainText('attention');
    await page.screenshot({
      path: testInfo.outputPath('02-peer-interrupted.png'),
      fullPage: true,
    });

    await page.reload();
    await page.getByTestId('external-agents-tab').click();
    await search.fill('5516');
    const recovered = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5516' })
      .first();
    await expect(recovered).toHaveAttribute(
      'data-thread-id',
      primaryThreadId ?? '',
    );
    await recovered.click();
    await expect(page.getByTestId('external-turn-status')).toHaveAttribute(
      'data-turn-phase',
      'completed',
      { timeout: 30_000 },
    );
    await revealCertificationFileChange(page);
    expect(await revealTranscriptBlock(page, 'Plan updated', 'plan')).toBe(
      'completed',
    );
    expect(
      await revealTranscriptBlock(page, 'Aggregate diff', 'file_change'),
    ).toBe('completed');
    await inspectRawDiffEvent(page);
    await page.screenshot({
      path: testInfo.outputPath('03-refresh-recovered.png'),
      fullPage: true,
    });
  });

  test('projects a fresh real plan and aggregate diff with raw detail', async ({
    page,
  }, testInfo) => {
    test.setTimeout(5 * 60_000);
    await startFreshExternalThread(backend, peerBindingId);
    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();
    const search = page.getByLabel('Search loaded agent sessions');
    await search.fill('5529');
    const row = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5529' })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    const status = page.getByTestId('external-turn-status');
    await expect(status).toBeVisible();
    const temporaryPath = `.rv-live-projection-${Date.now()}.txt`;
    await page
      .getByTestId('message-input-field')
      .fill(
        [
          'Run a non-destructive live UI projection check.',
          'Use update_plan with at least two steps.',
          `Use the apply_patch tool, not a shell command, to create ${temporaryPath} under /home/dev/rusty-view with one short line. Inspect it, then use apply_patch again to delete it before finishing.`,
          'Do not modify Den, commit, or push.',
          'Finish with the exact marker RV_FRESH_DIFF_COMPLETE.',
        ].join(' '),
      );
    await page.getByTestId('send-message').click();
    await expect(status).toHaveAttribute('data-turn-phase', 'active', {
      timeout: 45_000,
    });
    const turnId = await status.evaluate((element) =>
      element.getAttribute('data-active-turn-id'),
    );
    expect(turnId).toBeTruthy();
    await expect(status).not.toHaveAttribute(
      'data-active-turn-id',
      turnId ?? '',
      { timeout: 4 * 60_000 },
    );
    await expect(status).toHaveAttribute('data-turn-phase', 'completed');
    await expect(page.getByTestId('transcript-shell')).toContainText(
      'RV_FRESH_DIFF_COMPLETE',
    );
    expect(
      await revealTranscriptBlock(
        page,
        'Plan updated',
        'plan',
        `external-event:${turnId ?? ''}:plan_delta`,
      ),
    ).toBe('completed');
    await page.screenshot({
      path: testInfo.outputPath('fresh-plan-completed.png'),
    });
    const aggregateDiffMessageId = `external-event:${turnId ?? ''}:turn_lifecycle`;
    expect(
      await revealTranscriptBlock(
        page,
        'Aggregate diff',
        'file_change',
        aggregateDiffMessageId,
      ),
    ).toBe('completed');
    const aggregateDiff = page
      .locator(
        `[data-testid="message-row"][data-message-id="${aggregateDiffMessageId}"]`,
      )
      .getByTestId('tool-call-block');
    const detailToggle = aggregateDiff.getByTestId(
      'message-block-detail-toggle',
    );
    await expect(detailToggle).toBeVisible();
    await detailToggle.click();
    await expect(
      aggregateDiff.getByTestId('message-block-detail-content'),
    ).toContainText(temporaryPath);
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({
      path: testInfo.outputPath('fresh-plan-diff-detail.png'),
    });
    await inspectRawDiffEvent(page);
    await page.screenshot({
      path: testInfo.outputPath('fresh-plan-diff-raw-detail.png'),
    });
    await inspectRawNativeEvent(
      page,
      'thread_lifecycle',
      'thread/status/changed',
    );
    await page.screenshot({
      path: testInfo.outputPath('fresh-unprojected-raw-detail.png'),
    });
  });

  test('resolves real structured input from a Plan turn and recovers it after refresh', async ({
    page,
  }, testInfo) => {
    test.setTimeout(6 * 60_000);
    let planWrite: Record<string, unknown> | undefined;
    let planResponse:
      | { readonly status: number; readonly body: unknown }
      | undefined;
    let resolutionWrite: Record<string, unknown> | undefined;
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (/\/v1\/external-bindings\/[^/]+\/messages$/.test(request.url())) {
        planWrite = request.postDataJSON() as Record<string, unknown>;
      }
      if (/\/v1\/external-interactions\/[^/]+\/resolve$/.test(request.url())) {
        resolutionWrite = request.postDataJSON() as Record<string, unknown>;
      }
    });
    page.on('response', async (response) => {
      if (
        response.request().method() === 'POST' &&
        /\/v1\/external-bindings\/[^/]+\/messages$/.test(response.url())
      ) {
        planResponse = {
          status: response.status(),
          body: await response.json().catch(() => undefined),
        };
      }
    });

    await page.goto(`/?api=${encodeURIComponent(backend)}`);
    await page.getByTestId('external-agents-tab').click();
    const search = page.getByLabel('Search loaded agent sessions');
    await search.fill('5529');
    const row = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5529' })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const marker = `RV_PLAN_INPUT_${Date.now()}`;
    await page.getByLabel('External message mode').selectOption('plan');
    await page
      .getByTestId('message-input-field')
      .fill(
        [
          'Use request_user_input exactly once.',
          'Ask which certification color to use with two options labelled Blue and Green.',
          `After the answer, reply with the exact marker ${marker} followed by a colon and the selected label.`,
          'Do not call other tools or modify files.',
        ].join(' '),
      );
    await page.getByTestId('send-message').click();
    await expect
      .poll(() => planWrite)
      .toMatchObject({
        collaborationMode: 'plan',
      });
    await expect
      .poll(() => planResponse)
      .toMatchObject({
        status: 200,
        body: { ok: true, data: { status: 'accepted' } },
      });

    const status = page.getByTestId('external-turn-status');
    await expect(status).toHaveAttribute(
      'data-turn-phase',
      'waiting_interaction',
      { timeout: 3 * 60_000 },
    );
    const card = page.getByTestId('external-interaction-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/which certification color/i);
    await page.screenshot({
      path: testInfo.outputPath('real-plan-interaction-pending.png'),
      fullPage: true,
    });

    const blue = card.getByRole('button', { name: /^blue/i });
    await expect(blue).toBeVisible();
    const selectedLabel = (await blue.locator('span').innerText()).trim();
    await blue.click();
    await card.getByTestId('external-interaction-submit').click();
    await expect.poll(() => resolutionWrite).toBeDefined();
    const result = resolutionWrite?.['result'] as
      | { answers?: Record<string, { answers?: string[] }> }
      | undefined;
    const submitted = Object.values(result?.answers ?? {});
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.answers).toEqual([selectedLabel]);

    await expect(card).toBeHidden({ timeout: 30_000 });
    await expect(status).toHaveAttribute('data-turn-phase', 'completed', {
      timeout: 3 * 60_000,
    });
    await revealTranscriptBlock(page, marker, 'text');
    await page.screenshot({
      path: testInfo.outputPath('real-plan-interaction-completed.png'),
      fullPage: true,
    });

    await page.reload();
    await page.getByTestId('external-agents-tab').click();
    await search.fill('5529');
    const recovered = page
      .getByTestId('external-agent-row')
      .filter({ hasText: '#5529' })
      .first();
    await recovered.click();
    await revealTranscriptBlock(page, marker, 'text');
    await page.screenshot({
      path: testInfo.outputPath('real-plan-interaction-recovered.png'),
      fullPage: true,
    });
  });
});

async function startFreshExternalThread(
  baseUrl: string,
  bindingId: string,
): Promise<void> {
  const listed = await requestJson<{
    bindings: Array<Record<string, unknown>>;
  }>(`${baseUrl}/v1/external-bindings`);
  const binding = listed.bindings.find(
    (item) => item['bindingId'] === bindingId,
  );
  if (binding === undefined) {
    throw new Error(`External binding ${bindingId} was not found.`);
  }
  const { nativeThreadId: _previousThreadId, ...withoutThread } = binding;
  const rebound = await requestJson<Record<string, unknown>>(
    `${baseUrl}/v1/external-bindings`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        binding: withoutThread,
        expectedRevision: binding['revision'],
      }),
    },
  );
  await requestJson<Record<string, unknown>>(
    `${baseUrl}/v1/external-bindings/${encodeURIComponent(bindingId)}/controls`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'start_or_resume_thread',
        expectedBindingRevision: rebound['revision'],
        payload: { cwd: '/home/dev/rusty-view' },
      }),
    },
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const envelope = (await response.json()) as {
    ok?: boolean;
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || envelope.ok !== true || envelope.data === undefined) {
    throw new Error(
      envelope.error?.message ??
        `Request ${init?.method ?? 'GET'} ${url} failed with ${response.status}.`,
    );
  }
  return envelope.data;
}

async function revealCertificationFileChange(page: Page): Promise<void> {
  await revealTranscriptBlock(
    page,
    'external-agent-console-certification.md',
    'file_change',
  );
}

async function revealTranscriptBlock(
  page: Page,
  query: string,
  blockKind: string,
  messageId?: string,
): Promise<string | null> {
  const searchInput = page.getByTestId('transcript-search-input');
  if (!(await searchInput.isVisible())) {
    await page.getByTestId('transcript-search-toggle').click();
  }
  await searchInput.fill(query);
  await expect(page.getByTestId('transcript-search-status')).toHaveText(
    /\d+ \/ \d+/,
  );
  const scope =
    messageId === undefined
      ? page
      : page.locator(
          `[data-testid="message-row"][data-message-id="${messageId}"]`,
        );
  const blocks = scope
    .locator(
      blockKind === 'text'
        ? '[data-testid="text-block"]'
        : `[data-block-kind="${blockKind}"]`,
    )
    .filter({ hasText: query });
  await expect
    .poll(
      async () => {
        await page.getByTestId('transcript-search-next').click();
        return blocks.count();
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const block = blocks.last();
  await expect(block).toBeAttached();
  await expect(block).toBeVisible({ timeout: 10_000 });
  if (messageId !== undefined) {
    return page
      .locator(`[data-testid="message-row"][data-message-id="${messageId}"]`)
      .getAttribute('data-message-status');
  }
  return (
    (await block.evaluate((element) =>
      element
        .closest('[data-message-status]')
        ?.getAttribute('data-message-status'),
    )) ?? null
  );
}

async function inspectRawDiffEvent(page: Page): Promise<void> {
  await inspectRawNativeEvent(page, 'turn_lifecycle', 'turn/diff/updated');
}

async function inspectRawNativeEvent(
  page: Page,
  kind: string,
  nativeMethod: string,
): Promise<void> {
  const events = page.locator(
    `[data-testid="event-row"][data-event-kind="${kind}"]`,
  );
  for (let index = (await events.count()) - 1; index >= 0; index--) {
    await events.nth(index).click();
    const detail = page.getByTestId('event-inspector-detail');
    if ((await detail.textContent())?.includes(nativeMethod)) {
      await page.getByTestId('external-raw-detail').click();
      await expect(page.getByTestId('external-raw-detail-view')).toContainText(
        nativeMethod,
      );
      return;
    }
  }
  throw new Error(
    `No real ${nativeMethod} event was available for raw inspection.`,
  );
}

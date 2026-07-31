import { expect, test, type Locator, type Page } from '@playwright/test';

test('focuses a large native inventory and archives then restores through Crew', async ({
  page,
}) => {
  await installHistoryFixture(page);
  const crewRestoreRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/v1\/external-bindings\/[^/]+\/restore$/.test(request.url())) {
      crewRestoreRequests.push(request.url());
    }
  });
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();

  await expect(page.getByTestId('external-agent-row')).toHaveCount(3);
  await expect(page.getByTestId('external-agent-counts')).toContainText(
    'Loaded: 2 managed · 98 native-only · 1 attention',
  );
  const managedRow = page.locator('[data-thread-id="thread-0"]');
  await expect(managedRow.getByText('Idle', { exact: true })).toBeVisible();
  await expect(managedRow).not.toContainText(/Crew active/i);
  await expect(managedRow.locator('.rv-agent__session-status')).toHaveCSS(
    'font-weight',
    '600',
  );
  const attentionArchive = page
    .getByTestId('session-options-panel')
    .getByTestId('session-options-archive');
  await page
    .locator('[data-thread-id="thread-99"]')
    .getByTestId('external-agent-options')
    .click();
  await expect(attentionArchive).toBeDisabled();
  await expect(attentionArchive).toHaveAttribute(
    'title',
    'Resolve the pending interaction first.',
  );
  await page.getByTestId('session-options-panel').getByText('Close').click();

  await page.getByTestId('external-agent-mode-all').click();
  await expect(page.getByTestId('external-agent-row')).toHaveCount(100);
  await page.getByTestId('external-agent-load-more').click();
  await expect(page.getByTestId('external-agent-row')).toHaveCount(105);

  const disposable = page.locator('[data-thread-id="thread-50"]');
  page.once('dialog', (dialog) => dialog.accept());
  await archiveExternalAgent(page, disposable);
  await expect(disposable).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'Archived native Codex thread thread-50',
  );

  await page.getByTestId('external-agent-mode-archived').click();
  const archived = page.locator('[data-thread-id="thread-50"]');
  await expect(archived).toBeVisible();
  await archived.getByTestId('external-agent-restore').click();
  await expect(archived).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'Restored native Codex thread thread-50',
  );

  await page.getByTestId('external-agent-mode-all').click();
  const managedToRestore = page.locator('[data-thread-id="thread-0"]');
  page.once('dialog', (dialog) => dialog.accept());
  await archiveExternalAgent(page, managedToRestore);
  await page.getByTestId('external-agent-mode-archived').click();
  const archivedManaged = page.locator('[data-thread-id="thread-0"]');
  await expect(archivedManaged).toContainText('Crew session restore available');
  const nativeHistoryRestore = archivedManaged.getByTestId(
    'external-agent-restore',
  );
  await expect(nativeHistoryRestore).toHaveText('Restore native history');
  await nativeHistoryRestore.click();
  await expect(archivedManaged).toHaveCount(0);
  expect(crewRestoreRequests).toHaveLength(0);

  await page.getByTestId('external-agent-mode-all').click();
  await page.getByTestId('external-agent-load-more').click();
  const nativeRestoredManaged = page.locator('[data-thread-id="thread-0"]');
  await expect(nativeRestoredManaged).toBeVisible();
  await expect(nativeRestoredManaged).toContainText('Crew Archived');
  page.once('dialog', (dialog) => dialog.accept());
  await archiveExternalAgent(page, nativeRestoredManaged);
  await page.getByTestId('external-agent-mode-archived').click();

  const archivedManagedAgain = page.locator('[data-thread-id="thread-0"]');
  const crewRestore = archivedManagedAgain.getByTestId(
    'external-agent-restore-crew-session',
  );
  await expect(crewRestore).toHaveText('Restore Crew session');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Binding: binding-0');
    expect(dialog.message()).toContain('Crew session: session-0');
    expect(dialog.message()).toContain('Native Codex thread: thread-0');
    await dialog.accept();
  });
  await crewRestore.click();
  expect(crewRestoreRequests).toHaveLength(1);
  await expect(page.locator('[data-thread-id="thread-0"]')).toBeVisible();
  await expect(page.locator('.rv-agents__notice')).toContainText(
    'Restored Crew session session-0',
  );
  await page.getByTestId('crew-agents-tab').click();
  await expect(page.locator('[data-session-id="session-0"]')).toBeVisible();
  await page.getByTestId('external-agents-tab').click();

  await page.getByTestId('external-agent-mode-all').click();
  const deletable = page.locator('[data-thread-id="thread-51"]');
  page.once('dialog', (dialog) => dialog.accept());
  await archiveExternalAgent(page, deletable);
  await page.getByTestId('external-agent-mode-archived').click();
  const permanentlyDelete = page.locator('[data-thread-id="thread-51"]');
  page.once('dialog', (dialog) => dialog.accept('thread-51'));
  await permanentlyDelete.getByTestId('external-agent-delete').click();
  await expect(permanentlyDelete).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'Deleted native Codex thread thread-51',
  );
});

test('renders one compact phased assistant turn identically after reload', async ({
  page,
}) => {
  await installHistoryFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-0"]').click();

  const assistantTurn = page.locator('[data-message-role="assistant"]');
  await expect(assistantTurn).toHaveCount(1);
  await expect(assistantTurn).toHaveAttribute(
    'data-message-phase',
    'final_answer',
  );
  await expect(
    assistantTurn.locator('[data-block-message-phase="commentary"]'),
  ).toContainText('Checking the browser state.');
  await expect(
    assistantTurn.locator('[data-block-kind="command"]'),
  ).toBeVisible();
  await expect(
    assistantTurn.locator('[data-block-message-phase="final_answer"]'),
  ).toContainText('Final answer from Codex.');
  await expect(page.locator('.rv-transcript__item').last()).toContainText(
    'Final answer from Codex.',
  );
  await expect
    .poll(() =>
      page.getByTestId('transcript-viewport').evaluate((viewport) => {
        const items = viewport.querySelectorAll<HTMLElement>(
          '.rv-transcript__item',
        );
        const lastItem = items.item(items.length - 1);
        if (lastItem === null) return Number.POSITIVE_INFINITY;
        return (
          viewport.getBoundingClientRect().bottom -
          lastItem.getBoundingClientRect().bottom
        );
      }),
    )
    .toBeLessThanOrEqual(2);
  await expect(page.getByTestId('transcript-viewport')).not.toContainText(
    'Replay-only reasoning after canonical final',
  );

  const before = await page
    .getByTestId('transcript-viewport')
    .evaluate((element) => element.textContent ?? '');
  await page.reload();
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-0"]').click();
  await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(1);
  await expect(
    page.locator('[data-block-message-phase="commentary"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-block-message-phase="final_answer"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId('transcript-viewport')).toHaveText(before);
});

async function archiveExternalAgent(page: Page, row: Locator): Promise<void> {
  await row.getByTestId('external-agent-options').click();
  await page
    .getByTestId('session-options-panel')
    .getByTestId('session-options-archive')
    .click();
}

async function installHistoryFixture(page: Page): Promise<void> {
  const runtime = {
    runtimeId: 'runtime-1',
    kind: 'codex_app_server',
    desiredState: 'enabled',
    observedState: 'ready',
    processOwnership: 'attached',
    endpoint: { transport: 'unix_web_socket', address: '/run/codex.sock' },
    executableSha256: 'exe',
    protocolSchemaSha256: 'schema',
    expectedCliVersion: '0.144.1',
    revision: 1,
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
  };
  const controller = {
    runtimeId: 'runtime-1',
    driverState: 'ready',
    controllerInstanceId: 'controller-1',
    controllerGeneration: 1,
    leaseExpiresAt: '2026-07-12T01:00:00Z',
    bindingResumeFailures: [],
  };
  const phaseTurns = [
    {
      turnId: 'turn-phase',
      status: 'completed',
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      items: [
        ...Array.from({ length: 180 }, (_, index) => ({
          itemId: `reasoning-${index}`,
          kind: 'reasoning',
          summary: [
            `Reasoning checkpoint ${index}`,
            'This deliberately tall refreshed-history item forces the autosize strategy to revise its provisional tail estimate.',
            'The final answer after this history must be materially rendered, not merely present in the snapshot.',
          ],
        })),
        {
          itemId: 'commentary',
          kind: 'agentMessage',
          text: 'Checking the browser state.',
          messagePhase: 'commentary',
        },
        {
          itemId: 'command',
          kind: 'commandExecution',
          text: 'pnpm test\n42 passed',
          status: 'completed',
        },
        {
          itemId: 'final',
          kind: 'agentMessage',
          text: 'Final answer from Codex.',
          messagePhase: 'final_answer',
        },
      ],
    },
  ];
  let activeThreads = Array.from({ length: 105 }, (_, index) => ({
    threadId: `thread-${index}`,
    sessionId: `session-${index}`,
    parentThreadId: null,
    preview: `Native Codex history ${index}`,
    ephemeral: false,
    modelProvider: 'openai',
    effectiveModel: 'gpt-5.6-sol',
    createdAt: index + 1,
    updatedAt: index + 1,
    status: 'idle',
    cwd: '/home/dev/rusty-view',
    cliVersion: '0.144.1',
    name: index < 2 ? `Managed agent ${index}` : null,
    agentNickname: null,
    agentRole: null,
    turns: index === 0 ? phaseTurns : [],
  }));
  let archivedThreads: typeof activeThreads = [];
  let crewRestoreCompleted = false;
  let bindings = activeThreads.slice(0, 2).map((thread, index) => ({
    bindingId: `binding-${index}`,
    runtimeId: 'runtime-1',
    nativeThreadId: thread.threadId,
    sessionId: thread.sessionId,
    agentId: `agent-${index}`,
    purpose: 'crew_agent',
    status: 'active',
    cwd: thread.cwd,
    profileId: `profile-${index}`,
    profilePromptHash: `prompt-${index}`,
    profileRevision: 1,
    taskRef: { project_id: 'rusty-view', task_id: '5696' },
    effectiveConfigFingerprint: 'config',
    revision: 1,
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
  }));

  await page.route('http://crew.test/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ok = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data,
          meta: { request_id: 'req', schema_version: 1 },
        }),
      });
    if (url.pathname === '/v1/admin/profiles/registry') {
      return ok({ items: [], total: 0, limit: 100, offset: 0 });
    }
    if (url.pathname === '/v1/chat/sessions') {
      const visibleBindings = crewRestoreCompleted ? bindings.slice(0, 1) : [];
      return ok({
        items: visibleBindings.map((binding) => ({
          session_id: binding.sessionId,
          agent_id: binding.agentId,
          profile_id: binding.profileId,
          kind: 'full',
          status: binding.status === 'active' ? 'idle' : 'archived',
          latest_cursor: '',
          updated_at: binding.updatedAt,
        })),
        total: visibleBindings.length,
        limit: 100,
        offset: 0,
      });
    }
    if (url.pathname === '/v1/chat/commands') return ok({ commands: [] });
    if (url.pathname === '/v1/coordination/agents') {
      const visibleBindings = crewRestoreCompleted ? bindings.slice(0, 1) : [];
      return ok({
        deploymentRole: 'production',
        agents: visibleBindings.map((binding) => ({
          agentId: binding.agentId,
          bindingId: binding.bindingId,
          bindingStatus: binding.status,
          displayLabel: binding.profileId,
          profileId: binding.profileId,
          routable: binding.status === 'active',
          runtimeId: binding.runtimeId,
          runtimeKind: 'codex_app_server',
          sessionId: binding.sessionId,
          sessionKind: 'full',
          sessionStatus: binding.status === 'active' ? 'idle' : 'archived',
          workdir: binding.cwd,
        })),
      });
    }
    if (url.pathname === '/v1/external-runtimes') {
      return ok({ runtimes: [runtime], controllers: [controller] });
    }
    if (url.pathname === '/v1/external-bindings') return ok({ bindings });
    if (url.pathname === '/v1/external-interactions') {
      return ok({
        interactions: [
          {
            interactionId: 'attention-1',
            runtimeId: 'runtime-1',
            bindingId: 'native-only',
            requestId: 'request-1',
            nativeThreadId: 'thread-99',
            kind: 'request_user_input',
            prompt: { questions: [] },
            allowedResponses: ['answers'],
            status: 'pending',
            requestedAt: '2026-07-12T00:00:00Z',
            revision: 1,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/threads/read')) {
      const body = request.postDataJSON() as { threadId?: string };
      return ok({
        thread: [...activeThreads, ...archivedThreads].find(
          (thread) => thread.threadId === body.threadId,
        ),
      });
    }
    if (/\/threads\/[^/]+\/(archive|unarchive|delete)$/.test(url.pathname)) {
      const parts = url.pathname.split('/');
      const action = parts.at(-1) as 'archive' | 'unarchive' | 'delete';
      const threadId = decodeURIComponent(parts.at(-2) ?? '');
      if (action === 'archive') {
        const thread = activeThreads.find((item) => item.threadId === threadId);
        activeThreads = activeThreads.filter(
          (item) => item.threadId !== threadId,
        );
        if (thread !== undefined)
          archivedThreads = [...archivedThreads, thread];
        bindings = bindings.map((binding) =>
          binding.nativeThreadId === threadId
            ? {
                ...binding,
                status: 'archived',
                revision: binding.revision + 1,
              }
            : binding,
        );
      } else if (action === 'unarchive') {
        const thread = archivedThreads.find(
          (item) => item.threadId === threadId,
        );
        archivedThreads = archivedThreads.filter(
          (item) => item.threadId !== threadId,
        );
        if (thread !== undefined) activeThreads = [...activeThreads, thread];
      } else {
        archivedThreads = archivedThreads.filter(
          (item) => item.threadId !== threadId,
        );
      }
      return ok({
        runtimeId: 'runtime-1',
        threadId,
        action,
        outcome: 'applied',
        ...(action === 'delete'
          ? { nativeDeleted: true }
          : { nativeArchived: action === 'archive' }),
        bindings: [],
      });
    }
    if (/\/v1\/external-bindings\/[^/]+\/restore$/.test(url.pathname)) {
      const bindingId = decodeURIComponent(
        url.pathname.split('/').at(-2) ?? '',
      );
      const body = request.postDataJSON() as {
        expectedBindingRevision?: number;
        expectedSessionId?: string;
        expectedAgentId?: string;
        expectedProfileId?: string;
        expectedNativeThreadId?: string;
      };
      const binding = bindings.find((item) => item.bindingId === bindingId);
      if (binding === undefined) {
        throw new Error(`Missing archived binding ${bindingId}`);
      }
      expect(body).toEqual({
        expectedBindingRevision: binding.revision,
        expectedSessionId: binding.sessionId,
        expectedAgentId: binding.agentId,
        expectedProfileId: binding.profileId,
        expectedNativeThreadId: binding.nativeThreadId,
      });
      const thread = archivedThreads.find(
        (item) => item.threadId === binding.nativeThreadId,
      );
      archivedThreads = archivedThreads.filter(
        (item) => item.threadId !== binding.nativeThreadId,
      );
      if (thread !== undefined) activeThreads = [...activeThreads, thread];
      const restored = {
        ...binding,
        status: 'active' as const,
        revision: binding.revision + 1,
      };
      bindings = bindings.map((item) =>
        item.bindingId === bindingId ? restored : item,
      );
      crewRestoreCompleted = true;
      return ok({
        outcome: 'restored',
        profileRevisionUpdated: false,
        binding: restored,
        session: {
          session_id: restored.sessionId,
          agent_id: restored.agentId,
          profile_id: restored.profileId,
          status: 'idle',
        },
      });
    }
    if (url.pathname.endsWith('/threads')) {
      const source =
        url.searchParams.get('archived') === 'true'
          ? archivedThreads
          : activeThreads;
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      const items = source.slice(offset, offset + 100);
      return ok({
        items,
        nextCursor:
          offset + items.length < source.length
            ? String(offset + items.length)
            : null,
        backwardsCursor: null,
      });
    }
    if (url.pathname.endsWith('/events')) {
      return ok({
        events: [
          {
            eventId: 'event-replay-reasoning',
            runtimeId: 'runtime-1',
            sequenceId: 1,
            createdAt: '2026-07-12T00:00:01Z',
            kind: 'reasoning_delta',
            nativeThreadId: 'thread-0',
            nativeTurnId: 'turn-phase',
            itemId: 'rs-native-replay-id',
            payload: {
              nativeMethod: 'item/reasoning/delta',
              text: 'Replay-only reasoning after canonical final',
            },
          },
        ],
      });
    }
    if (url.pathname.endsWith('/stream')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
    }
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
}

import { expect, test } from './live-fixture';

interface ChatEvent {
  readonly event_id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
}

test('Den planning and external memory remain distinct @live-agent @memory-boundary-cert', async ({
  live,
}) => {
  test.setTimeout(600_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  const initial = await live.debugSnapshot();
  expect(initial?.activeSessionId).toBeTruthy();
  const sessionId = initial?.activeSessionId ?? '';

  const planningCursor = initial?.lastCursor ?? undefined;
  await live.runTurn({
    prompt: [
      'Memory-boundary certification, Den planning half.',
      'Use Den MCP planning tools to read the Den document rusty-crew / memory-surface-boundaries-2026-07-05 and inspect Den task 4279.',
      'Do not use memory_recall, memory_read, or memory_search for either lookup.',
      'Reply with the document title and task title after both tool lookups succeed.',
    ].join('\n'),
    assistantCompletedTimeoutMs: 300_000,
    finalTextMustInclude: [
      'Memory Surface Boundaries',
      'Live-proof Den document/task lookup is distinct from external memory tools',
    ],
  });
  const afterPlanning = await live.debugSnapshot();
  const planningEvents = await chatEventsSince(
    live.backendUrl,
    sessionId,
    planningCursor,
    afterPlanning?.lastCursor ?? undefined,
  );
  const planningTools = observedToolNames(planningEvents);
  const planningCoverage = successfulDenPlanningCoverage(planningEvents);
  expect(planningCoverage.document).toBe(true);
  expect(planningCoverage.task).toBe(true);
  expect(
    planningTools.some((name) => /^memory_(recall|read|search)$/.test(name)),
  ).toBe(false);

  const memoryCursor = afterPlanning?.lastCursor ?? undefined;
  await live.runTurn({
    prompt: [
      'Memory-boundary certification, external-memory half.',
      'Use memory_recall or memory_search to retrieve the certification marker stored in the configured external memory service.',
      'Do not use any den_* document, task, project, or guidance tool for this lookup.',
      'Return the marker exactly after the external-memory tool succeeds.',
    ].join('\n'),
    assistantCompletedTimeoutMs: 300_000,
    finalTextMustInclude: ['EXTERNAL_MEMORY_BOUNDARY_CERTIFIED'],
  });
  const afterMemory = await live.debugSnapshot();
  const memoryEvents = await chatEventsSince(
    live.backendUrl,
    sessionId,
    memoryCursor,
    afterMemory?.lastCursor ?? undefined,
  );
  const memoryTools = observedToolNames(memoryEvents);
  const successfulMemoryTools = successfulCompletedToolNames(memoryEvents);
  expect(
    successfulMemoryTools.some((name) =>
      /^memory_(recall|read|search)$/.test(name),
    ),
  ).toBe(true);
  expect(memoryTools.some((name) => /^den_/.test(name))).toBe(false);

  await live.screenshot('memory-boundary-both-turns-complete');
  live.note(
    `Successful Den planning tools observed: ${successfulCompletedToolNames(
      planningEvents,
    ).join(', ')}`,
  );
  live.note(`External memory tools observed: ${memoryTools.join(', ')}`);
  live.note(
    'Manual close criterion: inspect the completed transcript screenshot and evidence packet; the first turn must render Den planning calls and the second must render the external-memory marker.',
  );
});

test('Den planning completion contract rejects missing or failed families @memory-boundary-cert-contract', () => {
  const completed = (
    eventId: string,
    toolName: string,
    isError: boolean,
  ): ChatEvent => ({
    event_id: eventId,
    kind: 'tool_call_completed',
    payload: { tool_name: toolName, is_error: isError },
  });
  const documentSuccess = completed(
    'document-success',
    'den_get_document',
    false,
  );
  const taskSuccess = completed('task-success', 'den_get_task', false);
  const documentFailure = completed(
    'document-failure',
    'den_get_document',
    true,
  );
  const taskFailure = completed('task-failure', 'den_get_task', true);

  expect(successfulDenPlanningCoverage([documentSuccess, taskSuccess])).toEqual(
    { document: true, task: true },
  );
  expect(successfulDenPlanningCoverage([documentSuccess])).toEqual({
    document: true,
    task: false,
  });
  expect(successfulDenPlanningCoverage([documentSuccess, taskFailure])).toEqual(
    { document: true, task: false },
  );
  expect(successfulDenPlanningCoverage([taskSuccess])).toEqual({
    document: false,
    task: true,
  });
  expect(successfulDenPlanningCoverage([documentFailure, taskSuccess])).toEqual(
    { document: false, task: true },
  );
});

async function chatEventsSince(
  backendUrl: string,
  sessionId: string,
  cursor: string | undefined,
  terminalCursor: string | undefined,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  let nextCursor = cursor;
  for (let page = 0; page < 50; page += 1) {
    const url = new URL(
      `/v1/chat/sessions/${encodeURIComponent(sessionId)}/events`,
      backendUrl,
    );
    url.searchParams.set('limit', '100');
    if (nextCursor !== undefined) url.searchParams.set('cursor', nextCursor);
    const response = await fetch(url);
    expect(response.ok, `event read failed: ${response.status}`).toBe(true);
    const envelope = (await response.json()) as {
      data: {
        items: ChatEvent[];
        latest_cursor?: string;
        has_more?: boolean;
      };
    };
    events.push(...envelope.data.items);
    const observedCursor = envelope.data.items.at(-1)?.event_id;
    if (
      envelope.data.has_more !== true ||
      observedCursor === undefined ||
      observedCursor === nextCursor ||
      observedCursor === terminalCursor
    ) {
      break;
    }
    nextCursor = observedCursor;
  }
  return events;
}

function observedToolNames(events: readonly ChatEvent[]): string[] {
  return events
    .filter(
      (event) =>
        event.kind === 'tool_call_started' ||
        event.kind === 'tool_call_completed',
    )
    .map((event) => event.payload['tool_name'])
    .filter((name): name is string => typeof name === 'string');
}

function successfulCompletedToolNames(events: readonly ChatEvent[]): string[] {
  return events
    .filter(
      (event) =>
        event.kind === 'tool_call_completed' &&
        event.payload['is_error'] === false,
    )
    .map((event) => event.payload['tool_name'])
    .filter((name): name is string => typeof name === 'string');
}

function successfulDenPlanningCoverage(
  events: readonly ChatEvent[],
): Readonly<{ document: boolean; task: boolean }> {
  const successfulTools = successfulCompletedToolNames(events);
  return {
    document: successfulTools.some((name) => /^den_.*document/.test(name)),
    task: successfulTools.some((name) => /^den_.*task/.test(name)),
  };
}

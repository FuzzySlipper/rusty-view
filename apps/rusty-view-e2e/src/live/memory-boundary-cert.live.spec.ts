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
    finalTextMinLength: 40,
  });
  const afterPlanning = await live.debugSnapshot();
  const planningEvents = await chatEventsSince(
    live.backendUrl,
    sessionId,
    planningCursor,
    afterPlanning?.lastCursor ?? undefined,
  );
  const planningTools = startedToolNames(planningEvents);
  expect(planningTools.some((name) => /^den_/.test(name))).toBe(true);
  expect(planningTools.some((name) => /(document|task)/.test(name))).toBe(true);
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
  const memoryTools = startedToolNames(memoryEvents);
  expect(
    memoryTools.some((name) => /^memory_(recall|read|search)$/.test(name)),
  ).toBe(true);
  expect(
    memoryEvents.some(
      (event) =>
        event.kind === 'tool_call_completed' &&
        /^memory_(recall|read|search)$/.test(
          String(event.payload['tool_name']),
        ) &&
        event.payload['is_error'] === false,
    ),
  ).toBe(true);
  expect(memoryTools.some((name) => /^den_/.test(name))).toBe(false);

  await live.screenshot('memory-boundary-both-turns-complete');
  live.note(`Den planning tools observed: ${planningTools.join(', ')}`);
  live.note(`External memory tools observed: ${memoryTools.join(', ')}`);
  live.note(
    'Manual close criterion: inspect the completed transcript screenshot and evidence packet; the first turn must render Den planning calls and the second must render the external-memory marker.',
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

function startedToolNames(events: readonly ChatEvent[]): string[] {
  return events
    .filter((event) => event.kind === 'tool_call_started')
    .map((event) => event.payload['tool_name'])
    .filter((name): name is string => typeof name === 'string');
}

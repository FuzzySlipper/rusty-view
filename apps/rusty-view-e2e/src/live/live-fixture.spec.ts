import { expect, test } from '@playwright/test';

import {
  assistantMessageStatesAfterUser,
  findSentUserMessage,
  isolatedLiveProfileId,
  liveAppUrlForBackend,
  liveProfileIsolationPrefix,
  liveProfileCreateRequest,
  type RustyViewDebugSnapshot,
  LiveConversation,
  DEFAULT_LIVE_BACKEND_URL,
  cleanupIsolatedLiveProfile,
} from './live-fixture';

const messages = [
  message('old-user', 'user', 'reused prompt'),
  message('old-assistant', 'assistant', 'old response'),
  message('new-user', 'user', 'reused prompt'),
  message('new-assistant', 'assistant', 'new response'),
] satisfies RustyViewDebugSnapshot['messages'];

test('live fixture turn correlation ignores historical rows before the sent user message', () => {
  const sentUser = findSentUserMessage(messages, 'reused prompt', 1);

  expect(sentUser?.id).toBe('new-user');
  expect(
    assistantMessageStatesAfterUser(messages, sentUser?.id ?? '').map(
      (item) => item.id,
    ),
  ).toEqual(['new-assistant']);
});

test('live fixture turn correlation does not fall back to generic latest assistant', () => {
  expect(findSentUserMessage(messages, 'missing prompt', 1)).toBeUndefined();
  expect(assistantMessageStatesAfterUser(messages, 'missing-user')).toEqual([]);
});

test('live fixture follows pending assistant replacement before the row becomes visible', async ({
  page,
}, testInfo) => {
  await page.setContent('<main id="transcript"></main>');
  await page.evaluate(() => {
    type Message = RustyViewDebugSnapshot['messages'][number];
    const state = window as typeof window & {
      messages: Message[];
      scrollRequests: string[];
      __RUSTY_VIEW_TEST__: Record<string, (...args: unknown[]) => unknown>;
    };
    state.scrollRequests = [];
    state.messages = [
      messageState('sent-user', 'user', 'completed', 'race prompt'),
      messageState('pending-assistant-race', 'assistant', 'streaming', ''),
    ];
    state.__RUSTY_VIEW_TEST__ = {
      getBackendBaseUrl: () => 'http://crew.test',
      getActiveSessionId: () => 'session-1',
      getConnectionStatus: () => 'connected',
      getIsGenerating: () => false,
      getIsStreaming: () => false,
      getStreamingCharCount: () => 0,
      getLastCursor: () => 'cursor-2',
      getMessageCount: () => state.messages.length,
      getRawEventCount: () => 3,
      getMessages: () => state.messages,
      scrollToMessageId: (...args: unknown[]) => {
        const id = args[0];
        if (typeof id !== 'string') return;
        state.scrollRequests.push(id);
        if (id !== 'pending-assistant-race') return;
        queueMicrotask(() => {
          state.messages = [
            messageState('sent-user', 'user', 'completed', 'race prompt'),
            messageState(
              'assistant-durable',
              'assistant',
              'completed',
              'durable answer',
            ),
          ];
          document
            .querySelector('#transcript')
            ?.insertAdjacentHTML(
              'beforeend',
              '<div data-testid="message-row" data-message-id="assistant-durable" data-message-status="completed">durable answer</div>',
            );
        });
      },
    };

    function messageState(
      id: string,
      role: string,
      status: string,
      text: string,
    ): Message {
      return { id, role, status, text, blockKinds: ['text'] };
    }
  });

  const live = new LiveConversation(page, testInfo);
  const assistant = await live.waitForNextAssistantMessageAfterUser(
    'sent-user',
    2_000,
  );

  await expect(assistant).toHaveAttribute(
    'data-message-id',
    'assistant-durable',
  );
  await expect(assistant).toHaveAttribute('data-message-status', 'completed');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              scrollRequests: string[];
            }
          ).scrollRequests,
      ),
    )
    .toEqual(['pending-assistant-race', 'assistant-durable']);
});

test('isolated profile ids are stable, scoped, and slug-safe', () => {
  expect(
    isolatedLiveProfileId({
      prefix: 'rv live',
      title: 'Baseline multi-turn real conversation @live-agent',
      workerIndex: 3,
      retry: 1,
      startedAtMs: 1783068495943,
    }),
  ).toBe(
    'rv-live-baseline-multi-turn-real-conversation-live-agent-w3-r1-mr4oy0qv',
  );
});

test('live profile isolation is enabled by default for opted-in live runs', () => {
  expect(
    liveProfileIsolationPrefix({
      liveRun: '1',
    }),
  ).toBe('rv-live');
});

test('live automation defaults to the debug Crew service', () => {
  expect(DEFAULT_LIVE_BACKEND_URL).toBe('http://127.0.0.1:9348');
});

test('isolated live cleanup archives active sessions and deletes the profile', async () => {
  const requests: Array<{
    url: string;
    init: RequestInit | undefined;
  }> = [];
  const responses = [
    new Response(
      JSON.stringify({
        data: {
          items: [
            { session_id: 'live-a', status: 'active' },
            { session_id: 'old', status: 'archived' },
            { session_id: 'live-b', status: 'idle' },
          ],
        },
      }),
      { status: 200 },
    ),
    new Response('{}', { status: 200 }),
    new Response('{}', { status: 200 }),
    new Response('{}', { status: 200 }),
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return responses.shift() as Response;
  };

  await expect(
    cleanupIsolatedLiveProfile({
      backendUrl: 'http://127.0.0.1:9348',
      profileId: 'rv-live-cleanup',
      reason: 'unit cleanup',
      idempotencyScope: 'test',
      fetchImpl,
    }),
  ).resolves.toEqual(['live-a', 'live-b']);

  expect(requests.map(({ url }) => url)).toEqual([
    'http://127.0.0.1:9348/v1/chat/sessions?profile_id=rv-live-cleanup&limit=100',
    'http://127.0.0.1:9348/v1/chat/sessions/live-a/commands',
    'http://127.0.0.1:9348/v1/chat/sessions/live-b/commands',
    'http://127.0.0.1:9348/v1/admin/control/profiles/rv-live-cleanup/delete',
  ]);
  expect(requests.slice(1).map(({ init }) => init?.method)).toEqual([
    'POST',
    'POST',
    'POST',
  ]);
});

test('live profile isolation can be named or explicitly disabled', () => {
  expect(
    liveProfileIsolationPrefix({
      liveRun: '1',
      profilePrefix: 'suite-a',
    }),
  ).toBe('suite-a');
  expect(
    liveProfileIsolationPrefix({
      liveRun: '1',
      profilePrefix: 'suite-a',
      profileIsolation: '0',
    }),
  ).toBeUndefined();
});

test('live app URL carries the fixture backend override into the rendered app', () => {
  expect(liveAppUrlForBackend('http://127.0.0.1:9348/')).toBe(
    '/?api=http%3A%2F%2F127.0.0.1%3A9348',
  );
});

test('isolated profile create request uses live tester defaults without cloning history', () => {
  expect(
    liveProfileCreateRequest({
      profileId: 'rv-live-baseline-w0-r0-test',
      displayName: 'Live baseline',
      providerAlias: 'tester-chat',
      localToolProfileId: 'full_agent',
      reason: 'test isolation',
    }),
  ).toEqual({
    profileId: 'rv-live-baseline-w0-r0-test',
    displayName: 'Live baseline',
    providerAlias: 'tester-chat',
    kind: 'full',
    localToolProfileId: 'full_agent',
    reason: 'test isolation',
  });
});

function message(
  id: string,
  role: string,
  text: string,
): RustyViewDebugSnapshot['messages'][number] {
  return {
    id,
    role,
    text,
    status: 'completed',
    blockKinds: ['text'],
  };
}

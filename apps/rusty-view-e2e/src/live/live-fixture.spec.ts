import { expect, test } from '@playwright/test';

import {
  assistantMessageStatesAfterUser,
  findSentUserMessage,
  isolatedLiveProfileId,
  liveProfileIsolationPrefix,
  liveProfileCreateRequest,
  type RustyViewDebugSnapshot,
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

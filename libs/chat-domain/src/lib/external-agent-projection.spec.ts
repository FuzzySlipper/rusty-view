import { describe, expect, it } from 'vitest';
import type { NormalizedExternalRuntimeEvent } from '@rusty-view/protocol';
import { projectExternalAgentTranscript } from './external-agent-projection';

describe('projectExternalAgentTranscript', () => {
  it('keeps plans, commands, files, reasoning, and unknown events inspectable', () => {
    const events: NormalizedExternalRuntimeEvent[] = [
      event('1', 'plan_delta', {
        nativeMethod: 'turn/plan/updated',
        text: 'Inspect repository',
      }),
      event('2', 'command_activity', {
        nativeMethod: 'item/commandExecution/completed',
        command: 'pnpm test',
        output: '42 passed',
        status: 'completed',
      }),
      event('3', 'file_activity', {
        nativeMethod: 'item/fileChange/completed',
        status: 'completed',
        fileChanges: [{ path: 'src/app.ts', kind: 'update' }],
      }),
      event('4', 'reasoning_delta', {
        nativeMethod: 'item/reasoning/delta',
        text: 'Checking the failure mode',
      }),
      event('5', 'unknown_native_notification', {
        nativeMethod: 'future/event',
      }),
      event('6', 'assistant_text_delta', {
        nativeMethod: 'item/agentMessage/delta',
        text: 'Done',
      }),
      {
        ...event('7', 'turn_lifecycle', {
          nativeMethod: 'turn/diff/updated',
        }),
        rawDetailRef: 'detail-diff',
      },
      event('8', 'turn_lifecycle', {
        nativeMethod: 'turn/completed',
        status: 'completed',
      }),
    ];

    const messages = projectExternalAgentTranscript(undefined, events);
    const kinds = messages.flatMap((message) =>
      message.blocks.map((block) => block.kind),
    );
    expect(kinds).toEqual([
      'plan',
      'command',
      'file_change',
      'reasoning',
      'debug',
      'text',
      'file_change',
    ]);
    expect(messages[1]?.blocks[0]?.tool?.status).toBe('completed');
    expect(messages[2]?.blocks[0]?.content).toContain('src/app.ts');
    expect(messages.every((message) => message.status === 'completed')).toBe(
      true,
    );
    expect(messages.at(-1)?.blocks[0]?.tool).toMatchObject({
      name: 'Aggregate diff',
      status: 'completed',
    });
    expect(messages.at(-1)?.blocks[0]?.metadata).toEqual({
      boundedDetailRef: 'detail-diff',
      externalRuntimeId: 'runtime-1',
    });
    expect(messages.at(-1)?.blocks[0]?.content).toContain(
      'available on demand',
    );
  });

  it('bounds long turns by native item and coalesces text deltas', () => {
    const events = Array.from({ length: 500 }, (_, index) => ({
      ...event(String(index + 1), 'assistant_text_delta', {
        nativeMethod: 'item/agentMessage/delta',
        text: 'x',
      }),
      nativeThreadId: 'thread',
      nativeTurnId: 'turn',
    }));
    const messages = projectExternalAgentTranscript(undefined, events);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks).toHaveLength(1);
    expect(messages[0]?.blocks[0]?.content).toHaveLength(500);
  });

  it('coalesces text deltas when an item lifecycle event starts the group', () => {
    const itemId = 'message-item';
    const events = [
      {
        ...event('1', 'item_lifecycle', { nativeMethod: 'item/started' }),
        itemId,
      },
      {
        ...event('2', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'hello ',
        }),
        itemId,
      },
      {
        ...event('3', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'world',
        }),
        itemId,
      },
      {
        ...event('4', 'item_lifecycle', {
          nativeMethod: 'item/completed',
          text: 'hello world',
        }),
        itemId,
      },
    ];

    const messages = projectExternalAgentTranscript(undefined, events);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks).toHaveLength(1);
    expect(messages[0]?.blocks[0]?.content).toBe('hello world');
  });
});

function event(
  eventId: string,
  kind: string,
  payload: NormalizedExternalRuntimeEvent['payload'],
): NormalizedExternalRuntimeEvent {
  return {
    eventId,
    runtimeId: 'runtime-1',
    sequenceId: Number(eventId),
    createdAt: '2026-07-11T00:00:00Z',
    kind,
    nativeThreadId: 'thread-1',
    nativeTurnId: 'turn-1',
    payload,
  };
}

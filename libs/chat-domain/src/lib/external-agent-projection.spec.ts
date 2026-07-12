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
      {
        ...event('7', 'turn_lifecycle', {
          nativeMethod: 'turn/diff/updated',
        }),
        eventId: '7-empty',
        sequenceId: 75,
        rawDetailRef: 'detail-empty-final-diff',
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
      boundedDetailRef: 'detail-empty-final-diff',
      boundedDetailRefs: ['detail-diff', 'detail-empty-final-diff'],
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

  it('does not duplicate a completed snapshot item whose event uses another id', () => {
    const events = [
      {
        ...event('1', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'Finished response',
        }),
        itemId: 'msg-native-id',
        nativeTurnId: 'turn-1',
      },
      event('2', 'turn_lifecycle', {
        nativeMethod: 'turn/completed',
        status: 'completed',
      }),
    ];
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread-1',
        sessionId: 'session-1',
        parentThreadId: null,
        preview: 'prompt',
        ephemeral: false,
        modelProvider: 'openai',
        createdAt: 1,
        updatedAt: 2,
        status: 'idle',
        cwd: '/home/dev',
        cliVersion: '0.144.1',
        name: null,
        agentNickname: null,
        agentRole: null,
        turns: [
          {
            turnId: 'turn-1',
            status: 'completed',
            startedAt: 1,
            completedAt: 2,
            durationMs: 1_000,
            items: [
              {
                itemId: 'item-2',
                kind: 'agentMessage',
                text: 'Finished response',
              },
            ],
          },
        ],
      },
      events,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('completed');
    expect(messages[0]?.blocks[0]?.content).toBe('Finished response');
  });

  it('keeps later text and command items after an in-progress snapshot', () => {
    const events = [
      {
        ...event('10', 'command_activity', {
          nativeMethod: 'item/commandExecution/completed',
          command: 'second command',
          output: 'SECOND_OUTPUT',
          status: 'completed',
        }),
        itemId: 'different-command',
      },
      {
        ...event('11', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'Later assistant text',
        }),
        itemId: 'different-message',
      },
    ];
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread-1',
        sessionId: 'session-1',
        parentThreadId: null,
        preview: 'prompt',
        ephemeral: false,
        modelProvider: 'openai',
        createdAt: 1,
        updatedAt: 2,
        status: 'active',
        cwd: '/home/dev',
        cliVersion: '0.144.1',
        name: null,
        agentNickname: null,
        agentRole: null,
        turns: [
          {
            turnId: 'turn-1',
            status: 'inProgress',
            startedAt: 1,
            completedAt: null,
            durationMs: null,
            items: [
              {
                itemId: 'snapshot-command',
                kind: 'commandExecution',
                text: 'first command',
              },
              {
                itemId: 'snapshot-message',
                kind: 'agentMessage',
                text: 'Partial assistant text',
              },
            ],
          },
        ],
      },
      events,
    );

    expect(messages.flatMap((message) => message.blocks)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'SECOND_OUTPUT' }),
        expect.objectContaining({ content: 'Later assistant text' }),
      ]),
    );
  });

  it('merges only the uncovered same-item suffix after a mid-turn snapshot', () => {
    const itemId = 'message-1';
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread-1',
        sessionId: 'session-1',
        parentThreadId: null,
        preview: 'prompt',
        ephemeral: false,
        modelProvider: 'openai',
        createdAt: 1,
        updatedAt: 2,
        status: 'active',
        cwd: '/home/dev',
        cliVersion: '0.144.1',
        name: null,
        agentNickname: null,
        agentRole: null,
        turns: [
          {
            turnId: 'turn-1',
            status: 'inProgress',
            startedAt: 1,
            completedAt: null,
            durationMs: null,
            items: [{ itemId, kind: 'agentMessage', text: 'Hello' }],
          },
        ],
      },
      [
        {
          ...event('10', 'assistant_text_delta', {
            nativeMethod: 'item/agentMessage/delta',
            text: 'Hello',
          }),
          itemId,
        },
        {
          ...event('11', 'assistant_text_delta', {
            nativeMethod: 'item/agentMessage/delta',
            text: ' world',
          }),
          itemId,
        },
      ],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks).toHaveLength(1);
    expect(messages[0]?.blocks[0]?.content).toBe('Hello world');
  });

  it('keeps empty MCP startup and usage diagnostics out of the transcript', () => {
    const messages = projectExternalAgentTranscript(undefined, [
      event('1', 'mcp_activity', {
        nativeMethod: 'mcpServer/startupStatus/updated',
      }),
      event('2', 'usage', {
        nativeMethod: 'turn/completed',
        usage: {},
      }),
    ]);

    expect(messages).toEqual([]);
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

import { describe, expect, it } from 'vitest';
import type { NormalizedExternalRuntimeEvent } from '@rusty-view/protocol';
import { projectExternalAgentTranscript } from './external-agent-projection';

describe('projectExternalAgentTranscript', () => {
  it('projects native userMessage items as visible user transcript rows', () => {
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread',
        sessionId: 'session',
        parentThreadId: null,
        preview: 'prompt',
        ephemeral: false,
        modelProvider: 'openai',
        effectiveModel: 'gpt-5.6',
        createdAt: 1,
        updatedAt: 2,
        status: 'active',
        cwd: '/workspace',
        cliVersion: '0.144.1',
        name: null,
        agentNickname: null,
        agentRole: null,
        turns: [
          {
            turnId: 'turn',
            status: 'completed',
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            items: [
              {
                itemId: 'user',
                kind: 'userMessage',
                status: 'completed',
                text: 'Please inspect the transcript.',
              },
            ],
          },
        ],
      },
      [],
    );

    expect(messages).toEqual([
      expect.objectContaining({
        author: { role: 'user', displayName: undefined },
        status: 'completed',
        blocks: [
          expect.objectContaining({
            kind: 'text',
            content: 'Please inspect the transcript.',
          }),
        ],
      }),
    ]);
  });

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

  it('coalesces external slash-command lifecycle events into one result block', () => {
    const started = {
      ...event('1', 'command_started', {
        nativeMethod: 'rustyCrew/externalCommand',
        status: 'pending',
        command: 'status',
        argument: null,
      }),
      nativeTurnId: null,
      requestId: 'command-1',
    };
    const completed = {
      ...event('2', 'command_completed', {
        nativeMethod: 'rustyCrew/externalCommand',
        status: 'applied',
        command: 'status',
        argument: null,
        message: 'Runtime ready\nModel: gpt-5.6',
      }),
      nativeTurnId: null,
      requestId: 'command-1',
    };

    const messages = projectExternalAgentTranscript(undefined, [
      started,
      completed,
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('completed');
    expect(messages[0]?.blocks[0]).toMatchObject({
      kind: 'command',
      content: 'Runtime ready\nModel: gpt-5.6',
      tool: { name: '/status', status: 'completed' },
    });
  });

  it('keeps native compaction completion visible in the transcript', () => {
    const messages = projectExternalAgentTranscript(undefined, [
      event('1', 'compaction', {
        nativeMethod: 'thread/compacted',
        message: 'Native Codex compaction completed.',
      }),
    ]);

    expect(messages[0]?.blocks[0]).toMatchObject({
      kind: 'service_notice',
      content: 'Native Codex compaction completed.',
    });
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

  it('keeps a completed snapshot final answer after unmatched replay rows', () => {
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread-1',
        sessionId: 'session-1',
        parentThreadId: null,
        preview: 'prompt',
        ephemeral: false,
        modelProvider: 'openai',
        effectiveModel: 'gpt-5.6-sol',
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
                itemId: 'snapshot-reasoning',
                kind: 'reasoning',
                text: 'Canonical reasoning',
              },
              {
                itemId: 'snapshot-final',
                kind: 'agentMessage',
                text: 'Canonical final answer',
                messagePhase: 'final_answer',
              },
            ],
          },
        ],
      },
      [
        {
          ...event('10', 'reasoning_delta', {
            nativeMethod: 'item/reasoning/delta',
            text: 'Replay-only reasoning with a different native id',
          }),
          itemId: 'rs-native-id',
          nativeTurnId: 'turn-1',
        },
        {
          ...event('11', 'command_activity', {
            nativeMethod: 'item/commandExecution/completed',
            command: 'den/get_task',
            output: 'completed',
            status: 'completed',
          }),
          itemId: 'exec-native-id',
          nativeTurnId: 'turn-1',
        },
      ],
    );

    expect(messages.map((message) => message.blocks[0]?.content)).toEqual([
      'Canonical reasoning',
      'Canonical final answer',
    ]);
    expect(messages.at(-1)?.metadata?.['messagePhase']).toBe('final_answer');
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

  it('preserves commentary and final-answer phases from completed snapshots', () => {
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
            durationMs: 1,
            items: [
              {
                itemId: 'commentary',
                kind: 'agentMessage',
                text: 'I am checking the runtime.',
                messagePhase: 'commentary',
              },
              {
                itemId: 'command',
                kind: 'commandExecution',
                text: 'pnpm test',
              },
              {
                itemId: 'final',
                kind: 'agentMessage',
                text: 'The runtime is healthy.',
                messagePhase: 'final_answer',
              },
            ],
          },
        ],
      },
      [],
    );

    expect(
      messages.map((message) => message.metadata?.['messagePhase']),
    ).toEqual(['commentary', undefined, 'final_answer']);
    expect(messages.map((message) => message.blocks[0]?.content)).toEqual([
      'I am checking the runtime.',
      'pnpm test',
      'The runtime is healthy.',
    ]);
  });

  it('uses full lifecycle phase without making phase-less deltas terminal', () => {
    const events = [
      {
        ...event('1', 'item_lifecycle', {
          nativeMethod: 'item/started',
          text: 'Working',
          messagePhase: 'commentary',
        }),
        itemId: 'message-1',
      },
      {
        ...event('2', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'Working',
        }),
        itemId: 'message-1',
      },
      {
        ...event('3', 'item_lifecycle', {
          nativeMethod: 'item/completed',
          text: 'Working',
          messagePhase: 'commentary',
        }),
        itemId: 'message-1',
      },
      {
        ...event('4', 'item_lifecycle', {
          nativeMethod: 'item/completed',
          text: 'Done',
          messagePhase: 'final_answer',
        }),
        itemId: 'message-2',
      },
      event('5', 'turn_lifecycle', {
        nativeMethod: 'turn/completed',
        status: 'completed',
      }),
    ];

    const messages = projectExternalAgentTranscript(undefined, events);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.metadata?.['messagePhase']).toBe('commentary');
    expect(messages[1]?.metadata?.['messagePhase']).toBe('final_answer');
    expect(messages.every((message) => message.status === 'completed')).toBe(
      true,
    );
  });

  it('renders durable failed-thread diagnostics without raw detail', () => {
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread-1',
        sessionId: 'session-1',
        parentThreadId: null,
        preview: 'failed prompt',
        ephemeral: false,
        modelProvider: 'openai',
        effectiveModel: 'gpt-5.6',
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
            status: 'failed',
            statusSource: 'crew_terminal',
            terminalReasonCode: 'codex_failed',
            error: {
              message: 'response stream disconnected',
              code: 'responseStreamDisconnected',
              additionalDetails: 'upstream closed before final answer',
              willRetry: false,
            },
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            items: [
              {
                itemId: 'generic-error',
                kind: 'error',
                text: 'SystemError',
              },
            ],
          },
        ],
      },
      [],
    );

    expect(messages.map((message) => message.blocks[0]?.content)).toEqual([
      'SystemError',
      expect.stringContaining('Message: response stream disconnected'),
    ]);
    expect(messages.at(-1)).toMatchObject({
      status: 'error',
      metadata: {
        statusSource: 'crew_terminal',
        terminalReasonCode: 'codex_failed',
        retrying: false,
      },
      blocks: [
        {
          kind: 'external_turn_error',
          tool: {
            name: 'Codex turn failed',
            status: 'failed',
            summary: 'response stream disconnected',
            reasonCode: 'codex_failed',
          },
        },
      ],
    });
    expect(messages.at(-1)?.blocks[0]?.content).toContain(
      'Additional details: upstream closed before final answer',
    );
  });

  it('keeps retrying errors visible and non-terminal until a final failure', () => {
    const retrying = event('10', 'runtime_warning', {
      nativeMethod: 'error',
      error: {
        message: 'temporary stream interruption',
        code: 'responseStreamConnectionFailed',
        additionalDetails: null,
        willRetry: true,
      },
    });
    const retryingMessages = projectExternalAgentTranscript(undefined, [
      retrying,
    ]);

    expect(retryingMessages[0]).toMatchObject({
      status: 'streaming',
      blocks: [
        {
          kind: 'external_turn_error',
          tool: {
            name: 'Codex retrying',
            status: 'running',
            summary: 'temporary stream interruption',
          },
        },
      ],
    });

    const failedMessages = projectExternalAgentTranscript(undefined, [
      retrying,
      event('11', 'runtime_warning', {
        nativeMethod: 'error',
        error: {
          message: 'response stream disconnected',
          code: 'responseStreamDisconnected',
          additionalDetails: 'upstream closed',
          willRetry: false,
        },
      }),
    ]);
    expect(failedMessages).toHaveLength(1);
    expect(failedMessages[0]).toMatchObject({
      status: 'error',
      blocks: [
        {
          tool: {
            name: 'Codex turn failed',
            status: 'failed',
            summary: 'response stream disconnected',
          },
        },
      ],
    });
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

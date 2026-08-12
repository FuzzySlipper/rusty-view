import { describe, expect, it } from 'vitest';
import type {
  ExternalRuntimeDocumentReference,
  ExternalRuntimeMediaReference,
  NormalizedExternalRuntimeEvent,
} from '@rusty-view/protocol';
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

  it('projects immutable external input images on historical user rows', () => {
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread',
        sessionId: 'session',
        parentThreadId: null,
        preview: 'image feedback',
        ephemeral: false,
        modelProvider: 'openai',
        effectiveModel: 'gpt-5.6',
        createdAt: 1,
        updatedAt: 2,
        status: 'idle',
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
                text: 'Inspect this image.',
                inputImages: [
                  {
                    attachmentId: 'attachment:image',
                    filename: 'clipboard.png',
                    mimeType: 'image/png',
                    byteSize: 128,
                    sha256:
                      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    contentUrl:
                      '/v1/chat/sessions/session/attachments/attachment%3Aimage/content',
                  },
                ],
              },
            ],
          },
        ],
      },
      [],
    );

    expect(messages[0]?.blocks).toEqual([
      expect.objectContaining({ kind: 'text', content: 'Inspect this image.' }),
      expect.objectContaining({
        kind: 'attachment',
        attachments: [
          expect.objectContaining({
            id: 'attachment:image',
            url: '/v1/chat/sessions/session/attachments/attachment%3Aimage/content',
            contentSha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }),
        ],
      }),
    ]);
  });

  it('projects one native turn as one user prompt and one stable assistant card', () => {
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
        status: 'idle',
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
                text: 'Check it.',
              },
              {
                itemId: 'reasoning',
                kind: 'reasoning',
                text: 'Checking.',
              },
              {
                itemId: 'command',
                kind: 'commandExecution',
                text: 'pnpm test',
              },
              {
                itemId: 'final',
                kind: 'agentMessage',
                text: 'Done.',
                messagePhase: 'final_answer',
              },
            ],
          },
        ],
      },
      [],
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.author.role).toBe('user');
    expect(messages[1]).toMatchObject({
      id: 'external:thread:turn:assistant',
      author: { role: 'assistant' },
      status: 'completed',
      metadata: {
        nativeThreadId: 'thread',
        nativeTurnId: 'turn',
        externalAgentText: true,
        messagePhase: 'final_answer',
      },
    });
    expect(messages[1]?.blocks.map((block) => block.kind)).toEqual([
      'reasoning',
      'command',
      'text',
    ]);
    expect(messages[1]?.blocks.map((block) => block.id)).toEqual([
      'block:reasoning',
      'block:command',
      'block:final',
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
    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks[1]?.tool?.status).toBe('completed');
    expect(messages[0]?.blocks[2]?.content).toContain('src/app.ts');
    expect(messages.every((message) => message.status === 'completed')).toBe(
      true,
    );
    expect(messages[0]?.blocks.at(-1)?.tool).toMatchObject({
      name: 'Aggregate diff',
      status: 'completed',
    });
    expect(messages[0]?.blocks.at(-1)?.metadata).toEqual({
      boundedDetailRef: 'detail-empty-final-diff',
      boundedDetailRefs: ['detail-diff', 'detail-empty-final-diff'],
      externalItemId: 'turn-1:turn_lifecycle',
      externalItemKind: 'turn_lifecycle',
      externalRuntimeId: 'runtime-1',
    });
    expect(messages[0]?.blocks.at(-1)?.content).toContain(
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

  it('keeps turnless slash commands between the snapshot turns they preceded', () => {
    const thread = {
      threadId: 'thread-1',
      sessionId: 'session-1',
      parentThreadId: null,
      preview: 'later prompt',
      ephemeral: false,
      modelProvider: 'openai',
      effectiveModel: 'gpt-5.6',
      createdAt: 100,
      updatedAt: 400,
      status: 'idle',
      cwd: '/workspace',
      cliVersion: '0.144.1',
      name: null,
      agentNickname: null,
      agentRole: null,
      turns: [
        {
          turnId: 'turn-before',
          status: 'completed',
          startedAt: 100,
          completedAt: 150,
          durationMs: 50_000,
          items: [
            {
              itemId: 'user-before',
              kind: 'userMessage',
              text: 'First prompt',
            },
            {
              itemId: 'assistant-before',
              kind: 'agentMessage',
              text: 'First answer',
            },
          ],
        },
        {
          turnId: 'turn-after',
          status: 'completed',
          startedAt: 300,
          completedAt: 350,
          durationMs: 50_000,
          items: [
            {
              itemId: 'user-after',
              kind: 'userMessage',
              text: 'Later prompt',
            },
            {
              itemId: 'assistant-after',
              kind: 'agentMessage',
              text: 'Later answer',
            },
          ],
        },
      ],
    };
    const effortStarted = {
      ...event('200', 'command_started', {
        nativeMethod: 'rustyCrew/externalCommand',
        status: 'pending',
        command: 'effort',
        argument: 'medium',
      }),
      nativeTurnId: null,
      requestId: 'effort-command',
      createdAt: '1970-01-01T00:03:20.000Z',
    };
    const effortCompleted = {
      ...event('201', 'command_completed', {
        nativeMethod: 'rustyCrew/externalCommand',
        status: 'applied',
        command: 'effort',
        argument: 'medium',
        message: 'Reasoning effort set to medium.',
      }),
      nativeTurnId: null,
      requestId: 'effort-command',
      createdAt: '1970-01-01T00:03:20.100Z',
    };
    const laterEffortStarted = {
      ...event('250', 'command_started', {
        nativeMethod: 'rustyCrew/externalCommand',
        status: 'pending',
        command: 'effort',
        argument: 'high',
      }),
      nativeTurnId: null,
      requestId: 'later-effort-command',
      createdAt: '1970-01-01T00:04:10.000Z',
    };
    const laterEffortCompleted = {
      ...event('251', 'command_completed', {
        nativeMethod: 'rustyCrew/externalCommand',
        status: 'applied',
        command: 'effort',
        argument: 'high',
        message: 'Reasoning effort set to high.',
      }),
      nativeTurnId: null,
      requestId: 'later-effort-command',
      createdAt: '1970-01-01T00:04:10.100Z',
    };
    const laterAssistantPhase = {
      ...event('301', 'assistant_text_delta', {
        nativeMethod: 'item/agentMessage/delta',
        text: 'Later answer',
        messagePhase: 'final_answer',
      }),
      nativeTurnId: 'turn-after',
      itemId: 'assistant-after',
      createdAt: '1970-01-01T00:05:01.000Z',
    };

    const messages = projectExternalAgentTranscript(thread, [
      effortStarted,
      effortCompleted,
      laterEffortStarted,
      laterEffortCompleted,
      laterAssistantPhase,
    ]);

    expect(
      messages.map((message) =>
        message.blocks.map((block) => block.content).join('\n'),
      ),
    ).toEqual([
      'First prompt',
      'First answer',
      'Reasoning effort set to medium.',
      'Reasoning effort set to high.',
      'Later prompt',
      'Later answer',
    ]);
    expect(messages[2]).toMatchObject({
      id: 'external-event:external-command:effort-command',
      status: 'completed',
      blocks: [
        expect.objectContaining({
          kind: 'command',
          tool: expect.objectContaining({
            name: '/effort medium',
            status: 'completed',
          }),
        }),
      ],
    });
    expect(messages[3]).toMatchObject({
      id: 'external-event:external-command:later-effort-command',
      status: 'completed',
      blocks: [
        expect.objectContaining({
          kind: 'command',
          tool: expect.objectContaining({
            name: '/effort high',
            status: 'completed',
          }),
        }),
      ],
    });
    expect(messages[4]?.metadata?.['messagePhase']).toBeUndefined();
    expect(messages[5]?.metadata?.['messagePhase']).toBe('final_answer');
    expect(messages[5]?.blocks[0]?.metadata?.['messagePhase']).toBe(
      'final_answer',
    );
  });

  it('coalesces command execution output deltas into one stable block', () => {
    const started = {
      ...event('1', 'command_activity', {
        nativeMethod: 'item/started',
        status: 'inProgress',
        command: 'cargo test --locked',
        cwd: '/workspace',
      }),
      itemId: 'command-1',
      rawDetailRef: 'command-started',
    };
    const firstDelta = {
      ...event('2', 'command_activity', {
        nativeMethod: 'item/commandExecution/outputDelta',
        text: 'Compiling crate-a\n',
      }),
      itemId: 'command-1',
      rawDetailRef: 'command-delta-1',
    };
    const secondDelta = {
      ...event('3', 'command_activity', {
        nativeMethod: 'item/commandExecution/outputDelta',
        text: 'Compiling crate-b\n',
      }),
      itemId: 'command-1',
      rawDetailRef: 'command-delta-2',
    };

    const running = projectExternalAgentTranscript(undefined, [
      started,
      firstDelta,
      secondDelta,
    ]);
    const completed = projectExternalAgentTranscript(undefined, [
      started,
      firstDelta,
      secondDelta,
      {
        ...event('4', 'command_activity', {
          nativeMethod: 'item/completed',
          status: 'completed',
          command: 'cargo test --locked',
          cwd: '/workspace',
          output: 'Compiling crate-a\nCompiling crate-b\n2 passed\n',
        }),
        itemId: 'command-1',
        rawDetailRef: 'command-completed',
      },
    ]);

    expect(running).toHaveLength(1);
    expect(running[0]?.blocks).toHaveLength(1);
    expect(running[0]?.blocks[0]).toMatchObject({
      id: 'block:command-1',
      kind: 'command',
      content: 'Compiling crate-a\nCompiling crate-b\n',
      tool: {
        name: 'cargo test --locked',
        status: 'running',
      },
      metadata: {
        boundedDetailRefs: [
          'command-started',
          'command-delta-1',
          'command-delta-2',
        ],
      },
    });
    expect(completed[0]?.blocks).toHaveLength(1);
    expect(completed[0]?.blocks[0]).toMatchObject({
      id: 'block:command-1',
      content: 'Compiling crate-a\nCompiling crate-b\n2 passed\n',
      tool: {
        name: 'cargo test --locked',
        status: 'completed',
      },
    });
  });

  it('preserves command identity and failure without ending the active turn', () => {
    const messages = projectExternalAgentTranscript(undefined, [
      {
        ...event('1', 'command_activity', {
          nativeMethod: 'item/started',
          status: 'inProgress',
          command: 'cargo check --locked',
          cwd: '/workspace',
        }),
        itemId: 'command-failed',
      },
      {
        ...event('2', 'command_activity', {
          nativeMethod: 'item/commandExecution/outputDelta',
          text: 'error: could not compile\n',
        }),
        itemId: 'command-failed',
      },
      {
        ...event('3', 'command_activity', {
          nativeMethod: 'item/completed',
          status: 'failed',
          command: 'cargo check --locked',
          cwd: '/workspace',
          output: 'error: could not compile\n',
          exitCode: 101,
        }),
        itemId: 'command-failed',
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('streaming');
    expect(messages[0]?.blocks).toHaveLength(1);
    expect(messages[0]?.blocks[0]).toMatchObject({
      id: 'block:command-failed',
      content: 'error: could not compile\n',
      tool: {
        name: 'cargo check --locked',
        status: 'failed',
      },
    });
  });

  it('bounds a long command output while retaining its newest tail', () => {
    const output = `${'old output\n'.repeat(7_000)}LATEST_COMMAND_MARKER`;
    const messages = projectExternalAgentTranscript(undefined, [
      {
        ...event('1', 'command_activity', {
          nativeMethod: 'item/completed',
          status: 'completed',
          command: 'cargo test',
          output,
        }),
        itemId: 'long-command',
      },
    ]);
    const content = messages[0]?.blocks[0]?.content ?? '';

    expect(messages[0]?.blocks).toHaveLength(1);
    expect(content).toContain('[... earlier command output omitted ...]');
    expect(content).toContain('LATEST_COMMAND_MARKER');
    expect(content.length).toBeLessThanOrEqual(64_050);
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

  it('keeps the turn message identity stable as new live items arrive', () => {
    const reasoning = {
      ...event('1', 'reasoning_delta', {
        nativeMethod: 'item/reasoning/delta',
        text: 'Thinking',
      }),
      itemId: 'reasoning',
    };
    const before = projectExternalAgentTranscript(undefined, [reasoning]);
    const after = projectExternalAgentTranscript(undefined, [
      reasoning,
      {
        ...event('2', 'command_activity', {
          nativeMethod: 'item/commandExecution/completed',
          command: 'pnpm test',
          output: 'passed',
          status: 'completed',
        }),
        itemId: 'command',
      },
      {
        ...event('3', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'Done',
        }),
        itemId: 'final',
      },
    ]);

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.blocks.map((block) => block.id)).toEqual([
      'block:reasoning',
      'block:command',
      'block:final',
    ]);
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

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks.map((block) => block.content)).toEqual([
      'Canonical reasoning',
      'Canonical final answer',
    ]);
    expect(messages[0]?.metadata?.['messagePhase']).toBe('final_answer');
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

  it('continues the exact covered block inside a compact snapshot turn', () => {
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
            items: [
              { itemId: 'reasoning', kind: 'reasoning', text: 'Thought' },
              { itemId, kind: 'agentMessage', text: 'Hello' },
            ],
          },
        ],
      },
      [
        {
          ...event('10', 'assistant_text_delta', {
            nativeMethod: 'item/agentMessage/delta',
            text: 'Hello world',
          }),
          itemId,
        },
      ],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks.map((block) => block.content)).toEqual([
      'Thought',
      'Hello world',
    ]);
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

  it('coalesces a dynamic tool start and failed result into one readable block', () => {
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
        cwd: '/workspace',
        cliVersion: '0.146.0',
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
                text: 'Calling the tool.',
                messagePhase: 'commentary',
              },
              {
                itemId: 'final',
                kind: 'agentMessage',
                text: 'The failure was intentional.',
                messagePhase: 'final_answer',
              },
            ],
          },
        ],
      },
      [
        {
          ...event('1', 'dynamic_tool_activity', {
            nativeMethod: 'item/started',
            status: 'inProgress',
            tool: 'complete_routed_review',
          }),
          itemId: 'tool-1',
        },
        {
          ...event('2', 'dynamic_tool_activity', {
            nativeMethod: 'item/completed',
            status: 'failed',
            tool: 'complete_routed_review',
            success: false,
            text: 'No managed review submission exists for this message.',
          }),
          itemId: 'tool-1',
        },
      ],
    );

    const blocks = messages
      .flatMap((message) => message.blocks)
      .filter((block) => block.kind === 'tool_call');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(
      expect.objectContaining({
        id: 'block:tool-1',
        kind: 'tool_call',
        content: 'No managed review submission exists for this message.',
        tool: expect.objectContaining({
          name: 'complete_routed_review',
          status: 'failed',
        }),
      }),
    );
    expect(messages[0]?.blocks.map((block) => block.kind)).toEqual([
      'text',
      'tool_call',
      'text',
    ]);
  });

  it('coalesces a successful dynamic tool lifecycle and shows its result', () => {
    const messages = projectExternalAgentTranscript(undefined, [
      {
        ...event('1', 'dynamic_tool_activity', {
          nativeMethod: 'item/started',
          status: 'inProgress',
          tool: 'send_agent_message',
        }),
        itemId: 'tool-2',
      },
      {
        ...event('2', 'dynamic_tool_activity', {
          nativeMethod: 'item/completed',
          status: 'completed',
          tool: 'send_agent_message',
          success: true,
          text: 'Message delivered.',
        }),
        itemId: 'tool-2',
      },
    ]);

    const blocks = messages.flatMap((message) => message.blocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(
      expect.objectContaining({
        id: 'block:tool-2',
        content: 'Message delivered.',
        tool: expect.objectContaining({
          name: 'send_agent_message',
          status: 'completed',
        }),
      }),
    );
  });

  it('places ordered media after its tool and before later active-turn commentary', () => {
    const media: readonly ExternalRuntimeMediaReference[] = [
      {
        mediaIndex: 0,
        captureSource: 'dynamic_tool_input_image',
        captureState: 'available',
        attachmentId: 'attachment:first',
        filename: 'proof.png',
        mimeType: 'image/png',
        byteSize: 120,
        sha256: 'a'.repeat(64),
        width: 12,
        height: 10,
        contentUrl: '/v1/chat/sessions/session-1/attachments/first/content',
      },
      {
        mediaIndex: 1,
        captureSource: 'dynamic_tool_input_image',
        captureState: 'available',
        attachmentId: 'attachment:second',
        filename: 'proof-2.png',
        mimeType: 'image/png',
        byteSize: 240,
        sha256: 'b'.repeat(64),
        width: 24,
        height: 20,
        contentUrl: '/v1/chat/sessions/session-1/attachments/second/content',
      },
    ];
    const events: NormalizedExternalRuntimeEvent[] = [
      {
        ...event('1', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'I am opening the screenshots.',
          messagePhase: 'commentary',
        }),
        itemId: 'commentary-before',
      },
      {
        ...event('2', 'dynamic_tool_activity', {
          nativeMethod: 'item/started',
          status: 'inProgress',
          tool: 'view_image',
        }),
        itemId: 'view-images',
      },
      {
        ...event('3', 'dynamic_tool_activity', {
          nativeMethod: 'item/completed',
          status: 'completed',
          tool: 'view_image',
          success: true,
          media,
        }),
        itemId: 'view-images',
      },
      {
        ...event('4', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'The second screenshot shows the mismatch.',
          messagePhase: 'commentary',
        }),
        itemId: 'commentary-after',
      },
    ];

    const messages = projectExternalAgentTranscript(undefined, events);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('streaming');
    expect(messages[0]?.blocks.map((block) => block.kind)).toEqual([
      'text',
      'tool_call',
      'attachment',
      'text',
    ]);
    const mediaBlock = messages[0]?.blocks[2];
    expect(mediaBlock?.attachments?.map((attachment) => attachment.id)).toEqual(
      ['attachment:first', 'attachment:second'],
    );
    expect(mediaBlock?.attachments?.[0]).toMatchObject({
      contentLoadPolicy: 'authenticated_lazy',
      contentState: 'available',
      contentSha256: 'a'.repeat(64),
      width: 12,
      height: 10,
      metadata: { externalSequenceId: 3, mediaIndex: 0 },
    });

    const replayed = projectExternalAgentTranscript(undefined, [
      ...events,
      ...events.slice(2, 3),
    ]);
    expect(
      replayed
        .flatMap((message) => message.blocks)
        .filter((block) => block.kind === 'attachment'),
    ).toHaveLength(1);
  });

  it('keeps later same-filename checkpoints separate and preserves unavailable state', () => {
    const first = {
      ...event('10', 'item_lifecycle', {
        nativeMethod: 'item/completed',
        media: [
          {
            mediaIndex: 0,
            captureSource: 'image_view_path',
            captureState: 'available',
            attachmentId: 'attachment:revision-one',
            filename: 'proof.png',
            mimeType: 'image/png',
            byteSize: 10,
            sha256: '1'.repeat(64),
            width: 1,
            height: 1,
            contentUrl: '/content/one',
          },
        ],
      }),
      itemId: 'view-one',
    };
    const second = {
      ...event('11', 'item_lifecycle', {
        nativeMethod: 'item/completed',
        media: [
          {
            mediaIndex: 0,
            captureSource: 'image_view_path',
            captureState: 'available',
            attachmentId: 'attachment:revision-two',
            filename: 'proof.png',
            mimeType: 'image/png',
            byteSize: 20,
            sha256: '2'.repeat(64),
            width: 2,
            height: 2,
            contentUrl: '/content/two',
          },
        ],
      }),
      itemId: 'view-two',
    };
    const unavailable = {
      ...event('12', 'item_lifecycle', {
        nativeMethod: 'item/completed',
        media: [
          {
            mediaIndex: 0,
            captureSource: 'image_view_path',
            captureState: 'unavailable',
            reasonCode: 'external_media_source_unavailable',
          },
        ],
      }),
      itemId: 'view-missing',
    };

    const blocks = projectExternalAgentTranscript(undefined, [
      first,
      second,
      unavailable,
    ]).flatMap((message) => message.blocks);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.attachments?.[0]?.id)).toEqual([
      'attachment:revision-one',
      'attachment:revision-two',
      'external-media:runtime-1:thread-1:turn-1:view-missing:0',
    ]);
    expect(blocks[2]?.attachments?.[0]).toMatchObject({
      contentState: 'unavailable',
      url: undefined,
      metadata: { reasonCode: 'external_media_source_unavailable' },
    });
  });

  it('projects ordered document checkpoints, deduplicates replay, and keeps later revisions distinct', () => {
    const documents: readonly ExternalRuntimeDocumentReference[] = [
      {
        documentIndex: 0,
        captureSource: 'agent_message_file_link',
        captureState: 'available',
        attachmentId: 'attachment:markdown-v1',
        filename: 'checkpoint.md',
        mimeType: 'text/markdown',
        languageHint: 'markdown',
        byteSize: 55,
        sha256: 'a'.repeat(64),
        contentUrl: '/content/markdown-v1',
      },
      {
        documentIndex: 1,
        captureSource: 'agent_message_file_link',
        captureState: 'available',
        attachmentId: 'attachment:rust-v1',
        filename: 'checkpoint.rs',
        mimeType: 'text/x-rust',
        languageHint: 'rust',
        byteSize: 50,
        sha256: 'b'.repeat(64),
        contentUrl: '/content/rust-v1',
      },
    ];
    const first = {
      ...event('20', 'item_lifecycle', {
        nativeMethod: 'item/completed',
        text: 'Markdown checkpoint\nRust checkpoint',
        documents,
      }),
      itemId: 'checkpoint-v1',
    };
    const second = {
      ...event('21', 'item_lifecycle', {
        nativeMethod: 'item/completed',
        text: 'Markdown checkpoint V2',
        documents: [
          {
            ...documents[0],
            attachmentId: 'attachment:markdown-v2',
            sha256: 'c'.repeat(64),
            contentUrl: '/content/markdown-v2',
          },
        ],
      }),
      itemId: 'checkpoint-v2',
    };
    const missing = {
      ...event('22', 'item_lifecycle', {
        nativeMethod: 'item/completed',
        documents: [
          {
            documentIndex: 0,
            captureSource: 'agent_message_file_link' as const,
            captureState: 'missing' as const,
            reasonCode: 'external_document_missing',
          },
        ],
      }),
      itemId: 'checkpoint-missing',
    };

    const blocks = projectExternalAgentTranscript(undefined, [
      first,
      first,
      second,
      missing,
    ]).flatMap((message) => message.blocks);
    expect(blocks).toHaveLength(3);
    expect(
      blocks.map((block) => block.metadata?.['externalDocuments']),
    ).toEqual([true, true, true]);
    expect(blocks[0]?.attachments).toEqual([
      expect.objectContaining({
        id: 'attachment:markdown-v1',
        kind: 'file',
        contentState: 'available',
        contentLoadPolicy: 'authenticated_lazy',
        contentSha256: 'a'.repeat(64),
        metadata: expect.objectContaining({
          documentIndex: 0,
          languageHint: 'markdown',
          externalSequenceId: 20,
        }),
      }),
      expect.objectContaining({
        id: 'attachment:rust-v1',
        metadata: expect.objectContaining({ documentIndex: 1 }),
      }),
    ]);
    expect(blocks[1]?.attachments?.[0]).toMatchObject({
      id: 'attachment:markdown-v2',
      contentSha256: 'c'.repeat(64),
    });
    expect(blocks[2]?.attachments?.[0]).toMatchObject({
      contentState: 'missing',
      url: undefined,
      metadata: { reasonCode: 'external_document_missing' },
    });
  });

  it('preserves document checkpoints when a terminal snapshot covers their text', () => {
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
                itemId: 'checkpoint',
                kind: 'agentMessage',
                text: 'Markdown checkpoint',
                messagePhase: 'commentary',
              },
              {
                itemId: 'final',
                kind: 'agentMessage',
                text: 'Done.',
                messagePhase: 'final_answer',
              },
            ],
          },
        ],
      },
      [
        {
          ...event('20', 'item_lifecycle', {
            nativeMethod: 'item/completed',
            text: 'Markdown checkpoint',
            messagePhase: 'commentary',
            documents: [
              {
                documentIndex: 0,
                captureSource: 'agent_message_file_link',
                captureState: 'available',
                attachmentId: 'attachment:markdown-v1',
                filename: 'checkpoint.md',
                mimeType: 'text/markdown',
                byteSize: 55,
                sha256: 'a'.repeat(64),
                contentUrl: '/content/markdown-v1',
              },
            ],
          }),
          itemId: 'checkpoint',
        },
      ],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks.map((block) => block.kind)).toEqual([
      'text',
      'text',
      'attachment',
    ]);
    expect(messages[0]?.blocks[2]).toMatchObject({
      metadata: expect.objectContaining({ externalDocuments: true }),
      attachments: [expect.objectContaining({ id: 'attachment:markdown-v1' })],
    });
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

    expect(messages).toHaveLength(1);
    expect(messages[0]?.metadata?.['messagePhase']).toBe('final_answer');
    expect(
      messages[0]?.blocks.map((block) => block.metadata?.['messagePhase']),
    ).toEqual(['commentary', undefined, 'final_answer']);
    expect(messages[0]?.blocks.map((block) => block.content)).toEqual([
      'I am checking the runtime.',
      'pnpm test',
      'The runtime is healthy.',
    ]);
  });

  it('suppresses contentless generic snapshot items around meaningful phased messages', () => {
    const messages = projectExternalAgentTranscript(
      {
        threadId: 'thread-1',
        sessionId: 'session-1',
        parentThreadId: null,
        preview: 'review transcript',
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
            status: 'completed',
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            items: [
              { itemId: 'empty-before', kind: 'item' },
              {
                itemId: 'commentary',
                kind: 'agentMessage',
                text: 'Checking the implementation.',
                messagePhase: 'commentary',
              },
              { itemId: 'empty-middle', kind: 'item', summary: [] },
              {
                itemId: 'final',
                kind: 'agentMessage',
                text: 'Approved.',
                messagePhase: 'final_answer',
              },
              { itemId: 'empty-after', kind: 'item', text: '   ' },
            ],
          },
        ],
      },
      [],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks.map((block) => block.content)).toEqual([
      'Checking the implementation.',
      'Approved.',
    ]);
    expect(messages[0]?.blocks.map((block) => block.metadata)).toEqual([
      expect.objectContaining({ messagePhase: 'commentary' }),
      expect.objectContaining({ messagePhase: 'final_answer' }),
    ]);
    expect(
      messages
        .flatMap((message) => message.blocks)
        .some((block) => /^item$/i.test(block.content.trim())),
    ).toBe(false);
  });

  it('lets a meaningful live event fill a skipped generic snapshot identity once', () => {
    const snapshot = {
      threadId: 'thread-1',
      sessionId: 'session-1',
      parentThreadId: null,
      preview: 'active transcript',
      ephemeral: false,
      modelProvider: 'openai',
      effectiveModel: 'gpt-5.6',
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
          items: [{ itemId: 'late-item', kind: 'item' }],
        },
      ],
    };
    const events = [
      {
        ...event('101', 'assistant_text_delta', {
          nativeMethod: 'item/agentMessage/delta',
          text: 'Recovered meaningful content',
        }),
        itemId: 'late-item',
      },
      {
        ...event('102', 'item_lifecycle', {
          nativeMethod: 'item/completed',
          status: 'completed',
        }),
        itemId: 'late-item',
      },
    ];

    const messages = projectExternalAgentTranscript(snapshot, events);
    const recovered = messages
      .flatMap((message) => message.blocks)
      .filter((block) => block.content === 'Recovered meaningful content');

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.metadata).toEqual(
      expect.objectContaining({ externalItemId: 'late-item' }),
    );
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

    expect(messages).toHaveLength(1);
    expect(messages[0]?.metadata?.['messagePhase']).toBe('final_answer');
    expect(
      messages[0]?.blocks.map((block) => block.metadata?.['messagePhase']),
    ).toEqual(['commentary', 'final_answer']);
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

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks.map((block) => block.content)).toEqual([
      'SystemError',
      expect.stringContaining('Message: response stream disconnected'),
    ]);
    expect(messages[0]).toMatchObject({
      status: 'error',
      metadata: {
        statusSource: 'crew_terminal',
        terminalReasonCode: 'codex_failed',
        retrying: false,
      },
    });
    expect(messages[0]?.blocks[1]).toMatchObject({
      kind: 'external_turn_error',
      tool: {
        name: 'Codex turn failed',
        status: 'failed',
        summary: 'response stream disconnected',
        reasonCode: 'codex_failed',
      },
    });
    expect(messages[0]?.blocks.at(-1)?.content).toContain(
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

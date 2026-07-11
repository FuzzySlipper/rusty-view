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
    ]);
    expect(messages[1]?.blocks[0]?.tool?.status).toBe('completed');
    expect(messages[2]?.blocks[0]?.content).toContain('src/app.ts');
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
    nativeThreadId: `thread-${eventId}`,
    nativeTurnId: `turn-${eventId}`,
    payload,
  };
}

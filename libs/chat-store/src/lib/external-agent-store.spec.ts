import type { NormalizedExternalRuntimeEvent } from '@rusty-view/protocol';
import { describe, expect, it } from 'vitest';

import {
  activeExternalTurnId,
  latestExternalTurnPhase,
} from './external-agent-store';

describe('external agent lifecycle reduction', () => {
  it('ignores statusless diff notifications after a turn starts', () => {
    const events = [
      event(10, 'turn-old', 'completed'),
      event(20, 'turn-new', 'inProgress'),
      event(21, 'turn-new'),
    ];

    expect(latestExternalTurnPhase(events)).toBe('active');
    expect(activeExternalTurnId(events)).toBe('turn-new');
  });

  it('uses sequence order and closes the matching active turn', () => {
    const events = [
      event(30, 'turn-new', 'completed'),
      event(20, 'turn-new', 'inProgress'),
      event(25, 'turn-new'),
    ];

    expect(latestExternalTurnPhase(events)).toBe('completed');
    expect(activeExternalTurnId(events)).toBeUndefined();
  });
});

function event(
  sequenceId: number,
  nativeTurnId: string,
  status?: string,
): NormalizedExternalRuntimeEvent {
  return {
    eventId: `event-${sequenceId}`,
    runtimeId: 'runtime-1',
    sequenceId,
    createdAt: '2026-07-11T00:00:00Z',
    kind: 'turn_lifecycle',
    nativeThreadId: 'thread-1',
    nativeTurnId,
    payload: {
      nativeMethod:
        status === undefined ? 'turn/diff/updated' : 'turn/completed',
      ...(status === undefined ? {} : { status }),
    },
  };
}

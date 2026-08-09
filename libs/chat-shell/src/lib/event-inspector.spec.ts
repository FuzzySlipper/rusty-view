import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import type {
  ChatEvent,
  ExternalThreadProjection,
  NormalizedExternalRuntimeEvent,
} from '@rusty-view/protocol';

import { EventInspectorComponent } from './event-inspector';

function ev(overrides: Partial<ChatEvent>): ChatEvent {
  return {
    event_id: 'e1',
    session_id: 's1',
    sequence_id: 1,
    created_at: '2026-06-30T10:00:00Z',
    kind: 'message_created',
    payload: {},
    ...overrides,
  } as ChatEvent;
}

describe('EventInspectorComponent', () => {
  it('emits selectEvent with the clicked row id', () => {
    const fixture = TestBed.createComponent(EventInspectorComponent);
    fixture.componentRef.setInput('events', [
      ev({ event_id: 'e1', sequence_id: 1 }),
      ev({ event_id: 'e2', sequence_id: 37, kind: 'unknown' }),
    ]);
    let emitted: string | undefined;
    fixture.componentInstance.selectEvent.subscribe((id) => {
      emitted = id;
    });
    fixture.detectChanges();

    const rows: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('button.rv-event');
    expect(rows.length).toBe(2);

    rows[1]?.click();
    expect(emitted).toBe('e2');
  });

  it('renders the JSON detail only once an event is selected', () => {
    const fixture = TestBed.createComponent(EventInspectorComponent);
    fixture.componentRef.setInput('events', [
      ev({ event_id: 'e2', sequence_id: 37, kind: 'unknown' }),
    ]);
    fixture.detectChanges();

    // Nothing selected → no detail pane (the bug: it could never appear).
    expect(
      fixture.nativeElement.querySelector('.rv-event-inspector__detail'),
    ).toBeNull();

    fixture.componentRef.setInput('selectedEventId', 'e2');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.rv-event-inspector__detail'),
    ).not.toBeNull();
  });

  it('shows durable status provenance for the selected external turn', () => {
    const fixture = TestBed.createComponent(EventInspectorComponent);
    const event: NormalizedExternalRuntimeEvent = {
      eventId: 'external-1',
      runtimeId: 'runtime-1',
      sequenceId: 1,
      createdAt: '2026-07-27T00:00:00Z',
      kind: 'runtime_warning',
      nativeThreadId: 'thread-1',
      nativeTurnId: 'turn-1',
      payload: {
        nativeMethod: 'error',
        error: {
          message: 'response stream disconnected',
          code: 'responseStreamDisconnected',
          additionalDetails: null,
          willRetry: false,
        },
      },
    };
    const thread: ExternalThreadProjection = {
      threadId: 'thread-1',
      sessionId: 'session-1',
      bindingId: null,
      crewSessionId: null,
      lineage: null,
      nativeMaterialized: true,
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
          error: event.payload.error ?? null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          items: [],
        },
      ],
    };
    fixture.componentRef.setInput('events', [event]);
    fixture.componentRef.setInput('externalThread', thread);
    fixture.componentRef.setInput('selectedEventId', event.eventId);
    fixture.detectChanges();

    const diagnostic = fixture.nativeElement.querySelector(
      '[data-testid="external-turn-diagnostic"]',
    ) as HTMLElement | null;
    expect(diagnostic?.textContent).toContain('failed');
    expect(diagnostic?.textContent).toContain('crew_terminal');
    expect(diagnostic?.textContent).toContain('codex_failed');
  });
});

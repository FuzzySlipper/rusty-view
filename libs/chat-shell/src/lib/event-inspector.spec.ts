import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@rusty-view/protocol';

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
});

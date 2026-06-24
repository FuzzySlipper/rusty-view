import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import type { ChatSessionSummary } from '@rusty-view/protocol';
import { ChatStore, CHAT_STORAGE_ADAPTER } from '@rusty-view/chat-store';
import type { ChatStorageAdapter, ChatUiState } from '@rusty-view/chat-domain';
import { ChatTransport } from '@rusty-view/transport';

import { SessionsPanelComponent } from './sessions-panel';

class InMemStorage implements ChatStorageAdapter {
  async putSession(): Promise<void> { /* noop */ }
  async putEvents(): Promise<void> { /* noop */ }
  async getEvents(): Promise<never[]> {
    return [];
  }
  async getSessions(): Promise<never[]> {
    return [];
  }
  async clearSession(): Promise<void> { /* noop */ }
  async getUiState(): Promise<ChatUiState | null> {
    return null;
  }
  async setUiState(): Promise<void> { /* noop */ }
}

function makeSession(
  overrides: Partial<ChatSessionSummary>,
): ChatSessionSummary {
  return {
    session_id: 's1',
    agent_id: 'a',
    profile_id: 'p1',
    kind: 'full',
    status: 'idle',
    latest_cursor: '',
    updated_at: '2026-06-22T10:00:00Z',
    ...overrides,
  } as ChatSessionSummary;
}

function makeTransport(sessions: ChatSessionSummary[]): ChatTransport {
  return {
    listSessions: async () => ({
      items: sessions,
      total: sessions.length,
      limit: 100,
      offset: 0,
    }),
    openSession: async (sessionId: string) => ({
      session:
        sessions.find((s) => s.session_id === sessionId) ??
        makeSession({ session_id: sessionId }),
      events: [],
      latest_cursor: '',
      has_more_before: false,
    }),
    listCommands: async () => ({ commands: [] }),
    streamEvents: () =>
      ({
        events: async function* () { /* noop */ },
        onStateChange: () => () => undefined,
        getState: () => ({ status: 'idle' }),
        getLastCursor: () => undefined,
        close: () => undefined,
      }) as never,
  } as unknown as ChatTransport;
}

async function createPanel(sessions: ChatSessionSummary[]) {
  await TestBed.configureTestingModule({
    imports: [SessionsPanelComponent],
    providers: [
      ChatStore,
      { provide: ChatTransport, useValue: makeTransport(sessions) },
      { provide: CHAT_STORAGE_ADAPTER, useClass: InMemStorage },
    ],
  }).compileComponents();
  const store = TestBed.inject(ChatStore);
  await store.refreshSessions();
  const fixture = TestBed.createComponent(SessionsPanelComponent);
  fixture.detectChanges();
  return { fixture, store };
}

describe('SessionsPanelComponent', () => {
  it('lists all sessions newest-first', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'old',
        profile_id: 'p1',
        updated_at: '2026-06-01T00:00:00Z',
      }),
      makeSession({
        session_id: 'new',
        profile_id: 'p1',
        updated_at: '2026-06-10T00:00:00Z',
      }),
    ]);
    const rows = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('.rv-sessions-panel__row');
    expect(rows.length).toBe(2);
    const text = Array.from(rows)
      .map((r) => r.textContent)
      .join(' ');
    expect(text.indexOf('new')).toBeLessThan(text.indexOf('old'));
  });

  it('filters sessions by profile chip', async () => {
    const { fixture } = await createPanel([
      makeSession({ session_id: 's1', profile_id: 'p1' }),
      makeSession({ session_id: 's2', profile_id: 'p2' }),
    ]);
    // Click the p1 filter chip.
    const chips = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('.rv-sessions-panel__chip');
    const p1Chip = Array.from(chips).find(
      (c) => c.textContent?.trim() === 'p1',
    );
    p1Chip?.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    const rows = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('.rv-sessions-panel__row');
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('s1');
  });

  it('shows empty state when no sessions match', async () => {
    const { fixture } = await createPanel([]);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('No sessions');
  });
});

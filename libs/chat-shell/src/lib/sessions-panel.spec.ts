import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import type { ChatSessionSummary } from '@rusty-view/protocol';
import {
  AdminStore,
  ChatStore,
  CHAT_STORAGE_ADAPTER,
} from '@rusty-view/chat-store';
import type { ChatStorageAdapter, ChatUiState } from '@rusty-view/chat-domain';
import { ChatTransport } from '@rusty-view/transport';
import type {
  AdminDiagnosticsBundle,
  RuntimePauseDiagnostics,
} from '@rusty-view/transport';

import { SessionsPanelComponent } from './sessions-panel';

class InMemStorage implements ChatStorageAdapter {
  async putSession(): Promise<void> {
    /* noop */
  }
  async putEvents(): Promise<void> {
    /* noop */
  }
  async getEvents(): Promise<never[]> {
    return [];
  }
  async getSessions(): Promise<never[]> {
    return [];
  }
  async clearSession(): Promise<void> {
    /* noop */
  }
  async getUiState(): Promise<ChatUiState | null> {
    return null;
  }
  async setUiState(): Promise<void> {
    /* noop */
  }
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

function adminDiagnostics(
  sessions: ChatSessionSummary[],
  pauses: readonly RuntimePauseDiagnostics[] = [],
): AdminDiagnosticsBundle {
  return {
    overview: {
      generatedAt: '2026-06-25T00:00:00Z',
      health: 'ok',
      degraded: false,
      reasonCodes: [],
      summary: {
        sessions: sessions.length,
        activeSessions: sessions.filter((s) => s.status === 'active').length,
        idleSessions: sessions.filter((s) => s.status === 'idle').length,
        archivedSessions: sessions.filter((s) => s.status === 'archived')
          .length,
        delegatedSessions: 0,
        blockedDelegations: 0,
        pendingQueueItems: 0,
        expiredQueueItems: 0,
        toolErrors: 0,
        recentErrors: 0,
      },
      runtime: {
        brainModules: [],
        sessions: sessions.map((session) => ({
          sessionId: session.session_id,
          agentId: session.agent_id,
          profileId: session.profile_id,
          kind: session.kind,
          status: session.status,
          toolCount: 0,
          brainTurnCount: 0,
          lastActiveAt: session.updated_at,
          stale: false,
        })),
        delegatedSessions: [],
        runtimePauses: pauses,
      },
    },
    health: {},
  };
}

function makePause(sessionId: string): RuntimePauseDiagnostics {
  return {
    pauseId: 'pause:session:s1:1',
    scope: 'session',
    targetId: sessionId,
    pausedBy: 'operator',
    pausedAt: '2026-06-25T00:00:00Z',
    reason: 'operator emergency stop',
    reasonCode: 'runtime_pause_operator',
    affectedSessionIds: [sessionId],
    inFlightWakeCount: 1,
    cancellationSupported: false,
    limitation:
      'Current implementation suppresses new wakes and delivery claims; it does not interrupt an LLM/tool call already in flight.',
  };
}

function makeTransport(
  sessions: ChatSessionSummary[],
  pauses: readonly RuntimePauseDiagnostics[] = [],
): ChatTransport {
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
    adminDiagnostics: async () => adminDiagnostics(sessions, pauses),
    adminSessions: async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    }),
    adminAgents: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    adminMcpSurfaces: async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    }),
    adminConfigValidation: async () => null,
    adminProfileDiagnostics: async () => null,
    adminModelProviders: async () => null,
    adminCapabilities: async () => ({
      schema_version: 1,
      slash_commands: [],
      capabilities: [
        {
          id: 'admin.control.sessions.runtime.pause',
          method: 'POST',
          path_template:
            '/v1/admin/control/sessions/{session_id}/runtime/pause',
          description: 'Pause session runtime.',
          auth: 'admin',
          mutation: 'control',
          stability: 'stable',
          tags: ['session', 'service'],
          public: true,
          command_name: 'pause_runtime',
        },
        {
          id: 'admin.control.sessions.runtime.resume',
          method: 'POST',
          path_template:
            '/v1/admin/control/sessions/{session_id}/runtime/resume',
          description: 'Resume session runtime.',
          auth: 'admin',
          mutation: 'control',
          stability: 'stable',
          tags: ['session', 'service'],
          public: true,
          command_name: 'resume_runtime',
        },
      ],
    }),
    pauseRuntime: async () => ({
      command: { name: 'pause_runtime', target: {}, requestId: 'req' },
      outcome: { status: 'completed', summary: 'paused' },
      audit: { started: true, terminal: true },
      observation: {},
    }),
    resumeRuntime: async () => ({
      command: { name: 'resume_runtime', target: {}, requestId: 'req' },
      outcome: { status: 'completed', summary: 'resumed' },
      audit: { started: true, terminal: true },
      observation: {},
    }),
    streamEvents: () =>
      ({
        events: async function* () {
          /* noop */
        },
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
      AdminStore,
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

async function createPanelWithPauses(
  sessions: ChatSessionSummary[],
  pauses: readonly RuntimePauseDiagnostics[],
) {
  await TestBed.configureTestingModule({
    imports: [SessionsPanelComponent],
    providers: [
      ChatStore,
      AdminStore,
      { provide: ChatTransport, useValue: makeTransport(sessions, pauses) },
      { provide: CHAT_STORAGE_ADAPTER, useClass: InMemStorage },
    ],
  }).compileComponents();
  const store = TestBed.inject(ChatStore);
  await store.refreshSessions();
  const fixture = TestBed.createComponent(SessionsPanelComponent);
  await fixture.whenStable();
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
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.rv-sessions-panel__row',
    );
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
    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.rv-sessions-panel__chip',
    );
    const p1Chip = Array.from(chips).find(
      (c) => c.textContent?.trim() === 'p1',
    );
    p1Chip?.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.rv-sessions-panel__row',
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('s1');
  });

  it('shows empty state when no sessions match', async () => {
    const { fixture } = await createPanel([]);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('No sessions');
  });

  it('shows active runtime pause state for a paused session', async () => {
    const session = makeSession({ session_id: 'paused-session' });
    const { fixture } = await createPanelWithPauses(
      [session],
      [makePause('paused-session')],
    );
    const host: HTMLElement = fixture.nativeElement;

    expect(host.textContent).toContain('runtime paused');
    expect(host.textContent).toContain('operator emergency stop');
    expect(host.textContent).toContain('does not interrupt');
    expect(
      host.querySelector('.rv-sessions-panel__item--paused'),
    ).not.toBeNull();
    expect(
      host.querySelector('.rv-sessions-panel__control')?.textContent,
    ).toContain('Resume Runtime');
  });
});

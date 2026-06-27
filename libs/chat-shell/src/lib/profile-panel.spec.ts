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

import { ProfilePanelComponent } from './profile-panel';

// ---- stubs ----

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
    adminDiagnostics: async () => ({
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
          sessions: [],
          delegatedSessions: [],
          runtimePauses: [],
        },
      },
      health: {},
    }),
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
      capabilities: [],
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
    imports: [ProfilePanelComponent],
    providers: [
      ChatStore,
      AdminStore,
      { provide: ChatTransport, useValue: makeTransport(sessions) },
      { provide: CHAT_STORAGE_ADAPTER, useClass: InMemStorage },
    ],
  }).compileComponents();
  const store = TestBed.inject(ChatStore);
  await store.refreshSessions();
  const fixture = TestBed.createComponent(ProfilePanelComponent);
  fixture.detectChanges();
  return { fixture, store };
}

describe('ProfilePanelComponent', () => {
  it('shows an empty state when there are no profiles', async () => {
    const { fixture } = await createPanel([]);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('No profiles found');
  });

  it('renders one row per profile', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 's1',
        profile_id: 'p1',
        status: 'active',
        updated_at: '2026-06-10T00:00:00Z',
      }),
      makeSession({
        session_id: 's2',
        profile_id: 'p2',
        status: 'archived',
        updated_at: '2026-06-05T00:00:00Z',
      }),
    ]);
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.rv-profile',
    );
    expect(rows.length).toBe(2);
  });

  it('marks the selected profile', async () => {
    const { fixture, store } = await createPanel([
      makeSession({
        session_id: 'live',
        profile_id: 'p1',
        status: 'active',
        updated_at: '2026-06-10T00:00:00Z',
      }),
    ]);
    await store.selectProfile('p1');
    fixture.detectChanges();
    const selected = (fixture.nativeElement as HTMLElement).querySelector(
      '.rv-profile--selected',
    );
    expect(selected?.textContent).toContain('p1');
  });
});

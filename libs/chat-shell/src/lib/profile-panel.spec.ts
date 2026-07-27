import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

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
    coordinationAgentDirectory: async () => ({
      deploymentRole: 'production',
      agents: sessions.map((session) => ({
        agentId: session.agent_id,
        displayLabel: session.profile_id,
        profileId: session.profile_id,
        routable: session.status !== 'archived',
        runtimeKind: session.agent_id.startsWith('external-agent-')
          ? ('codex_app_server' as const)
          : ('direct_brain' as const),
        sessionId: session.session_id,
        sessionKind: session.kind,
        sessionStatus: session.status,
        workdir: session.agent_id.startsWith('external-agent-')
          ? '/home/dev/codex-project'
          : '/home/dev/direct-project',
      })),
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
  it('shows an empty state when there are no agents', async () => {
    const { fixture } = await createPanel([]);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('No agents found');
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

  it('renders every live same-profile session with runtime, workdir, and id', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'direct-session',
        agent_id: 'software-engineer',
        profile_id: 'p1',
        status: 'idle',
      }),
      makeSession({
        session_id: 'managed-session',
        agent_id: 'external-agent-1',
        profile_id: 'p1',
        status: 'idle',
      }),
      makeSession({
        session_id: 'archived-session',
        profile_id: 'p1',
        status: 'archived',
      }),
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-testid="profile-session-row"]',
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.dataset['runtimeKind'])).toEqual([
      'direct_brain',
      'codex_app_server',
    ]);
    expect(rows.map((row) => row.textContent).join(' ')).toContain(
      '/home/dev/direct-project',
    );
    expect(rows.map((row) => row.textContent).join(' ')).toContain(
      'managed-session',
    );
  });

  it('shows effective wake timeout summary per profile', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'capped',
        profile_id: 'p1',
        effective_defaults: { wakeTimeoutMs: 60_000 },
      }),
      makeSession({
        session_id: 'uncapped',
        profile_id: 'p2',
        effective_defaults: {},
      }),
    ]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('turn cap 1 min (60,000 ms)');
    expect(text).not.toContain('turn cap disabled');
    expect(
      fixture.nativeElement.querySelectorAll('.rv-profile__timeout'),
    ).toHaveLength(1);
  });

  it('renders emphasized profile status in normal title case', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'active',
        profile_id: 'p1',
        status: 'active',
      }),
    ]);
    const status = (fixture.nativeElement as HTMLElement).querySelector(
      '.rv-profile__status',
    );

    expect(status?.textContent?.trim()).toBe('Active');
    expect(status?.classList.contains('rv-profile__status--active')).toBe(true);
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

  it('notifies the shell after a profile is selected', async () => {
    const { fixture } = await createPanel([
      makeSession({ session_id: 'live', profile_id: 'p1' }),
    ]);
    const selected = vi.fn();
    fixture.componentInstance.profileSelected.subscribe(selected);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.rv-profile')
      ?.click();

    expect(selected).toHaveBeenCalledOnce();
  });
});

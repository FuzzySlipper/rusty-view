import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSessionSummary } from '@rusty-view/protocol';
import {
  AdminStore,
  ChatStore,
  CHAT_STORAGE_ADAPTER,
  type ExternalAgentSession,
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

class BrowserStorageStub implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
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
        bindingId: session.agent_id.startsWith('external-agent-')
          ? `binding-${session.session_id}`
          : undefined,
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
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new BrowserStorageStub(),
    });
  });

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

  it('emits the profile default session for runtime-aware shell routing', async () => {
    const { fixture } = await createPanel([
      makeSession({ session_id: 'live', profile_id: 'p1' }),
    ]);
    const selected = vi.fn();
    fixture.componentInstance.profileSelected.subscribe(selected);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.rv-profile')
      ?.click();

    expect(selected).toHaveBeenCalledWith('live');
  });

  it('emits an exact Codex session and reflects shell-owned selection', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'direct-session',
        agent_id: 'software-engineer',
        profile_id: 'p1',
      }),
      makeSession({
        session_id: 'managed-session',
        agent_id: 'external-agent-1',
        profile_id: 'p1',
      }),
    ]);
    fixture.componentRef.setInput('selectedSessionId', 'managed-session');
    fixture.detectChanges();
    const selected = vi.fn();
    fixture.componentInstance.profileSelected.subscribe(selected);
    const managed = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('[data-session-id="managed-session"]');

    expect(managed?.classList).toContain('rv-profile-session--selected');
    managed?.click();

    expect(selected).toHaveBeenCalledWith('managed-session');
  });

  it('shows the native Codex phase instead of the coordination status', async () => {
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
    ]);
    fixture.componentRef.setInput('externalSessions', [
      {
        phase: 'completed',
        binding: {
          bindingId: 'binding-managed-session',
          sessionId: 'managed-session',
        },
        thread: { status: 'active' },
      } as unknown as ExternalAgentSession,
    ]);
    fixture.detectChanges();
    const direct = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[data-session-id="direct-session"]');
    const managed = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[data-session-id="managed-session"]');

    expect(direct?.dataset['sessionStatus']).toBe('idle');
    expect(
      direct?.querySelector('.rv-profile-session__status')?.textContent,
    ).toBe('Idle');
    expect(managed?.dataset['sessionStatus']).toBe('completed');
    expect(
      managed?.querySelector('.rv-profile-session__status')?.textContent,
    ).toBe('Completed');
  });

  it('pins profiles first, persists the choice, and does not select them', async () => {
    const sessions = [
      makeSession({
        session_id: 'newer-session',
        profile_id: 'newer-profile',
        updated_at: '2026-07-28T01:00:00Z',
      }),
      makeSession({
        session_id: 'older-session',
        profile_id: 'older-profile',
        updated_at: '2026-07-28T00:00:00Z',
      }),
    ];
    const { fixture } = await createPanel(sessions);
    const selected = vi.fn();
    fixture.componentInstance.profileSelected.subscribe(selected);
    const olderGroup = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>(
      '.rv-profile-group:has([data-profile-id="older-profile"])',
    );

    olderGroup
      ?.querySelector<HTMLButtonElement>('[data-testid="profile-pin"]')
      ?.click();
    fixture.detectChanges();

    expect(selected).not.toHaveBeenCalled();
    expect(profileIds(fixture)).toEqual(['older-profile', 'newer-profile']);
    expect(
      olderGroup
        ?.querySelector('[data-testid="profile-pin"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      JSON.parse(localStorage.getItem('rusty-view:pinned-profiles:v1') ?? '[]'),
    ).toEqual(['older-profile']);

    fixture.destroy();
    TestBed.resetTestingModule();
    const { fixture: reloaded } = await createPanel(sessions);

    expect(profileIds(reloaded)).toEqual(['older-profile', 'newer-profile']);
    expect(
      (reloaded.nativeElement as HTMLElement)
        .querySelector(
          '.rv-profile-group:has([data-profile-id="older-profile"]) [data-testid="profile-pin"]',
        )
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

function profileIds(
  fixture: ComponentFixture<ProfilePanelComponent>,
): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '[data-testid="profile-row"]',
    ),
    (row) => row.dataset['profileId'] ?? '',
  );
}

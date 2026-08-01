import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSessionSummary } from '@rusty-view/protocol';
import {
  AdminStore,
  ChatStore,
  CHAT_STORAGE_ADAPTER,
  ExternalAgentStore,
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
  const externalStore = {
    refresh: vi.fn(async () => undefined),
    lifecyclePendingThreadIds: signal(new Set<string>()),
    metadataPendingBindingIds: signal(new Set<string>()),
    metadataError: signal<string | undefined>(undefined),
    interactions: signal([]),
    updateSessionMetadata: vi.fn(async () => true),
    archiveThread: vi.fn(async () => true),
  };
  await TestBed.configureTestingModule({
    imports: [ProfilePanelComponent],
    providers: [
      ChatStore,
      AdminStore,
      { provide: ExternalAgentStore, useValue: externalStore },
      { provide: ChatTransport, useValue: makeTransport(sessions) },
      { provide: CHAT_STORAGE_ADAPTER, useClass: InMemStorage },
    ],
  }).compileComponents();
  const store = TestBed.inject(ChatStore);
  await store.refreshSessions();
  const fixture = TestBed.createComponent(ProfilePanelComponent);
  fixture.detectChanges();
  return { fixture, store, externalStore };
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

  it('refreshes both unified Crew and Codex inventories from the header', async () => {
    const { fixture, store, externalStore } = await createPanel([
      makeSession({ session_id: 'live', profile_id: 'p1' }),
    ]);
    const crewRefresh = vi.spyOn(store, 'refreshSessions');
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="profile-refresh"]')
      ?.click();
    await fixture.whenStable();

    expect(crewRefresh).toHaveBeenCalled();
    expect(externalStore.refresh).toHaveBeenCalled();
  });

  it('hides archived-only profiles from normal Agents navigation', async () => {
    const { fixture, store } = await createPanel([
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
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-profile-id')).toBe('p1');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'p2',
    );
    expect(store.profiles()).toHaveLength(2);
    expect(store.allSessions()).toHaveLength(2);
  });

  it('shows the empty state when every profile is archived-only', async () => {
    const { fixture, store } = await createPanel([
      makeSession({
        session_id: 'archived-a',
        profile_id: 'p1',
        status: 'archived',
      }),
      makeSession({
        session_id: 'archived-b',
        profile_id: 'p2',
        status: 'archived',
      }),
    ]);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('[data-testid="profile-row"]')).toHaveLength(
      0,
    );
    expect(host.textContent).toContain('No agents found');
    expect(store.profiles()).toHaveLength(2);
    expect(store.allSessions()).toHaveLength(2);
  });

  it('renders every live same-profile session with runtime, workdir, and id', async () => {
    const { fixture, store } = await createPanel([
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
    expect(store.profiles()[0]?.sessions).toHaveLength(3);
    expect(store.allSessions()).toHaveLength(3);
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
    expect(status?.getAttribute('data-status-tone')).toBe('active');
  });

  it('renders the canonical Crew execution phase over a stale legacy idle', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'native-working',
        profile_id: 'p1',
        status: 'idle',
        execution: {
          sessionId: 'native-working',
          lifecycleStatus: 'live',
          phase: 'waiting',
          source: 'logical_turn',
          updatedAt: '2026-07-30T09:00:00Z',
        },
      }),
    ]);
    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '.rv-profile__status',
    );
    const session = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-session-id="native-working"]',
    );

    expect(profile?.textContent?.trim()).toBe('Waiting');
    expect(profile?.getAttribute('data-status-tone')).toBe('warning');
    expect(session?.getAttribute('data-session-status')).toBe('waiting');
    expect(
      session
        ?.querySelector('.rv-profile-session__status')
        ?.getAttribute('data-status-tone'),
    ).toBe('warning');
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

  it('places a compact options control on each exact session without selecting it', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'direct-session',
        agent_id: 'software-engineer',
        profile_id: 'p1',
      }),
    ]);
    const selected = vi.fn();
    fixture.componentInstance.profileSelected.subscribe(selected);
    const options = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>(
      '[data-session-id="direct-session"] + [data-testid="profile-session-options"]',
    );

    expect(options?.textContent?.trim()).toBe('Options');
    options?.click();
    fixture.detectChanges();

    expect(selected).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="session-options-panel"]',
      ),
    ).not.toBeNull();
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
    expect(
      direct
        ?.querySelector('.rv-profile-session__status')
        ?.getAttribute('data-status-tone'),
    ).toBe('idle');
    expect(managed?.dataset['sessionStatus']).toBe('completed');
    expect(
      managed?.querySelector('.rv-profile-session__status')?.textContent,
    ).toBe('Completed');
    expect(
      managed
        ?.querySelector('.rv-profile-session__status')
        ?.getAttribute('data-status-tone'),
    ).toBe('completed');
  });

  it('does not let a retained Crew failure override an idle visible Codex session', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'managed-session',
        agent_id: 'external-agent-1',
        profile_id: 'rusty-engine-planner',
        status: 'idle',
        execution: {
          sessionId: 'managed-session',
          lifecycleStatus: 'live',
          phase: 'idle',
          source: 'runtime_activity',
          lastOutcome: 'failed',
          reasonCode: 'brain_unavailable',
          summary: 'wake dispatch failed',
          updatedAt: '2026-07-28T05:48:33Z',
        },
      }),
    ]);
    fixture.componentRef.setInput('externalSessions', [
      {
        binding: {
          bindingId: 'binding-managed-session',
          sessionId: 'managed-session',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
    ]);
    fixture.detectChanges();

    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-profile-id="rusty-engine-planner"]',
    );
    const session = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-session-id="managed-session"]',
    );

    expect(profile?.getAttribute('data-profile-status')).toBe('idle');
    expect(profile?.querySelector('.rv-profile__status')?.textContent).toBe(
      'Idle',
    );
    expect(session?.getAttribute('data-session-status')).toBe('idle');
  });

  it('uses the current Codex directory status when native inventory is not loaded', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'managed-session',
        agent_id: 'external-agent-1',
        profile_id: 'rusty-engine-planner',
        status: 'idle',
        execution: {
          sessionId: 'managed-session',
          lifecycleStatus: 'live',
          phase: 'idle',
          source: 'runtime_activity',
          lastOutcome: 'failed',
          reasonCode: 'brain_unavailable',
          summary: 'wake dispatch failed',
          updatedAt: '2026-07-28T05:48:33Z',
        },
      }),
    ]);
    fixture.detectChanges();

    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-profile-id="rusty-engine-planner"]',
    );
    const session = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-session-id="managed-session"]',
    );

    expect(profile?.getAttribute('data-profile-status')).toBe('idle');
    expect(profile?.querySelector('.rv-profile__status')?.textContent).toBe(
      'Idle',
    );
    expect(session?.getAttribute('data-session-status')).toBe('idle');
  });

  it('keeps a current visible Codex failure on the profile headline', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'managed-session',
        agent_id: 'external-agent-1',
        profile_id: 'p1',
        status: 'idle',
      }),
    ]);
    fixture.componentRef.setInput('externalSessions', [
      {
        phase: 'failed',
        binding: {
          bindingId: 'binding-managed-session',
          sessionId: 'managed-session',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
    ]);
    fixture.detectChanges();

    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-profile-id="p1"]',
    );
    expect(profile?.getAttribute('data-profile-status')).toBe('failed');
    expect(
      profile
        ?.querySelector('.rv-profile__status')
        ?.getAttribute('data-status-tone'),
    ).toBe('error');
  });

  it('shows a failed non-default visible session over the newer idle default', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'newer-idle',
        agent_id: 'external-agent-idle',
        profile_id: 'p1',
        status: 'idle',
        updated_at: '2026-07-31T12:00:00Z',
      }),
      makeSession({
        session_id: 'older-failed',
        agent_id: 'external-agent-failed',
        profile_id: 'p1',
        status: 'idle',
        updated_at: '2026-07-31T11:00:00Z',
      }),
    ]);
    fixture.componentRef.setInput('externalSessions', [
      {
        binding: {
          bindingId: 'binding-newer-idle',
          sessionId: 'newer-idle',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
      {
        phase: 'failed',
        binding: {
          bindingId: 'binding-older-failed',
          sessionId: 'older-failed',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
    ]);
    fixture.detectChanges();

    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-profile-id="p1"]',
    );
    expect(profile?.getAttribute('data-default-session-id')).toBe('newer-idle');
    expect(profile?.getAttribute('data-profile-status')).toBe('failed');
  });

  it('shows a failed visible session regardless of live-session ordering', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'newer-failed',
        agent_id: 'external-agent-failed',
        profile_id: 'p1',
        status: 'idle',
        updated_at: '2026-07-31T12:00:00Z',
      }),
      makeSession({
        session_id: 'older-idle',
        agent_id: 'external-agent-idle',
        profile_id: 'p1',
        status: 'idle',
        updated_at: '2026-07-31T11:00:00Z',
      }),
    ]);
    fixture.componentRef.setInput('externalSessions', [
      {
        phase: 'failed',
        binding: {
          bindingId: 'binding-newer-failed',
          sessionId: 'newer-failed',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
      {
        binding: {
          bindingId: 'binding-older-idle',
          sessionId: 'older-idle',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
    ]);
    fixture.detectChanges();

    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-profile-id="p1"]',
    );
    expect(profile?.getAttribute('data-profile-status')).toBe('failed');
  });

  it('ignores a failed archived session when the only visible session is idle', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'visible-idle',
        agent_id: 'external-agent-idle',
        profile_id: 'p1',
        status: 'idle',
      }),
      makeSession({
        session_id: 'archived-failed',
        agent_id: 'external-agent-failed',
        profile_id: 'p1',
        status: 'archived',
      }),
    ]);
    fixture.componentRef.setInput('externalSessions', [
      {
        binding: {
          bindingId: 'binding-visible-idle',
          sessionId: 'visible-idle',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
      {
        phase: 'failed',
        binding: {
          bindingId: 'binding-archived-failed',
          sessionId: 'archived-failed',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
    ]);
    fixture.detectChanges();

    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-profile-id="p1"]',
    );
    expect(profile?.getAttribute('data-profile-status')).toBe('idle');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-session-id="archived-failed"]',
      ),
    ).toBeNull();
  });

  it('shows a working visible session over an idle navigation default', async () => {
    const { fixture } = await createPanel([
      makeSession({
        session_id: 'newer-idle',
        agent_id: 'external-agent-idle',
        profile_id: 'p1',
        status: 'idle',
        updated_at: '2026-07-31T12:00:00Z',
      }),
      makeSession({
        session_id: 'older-working',
        agent_id: 'external-agent-working',
        profile_id: 'p1',
        status: 'idle',
        updated_at: '2026-07-31T11:00:00Z',
      }),
    ]);
    fixture.componentRef.setInput('externalSessions', [
      {
        binding: {
          bindingId: 'binding-newer-idle',
          sessionId: 'newer-idle',
        },
        thread: { status: 'idle' },
      } as unknown as ExternalAgentSession,
      {
        phase: 'active',
        binding: {
          bindingId: 'binding-older-working',
          sessionId: 'older-working',
        },
        thread: { status: 'active' },
      } as unknown as ExternalAgentSession,
    ]);
    fixture.detectChanges();

    const profile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-profile-id="p1"]',
    );
    expect(profile?.getAttribute('data-default-session-id')).toBe('newer-idle');
    expect(profile?.getAttribute('data-profile-status')).toBe('active');
    expect(
      profile
        ?.querySelector('.rv-profile__status')
        ?.getAttribute('data-status-tone'),
    ).toBe('active');
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

import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ChatStore,
  ExternalAgentStore,
  filterExternalAgentSessions,
  type ExternalAgentSession,
} from '@rusty-view/chat-store';
import type { ExternalAgentSessionCreateWrite } from '@rusty-view/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ExternalAgentPanelComponent,
  summarizeExternalAgentSessions,
} from './external-agent-panel';

interface PanelApi {
  readonly cwd: WritableSignal<string>;
  readonly metadataLabel: WritableSignal<string>;
  readonly metadataProjectId: WritableSignal<string>;
  readonly metadataTaskId: WritableSignal<string>;
  readonly creatorMode: WritableSignal<'crew' | 'codex'>;
  taskRefLabel(session: ExternalAgentSession): string;
  sessionTitle(session: ExternalAgentSession): string;
  sessionStateLabel(session: ExternalAgentSession): string;
  sessionStateTone(session: ExternalAgentSession): string;
  bindingStateLabel(session: ExternalAgentSession): string | undefined;
  openCreator(): void;
  openOptions(session: ExternalAgentSession): void;
  closeCreator(): void;
  setCreatorMode(mode: 'crew' | 'codex'): void;
  updateDraft(target: WritableSignal<string>, event: Event): void;
  create(event: Event): Promise<void>;
  saveOptions(session: ExternalAgentSession, event: Event): Promise<void>;
}

function input(value: string): Event {
  return { target: { value } } as unknown as Event;
}

async function createPanel(
  createSession: (request: ExternalAgentSessionCreateWrite) => Promise<unknown>,
  sessions: readonly ExternalAgentSession[] = [],
  createCrewSession: (
    profileId: string,
    revision: number,
    idempotencyKey: string,
  ) => Promise<unknown> = async () => undefined,
) {
  const store = {
    readyRuntimes: signal([{ runtimeId: 'runtime-1' }]),
    creationProfiles: signal([{ profileId: 'tester', revision: 7 }]),
    selectedThread: signal(undefined),
    creatingSession: signal(false),
    creationError: signal<string | undefined>(undefined),
    error: signal<string | undefined>(undefined),
    loading: signal(false),
    loadingMore: signal(false),
    hasMoreThreads: signal(false),
    sessions: signal(sessions),
    inventorySessions: signal(sessions),
    inventoryMode: signal('managed'),
    selectedSessionKey: signal(undefined),
    lifecyclePendingThreadIds: signal(new Set<string>()),
    lifecycleNotice: signal(undefined),
    metadataPendingBindingIds: signal(new Set<string>()),
    metadataError: signal<string | undefined>(undefined),
    metadataNotice: signal<string | undefined>(undefined),
    interactions: signal([]),
    selectSession: vi.fn(),
    setArchivedInventory: vi.fn(),
    setInventoryMode: vi.fn(),
    archiveThread: vi.fn(),
    unarchiveThread: vi.fn(),
    deleteThread: vi.fn(),
    bindingRestoreUnavailableReason: vi.fn(() => undefined),
    restoreBindingSession: vi.fn(async () => true),
    updateSessionMetadata: vi.fn(async () => true),
    refresh: vi.fn(),
    refreshCreationProfiles: vi.fn(),
    createSession: vi.fn(createSession),
  };
  const chat = {
    crewSessionCreating: signal(false),
    crewSessionCreationError: signal<string | null>(null),
    crewSessionCreationNotice: signal<string | null>(null),
    createCrewSession: vi.fn(createCrewSession),
    clearCrewSessionCreationFeedback: vi.fn(),
  };
  await TestBed.configureTestingModule({
    imports: [ExternalAgentPanelComponent],
    providers: [
      { provide: ExternalAgentStore, useValue: store },
      { provide: ChatStore, useValue: chat },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ExternalAgentPanelComponent);
  return {
    fixture,
    store,
    chat,
    panel: fixture.componentInstance as unknown as PanelApi,
  };
}

describe('ExternalAgentPanelComponent creation retries', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('explains the required working directory when start is clicked', async () => {
    const created = vi.fn();
    const { fixture, panel } = await createPanel(created);
    panel.openCreator();
    panel.setCreatorMode('codex');
    fixture.detectChanges();

    const submit = fixture.nativeElement.querySelector(
      '[data-testid="external-agent-create-submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();
    fixture.detectChanges();

    expect(created).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('Enter a working directory.');
  });

  it('starts a session without secure-context randomUUID support', async () => {
    const secureCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: secureCrypto.getRandomValues.bind(secureCrypto),
    });
    const created = vi.fn(async () => ({}));
    const { panel } = await createPanel(created);
    panel.openCreator();
    panel.setCreatorMode('codex');
    panel.updateDraft(panel.cwd, input('/home/dev/rusty-view'));

    await panel.create({ preventDefault: vi.fn() } as unknown as Event);

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      }),
    );
  });

  it('reuses one key for the same canonical intent after edits, cancel, and reload', async () => {
    const requests: ExternalAgentSessionCreateWrite[] = [];
    const createSession = async (request: ExternalAgentSessionCreateWrite) => {
      requests.push(request);
      return undefined;
    };
    const first = await createPanel(createSession);
    first.panel.openCreator();
    first.panel.setCreatorMode('codex');
    first.panel.updateDraft(first.panel.cwd, input('/home/dev/rusty-view'));
    await first.panel.create({ preventDefault: vi.fn() } as unknown as Event);

    first.panel.updateDraft(first.panel.cwd, input('/home/dev/other'));
    first.panel.updateDraft(first.panel.cwd, input('/home/dev/rusty-view'));
    await first.panel.create({ preventDefault: vi.fn() } as unknown as Event);

    first.panel.closeCreator();
    first.panel.openCreator();
    first.panel.setCreatorMode('codex');
    first.panel.updateDraft(first.panel.cwd, input('/home/dev/rusty-view'));
    await first.panel.create({ preventDefault: vi.fn() } as unknown as Event);

    first.fixture.destroy();
    TestBed.resetTestingModule();
    const reloaded = await createPanel(createSession);
    reloaded.panel.openCreator();
    reloaded.panel.setCreatorMode('codex');
    reloaded.panel.updateDraft(
      reloaded.panel.cwd,
      input('/home/dev/rusty-view'),
    );
    await reloaded.panel.create({
      preventDefault: vi.fn(),
    } as unknown as Event);

    expect(requests).toHaveLength(4);
    expect(
      new Set(requests.map((request) => request.idempotencyKey)).size,
    ).toBe(1);
    expect(requests.at(-1)).toMatchObject({
      runtimeId: 'runtime-1',
      profileId: 'tester',
      cwd: '/home/dev/rusty-view',
    });
  });

  it('creates a Crew brain with only the active profile revision', async () => {
    const createCrew = vi.fn(async () => ({
      creation: {
        outcome: 'created',
        session: { sessionId: 'crew-session-1' },
      },
      applyResult: {},
    }));
    const { fixture, panel, chat } = await createPanel(
      async () => undefined,
      [],
      createCrew,
    );
    const created = vi.fn();
    fixture.componentInstance.crewSessionCreated.subscribe(created);

    panel.openCreator();
    fixture.detectChanges();
    expect(panel.creatorMode()).toBe('crew');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Codex runtime"]'),
    ).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Working directory',
    );

    await panel.create({ preventDefault: vi.fn() } as unknown as Event);

    expect(chat.createCrewSession).toHaveBeenCalledWith(
      'tester',
      7,
      expect.any(String),
    );
    expect(created).toHaveBeenCalledWith('crew-session-1');
  });

  it('honors a queued creator request after profile metadata loads', async () => {
    const { fixture, store } = await createPanel(async () => undefined);
    store.creationProfiles.set([]);
    fixture.componentRef.setInput('creatorRequest', 1);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="external-agent-create-submit"]',
      ),
    ).toBeNull();

    store.creationProfiles.set([{ profileId: 'tester', revision: 7 }]);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="external-agent-create-submit"]',
      ),
    ).not.toBeNull();
  });
});

describe('ExternalAgentPanelComponent inventory modes', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('notifies the shell after an agent session is selected', async () => {
    const session = inventorySession(1, {
      bound: true,
      attention: false,
      active: false,
    });
    const { fixture } = await createPanel(async () => undefined, [session]);
    const selected = vi.fn();
    fixture.componentInstance.sessionSelected.subscribe(selected);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.rv-agent__select').click();

    expect(selected).toHaveBeenCalledOnce();
  });

  it('uses a dedicated full-directory line instead of repeated runtime details', async () => {
    const base = inventorySession(1, {
      bound: true,
      attention: false,
      active: false,
    });
    if (base.binding === undefined) throw new Error('expected bound session');
    const session: ExternalAgentSession = {
      ...base,
      binding: {
        ...base.binding,
        taskRef: { project_id: 'rusty-view', task_id: '5764' },
      },
    };
    const { fixture, panel } = await createPanel(
      async () => undefined,
      [session],
    );
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector(
      '[data-testid="external-agent-row"]',
    ) as HTMLElement;
    const cwd = row.querySelector('.rv-agent__cwd') as HTMLElement;
    expect(panel.taskRefLabel(session)).toBe('rusty-view · #5764');
    expect(row.textContent).toContain('rusty-view · #5764');
    expect(cwd.textContent).toContain('/home/dev/rusty-view');
    expect(cwd.title).toBe('/home/dev/rusty-view');
    expect(row.textContent).not.toContain('runtime-1');
  });

  it('keeps meaningful status while hiding the baseline active Crew binding', async () => {
    const activeBinding = inventorySession(1, {
      bound: true,
      attention: false,
      active: false,
    });
    const nativeOnly = inventorySession(2, {
      bound: false,
      attention: false,
      active: true,
    });
    const { fixture, panel } = await createPanel(
      async () => undefined,
      [activeBinding, nativeOnly],
    );
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="external-agent-row"]',
    );
    expect(panel.sessionStateLabel(activeBinding)).toBe('Idle');
    expect(panel.bindingStateLabel(activeBinding)).toBeUndefined();
    expect(rows[0]?.textContent).toContain('Idle');
    expect(rows[0]?.textContent?.toLowerCase()).not.toContain('crew active');
    expect(rows[1]?.textContent).toContain('Active');
    expect(rows[1]?.textContent).toContain('Native only');
  });

  it('renders distinct semantic tones for idle, active, completed, and failed sessions', async () => {
    const sessions: ExternalAgentSession[] = [
      inventorySession(1, { bound: true, attention: false, active: false }),
      inventorySession(2, { bound: true, attention: false, active: true }),
      {
        ...inventorySession(3, {
          bound: true,
          attention: false,
          active: false,
        }),
        phase: 'completed',
      },
      {
        ...inventorySession(4, {
          bound: true,
          attention: true,
          active: false,
        }),
        phase: 'failed',
      },
    ];
    const { fixture, panel } = await createPanel(
      async () => undefined,
      sessions,
    );
    fixture.detectChanges();

    const statuses = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.rv-agent__session-status',
      ),
    );
    expect(statuses.map((status) => status.dataset['statusTone'])).toEqual([
      'idle',
      'active',
      'completed',
      'error',
    ]);
    expect(sessions.map((session) => panel.sessionStateTone(session))).toEqual([
      'idle',
      'active',
      'completed',
      'error',
    ]);
  });

  it('retains exceptional Crew binding status in normal title case', async () => {
    const base = inventorySession(1, {
      bound: true,
      attention: false,
      active: false,
    });
    if (base.binding === undefined) throw new Error('expected bound session');
    const paused: ExternalAgentSession = {
      ...base,
      binding: { ...base.binding, status: 'paused' },
    };
    const { fixture, panel } = await createPanel(
      async () => undefined,
      [paused],
    );
    fixture.detectChanges();

    expect(panel.bindingStateLabel(paused)).toBe('Crew Paused');
    expect(fixture.nativeElement.textContent).toContain('Crew Paused');
  });

  it('offers exact Crew-session restore separately from native history', async () => {
    const base = inventorySession(1, {
      bound: true,
      attention: false,
      active: false,
    });
    if (base.binding === undefined) throw new Error('expected bound session');
    const archived: ExternalAgentSession = {
      ...base,
      controller: {
        runtimeId: 'runtime-1',
        driverState: 'ready',
        controllerInstanceId: 'controller-1',
        controllerGeneration: 1,
        leaseExpiresAt: '2026-07-28T03:00:00Z',
        observedCliVersion: '0.144.1',
        consumedContractRevision: 'external-runtime-api-v0',
        compatibilityState: 'certified',
        compatibilityDiagnostic: 'certified',
        lastCompatibilityProbe: null,
        bindingResumeFailures: [],
      },
      binding: {
        ...base.binding,
        status: 'archived',
        profileId: 'profile-1',
      },
    };
    const { fixture, store } = await createPanel(
      async () => undefined,
      [archived],
    );
    store.inventoryMode.set('archived');
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const restored = vi.fn();
    fixture.componentInstance.crewSessionRestored.subscribe(restored);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '[data-testid="external-agent-restore-crew-session"]',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Restore Crew session');
    expect(fixture.nativeElement.textContent).toContain(
      'Crew session restore available',
    );
    const nativeHistoryButton = fixture.nativeElement.querySelector(
      '[data-testid="external-agent-restore"]',
    ) as HTMLButtonElement;
    expect(nativeHistoryButton.textContent).toContain('Restore native history');
    nativeHistoryButton.click();
    await fixture.whenStable();

    expect(store.unarchiveThread).toHaveBeenCalledWith(archived);
    expect(store.restoreBindingSession).not.toHaveBeenCalled();

    button.click();
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('Binding: binding-1'),
    );
    expect(store.restoreBindingSession).toHaveBeenCalledWith(archived);
    expect(restored).toHaveBeenCalledWith('session-1');
    expect(store.unarchiveThread).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('places Options below Archive and saves explicit nullable metadata', async () => {
    const base = inventorySession(1, {
      bound: true,
      attention: false,
      active: false,
    });
    if (base.binding === undefined) throw new Error('expected bound session');
    const session: ExternalAgentSession = {
      ...base,
      binding: {
        ...base.binding,
        label: 'Existing label',
        taskRef: { project_id: 'rusty-view', task_id: '5764' },
      },
    };
    const { fixture, panel, store } = await createPanel(
      async () => undefined,
      [session],
    );
    fixture.detectChanges();

    const actionLabels = [
      ...fixture.nativeElement.querySelectorAll('.rv-agent__actions button'),
    ].map((button) => (button as HTMLButtonElement).textContent?.trim());
    expect(actionLabels).toEqual(['Archive', 'Options']);
    expect(panel.sessionTitle(session)).toBe('Existing label');

    panel.openOptions(session);
    panel.updateDraft(panel.metadataLabel, input(''));
    panel.updateDraft(panel.metadataProjectId, input(''));
    panel.updateDraft(panel.metadataTaskId, input(''));
    await panel.saveOptions(session, {
      preventDefault: vi.fn(),
    } as unknown as Event);

    expect(store.updateSessionMetadata).toHaveBeenCalledWith(session, {
      label: null,
      taskRef: null,
    });
  });

  it('keeps managed and attention-bearing sessions quiet across a 150-thread inventory', () => {
    const sessions = Array.from({ length: 150 }, (_, index) =>
      inventorySession(index, {
        bound: index < 3,
        attention: index === 120,
        active: index === 121,
      }),
    );

    expect(filterExternalAgentSessions(sessions, 'managed')).toHaveLength(5);
    expect(filterExternalAgentSessions(sessions, 'attention')).toHaveLength(2);
    expect(filterExternalAgentSessions(sessions, 'all')).toHaveLength(150);
    expect(
      filterExternalAgentSessions(sessions, 'managed', sessions[149]?.key),
    ).toHaveLength(6);
    expect(summarizeExternalAgentSessions(sessions)).toEqual({
      bound: 3,
      nativeOnly: 147,
      attention: 1,
      active: 1,
    });
  });
});

function inventorySession(
  index: number,
  options: { bound: boolean; attention: boolean; active: boolean },
): ExternalAgentSession {
  const threadId = `thread-${index}`;
  return {
    key: `runtime-1:${threadId}`,
    runtime: {
      runtimeId: 'runtime-1',
      kind: 'codex_app_server',
      desiredState: 'enabled',
      observedState: 'ready',
      processOwnership: 'attached',
      endpoint: { transport: 'unix_web_socket', address: '/run/codex.sock' },
      compatibilityState: 'certified',
      consumedContractRevision: 'external-runtime-api-v0',
      observedCliVersion: '0.144.1',
      revision: 1,
      createdAt: '',
      updatedAt: '',
    },
    thread: {
      threadId,
      sessionId: `session-${index}`,
      parentThreadId: null,
      preview: threadId,
      ephemeral: false,
      modelProvider: 'openai',
      effectiveModel: null,
      createdAt: index,
      updatedAt: index,
      status: options.active ? 'active' : 'idle',
      cwd: '/home/dev/rusty-view',
      cliVersion: '0.144.1',
      name: null,
      agentNickname: null,
      agentRole: null,
      turns: [],
    },
    ...(options.bound
      ? {
          binding: {
            bindingId: `binding-${index}`,
            runtimeId: 'runtime-1',
            nativeThreadId: threadId,
            sessionId: `session-${index}`,
            agentId: `agent-${index}`,
            purpose: 'crew_agent',
            status: 'active',
            cwd: '/home/dev/rusty-view',
            effectiveConfigFingerprint: 'config',
            messageDeliveryPolicy: 'immediate_steer',
            profileId: null,
            profilePromptHash: null,
            profilePromptSnapshot: null,
            profileRevision: null,
            revision: 1,
            createdAt: '',
            updatedAt: '',
          },
        }
      : {}),
    unread: false,
    needsAttention: options.attention,
  };
}

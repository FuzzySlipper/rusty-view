import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
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
  openCreator(): void;
  closeCreator(): void;
  updateDraft(target: WritableSignal<string>, event: Event): void;
  create(event: Event): Promise<void>;
}

function input(value: string): Event {
  return { target: { value } } as unknown as Event;
}

async function createPanel(
  createSession: (request: ExternalAgentSessionCreateWrite) => Promise<unknown>,
) {
  const store = {
    readyRuntimes: signal([{ runtimeId: 'runtime-1' }]),
    creationProfiles: signal([{ profileId: 'tester' }]),
    selectedThread: signal(undefined),
    creatingSession: signal(false),
    creationError: signal<string | undefined>(undefined),
    sessions: signal([]),
    inventorySessions: signal([]),
    inventoryMode: signal('managed'),
    selectedSessionKey: signal(undefined),
    lifecyclePendingThreadIds: signal(new Set<string>()),
    lifecycleNotice: signal(undefined),
    interactions: signal([]),
    setArchivedInventory: vi.fn(),
    setInventoryMode: vi.fn(),
    archiveThread: vi.fn(),
    unarchiveThread: vi.fn(),
    deleteThread: vi.fn(),
    refresh: vi.fn(),
    refreshCreationProfiles: vi.fn(),
    createSession: vi.fn(createSession),
  };
  await TestBed.configureTestingModule({
    imports: [ExternalAgentPanelComponent],
    providers: [{ provide: ExternalAgentStore, useValue: store }],
  }).compileComponents();
  const fixture = TestBed.createComponent(ExternalAgentPanelComponent);
  return {
    fixture,
    store,
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
    first.panel.updateDraft(first.panel.cwd, input('/home/dev/rusty-view'));
    await first.panel.create({ preventDefault: vi.fn() } as unknown as Event);

    first.panel.updateDraft(first.panel.cwd, input('/home/dev/other'));
    first.panel.updateDraft(first.panel.cwd, input('/home/dev/rusty-view'));
    await first.panel.create({ preventDefault: vi.fn() } as unknown as Event);

    first.panel.closeCreator();
    first.panel.openCreator();
    first.panel.updateDraft(first.panel.cwd, input('/home/dev/rusty-view'));
    await first.panel.create({ preventDefault: vi.fn() } as unknown as Event);

    first.fixture.destroy();
    TestBed.resetTestingModule();
    const reloaded = await createPanel(createSession);
    reloaded.panel.openCreator();
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
});

describe('ExternalAgentPanelComponent inventory modes', () => {
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
      executableSha256: 'exe',
      protocolSchemaSha256: 'schema',
      expectedCliVersion: '0.144.1',
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

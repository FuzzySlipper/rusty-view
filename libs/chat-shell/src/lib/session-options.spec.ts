import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ChatStore,
  ExternalAgentStore,
  type ExternalAgentSession,
} from '@rusty-view/chat-store';
import type {
  ChatSessionSummary,
  ExternalBindingProfileState,
} from '@rusty-view/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionOptionsComponent } from './session-options';

function nativeSession(): ChatSessionSummary {
  return {
    session_id: 'native-session',
    agent_id: 'software-engineer',
    profile_id: 'software-engineer',
    kind: 'full',
    status: 'idle',
    latest_cursor: '',
    updated_at: '2026-07-30T00:00:00Z',
  } as ChatSessionSummary;
}

function codexSession(): ExternalAgentSession {
  return {
    key: 'runtime-1:native-thread',
    runtime: { runtimeId: 'runtime-1' },
    controller: { driverState: 'ready' },
    thread: {
      threadId: 'native-thread',
      sessionId: 'codex-session',
      status: 'idle',
      cwd: '/home/dev/rusty-view',
    },
    binding: {
      bindingId: 'binding-1',
      runtimeId: 'runtime-1',
      nativeThreadId: 'native-thread',
      sessionId: 'codex-session',
      status: 'active',
      revision: 1,
    },
    interactions: [],
    needsAttention: false,
    unread: false,
  } as unknown as ExternalAgentSession;
}

async function createOptions() {
  const chat = {
    sessionLifecyclePendingIds: signal(new Set<string>()),
    sessionLifecycleError: signal<string | null>(null),
    clearSessionLifecycleError: vi.fn(),
    workspaceUpdatePendingIds: signal(new Set<string>()),
    workspaceUpdateError: signal<string | null>(null),
    workspaceUpdateNotice: signal<string | null>(null),
    clearWorkspaceUpdateFeedback: vi.fn(),
    sessionDirectoryEntry: vi.fn((sessionId: string) =>
      sessionId === 'native-session'
        ? {
            sessionId,
            runtimeKind: 'direct_brain',
            workspace: {
              cwd: '/home/dev/rusty-view',
              revision: 3,
              updated_at: '2026-08-09T00:00:00Z',
            },
          }
        : undefined,
    ),
    switchCrewSessionWorkspace: vi.fn(async () => true),
    archiveSession: vi.fn(async () => true),
    reconcileSessionsAfterLifecycleMutation: vi.fn(async () => undefined),
  };
  const external = {
    lifecyclePendingThreadIds: signal(new Set<string>()),
    lifecycleRecoveryFor: vi.fn(() => undefined),
    profileStateFor: vi.fn(
      (): ExternalBindingProfileState | undefined => undefined,
    ),
    error: signal<string | undefined>(undefined),
    commandError: signal<string | undefined>(undefined),
    metadataPendingBindingIds: signal(new Set<string>()),
    metadataError: signal<string | undefined>(undefined),
    interactions: signal([]),
    archiveThread: vi.fn(async () => true),
    restartSession: vi.fn(async () => true),
    interruptSession: vi.fn(async () => true),
    refreshSessionProfile: vi.fn(async () => undefined),
    updateSessionMetadata: vi.fn(async () => true),
  };
  await TestBed.configureTestingModule({
    imports: [SessionOptionsComponent],
    providers: [
      { provide: ChatStore, useValue: chat },
      { provide: ExternalAgentStore, useValue: external },
    ],
  }).compileComponents();
  return {
    fixture: TestBed.createComponent(SessionOptionsComponent),
    chat,
    external,
  };
}

describe('SessionOptionsComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('archives the exact native Crew session selected by the row action', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const { fixture, chat } = await createOptions();
    fixture.componentRef.setInput('chatSession', nativeSession());
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>(
        '[data-testid="session-options-archive"]',
      )
      ?.click();
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('native-session'),
    );
    expect(chat.archiveSession).toHaveBeenCalledWith('native-session');
  });

  it('archives a Codex thread and reconciles the unified Crew inventory', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { fixture, chat, external } = await createOptions();
    const session = codexSession();
    fixture.componentRef.setInput('externalSession', session);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>(
        '[data-testid="session-options-archive"]',
      )
      ?.click();
    await fixture.whenStable();

    expect(external.archiveThread).toHaveBeenCalledWith(session);
    expect(chat.reconcileSessionsAfterLifecycleMutation).toHaveBeenCalledOnce();
  });

  it('offers metadata-only new, cancel, and profile controls without trusting transcript activity', async () => {
    const { fixture, external } = await createOptions();
    const base = codexSession();
    const binding = base.binding;
    if (binding === undefined) throw new Error('binding missing');
    const session: ExternalAgentSession = {
      ...base,
      phase: 'active' as const,
      binding: {
        ...binding,
        profileId: 'reviewer',
        cwd: '/home/dev/rusty-view',
      },
    };
    external.profileStateFor.mockReturnValue({
      bindingId: 'binding-1',
      profileId: 'reviewer',
      state: 'current',
      refreshRequired: false,
      appliedProfileRevision: 12,
      appliedPromptHash: 'a'.repeat(64),
      currentProfileRevision: 12,
      currentPromptHash: 'a'.repeat(64),
    });
    fixture.componentRef.setInput('externalSession', session);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(
      host.querySelector('[data-testid="external-session-lifecycle-context"]')
        ?.textContent,
    ).toContain('applied revision 12');
    const cancel = host.querySelector<HTMLButtonElement>(
      '[data-testid="session-options-cancel-turn"]',
    );
    if (cancel === null) throw new Error('cancel button missing');
    expect(cancel.disabled).toBe(false);
    cancel.click();
    host
      .querySelector<HTMLButtonElement>('[data-testid="session-options-new"]')
      ?.click();
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="session-options-refresh-profile"]',
      )
      ?.click();
    await fixture.whenStable();

    expect(external.interruptSession).toHaveBeenCalledWith(session);
    expect(external.restartSession).toHaveBeenCalledWith(session);
    expect(external.refreshSessionProfile).toHaveBeenCalledWith(session);
  });

  it('shows authoritative workspace revision and submits an in-place change', async () => {
    const { fixture, chat } = await createOptions();
    fixture.componentRef.setInput('chatSession', nativeSession());
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('[data-testid="session-workspace"]')?.textContent,
    ).toContain('revision 3');
    expect(
      host.querySelector('[data-testid="session-workspace-current"]')
        ?.textContent,
    ).toContain('/home/dev/rusty-view');

    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="session-workspace-change"]',
      )
      ?.click();
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="/home/dev/project"]',
    );
    if (input === null) throw new Error('workspace input missing');
    input.value = '/home/dev/rusty-crew';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="session-workspace-apply"]',
      )
      ?.click();
    await fixture.whenStable();

    expect(chat.switchCrewSessionWorkspace).toHaveBeenCalledWith(
      'native-session',
      3,
      '/home/dev/rusty-crew',
    );
  });

  it('disables workspace changes while the exact session is busy', async () => {
    const { fixture } = await createOptions();
    fixture.componentRef.setInput('chatSession', {
      ...nativeSession(),
      execution: {
        sessionId: 'native-session',
        lifecycleStatus: 'live',
        phase: 'active',
        source: 'logical_turn',
        updatedAt: '2026-08-09T00:00:00Z',
      },
    });
    fixture.detectChanges();

    const change = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="session-workspace-change"]',
    ) as HTMLButtonElement;
    expect(change.disabled).toBe(true);
    expect(change.title).toContain('Finish or interrupt');
  });
});

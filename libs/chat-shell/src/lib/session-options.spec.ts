import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ChatStore,
  ExternalAgentStore,
  type ExternalAgentSession,
} from '@rusty-view/chat-store';
import type { ChatSessionSummary } from '@rusty-view/protocol';
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
    archiveSession: vi.fn(async () => true),
    reconcileSessionsAfterLifecycleMutation: vi.fn(async () => undefined),
  };
  const external = {
    lifecyclePendingThreadIds: signal(new Set<string>()),
    metadataPendingBindingIds: signal(new Set<string>()),
    metadataError: signal<string | undefined>(undefined),
    interactions: signal([]),
    archiveThread: vi.fn(async () => true),
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
});

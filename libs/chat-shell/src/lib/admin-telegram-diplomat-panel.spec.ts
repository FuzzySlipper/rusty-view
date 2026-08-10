import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { TelegramDiplomatStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type TelegramDiplomatReadback,
} from '@rusty-view/transport';

import { AdminTelegramDiplomatPanelComponent } from './admin-telegram-diplomat-panel';

function healthyReadback(): TelegramDiplomatReadback {
  return {
    state: 'healthy',
    enabled: true,
    adapterId: 'telegram-main',
    credentialId: 'telegram-main',
    credential: {
      credentialId: 'telegram-main',
      displayName: 'Install diplomat',
      providerKind: 'telegram',
      credentialKind: 'api_key',
      credential: { hasSecret: true },
      linkedProviderAliases: [],
      revision: 4,
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-10T00:00:00Z',
    },
    botIdentity: {
      userId: '9001',
      username: 'InstallDiplomatBot',
      displayLabel: 'Workshop Diplomat',
    },
    candidates: [
      {
        externalChatId: '-100200',
        externalThreadId: '42',
        chatType: 'supergroup',
        title: 'Crew support',
        lastObservedAt: '2026-08-10T01:00:00Z',
        lastUpdateId: 122,
      },
    ],
    bindings: [
      {
        schemaVersion: '1',
        bindingId: 'diplomat:workshop',
        revision: 7,
        installationId: 'workshop',
        installationLabel: 'Workshop Crew',
        adapterId: 'telegram-main',
        botUserId: '9001',
        botUsername: 'InstallDiplomatBot',
        agentId: 'agent-a',
        sessionId: 'session-a',
        externalChatId: '-100200',
        externalThreadId: '42',
        participationMode: 'mention_or_reply',
        status: 'active',
        createdAt: '2026-08-10T00:00:00Z',
        updatedAt: '2026-08-10T01:00:00Z',
      },
    ],
    connector: {
      enabled: true,
      running: true,
      adapterId: 'telegram-main',
      bindingCount: 1,
      pollCount: 32,
      lastPollAt: '2026-08-10T01:00:00Z',
      lastInboundAt: '2026-08-10T00:59:00Z',
      lastOutboundAt: '2026-08-10T00:59:30Z',
      lastUpdateId: 122,
      nextOffset: 123,
      botIdentity: { userId: '9001', username: 'InstallDiplomatBot' },
      candidates: [],
      inbound: {
        routed: 8,
        unbound: 0,
        ambiguous: 0,
        expired: 0,
        duplicate: 0,
        staleCursor: 0,
        failed: 0,
        humanMessages: 8,
        botMessages: 2,
        ignored: 1,
        edited: 0,
        unsupported: 0,
        retryPending: 0,
        quarantined: 0,
        loopTerminated: 1,
        rateLimited: 0,
      },
      outbound: {
        sent: 7,
        chunksSent: 8,
        retried: 1,
        failed: 0,
        lastExternalMessageId: '501',
      },
      media: {
        available: 2,
        duplicate: 0,
        unsupported: 0,
        oversized: 0,
        expired: 0,
        failed: 0,
        retried: 0,
        bytesStored: 4096,
      },
    },
  };
}

function mockTransport(readback = healthyReadback()) {
  const binding = readback.bindings[0] ?? healthyReadback().bindings[0];
  if (binding === undefined) {
    throw new Error('mock transport requires one diplomat binding');
  }
  return {
    adminTelegramDiplomat: vi.fn(async () => readback),
    coordinationAgentDirectory: vi.fn(async () => ({
      deploymentRole: 'production',
      agents: [
        {
          agentId: 'agent-a',
          sessionId: 'session-a',
          profileId: 'profile-a',
          displayLabel: 'Agora',
          runtimeKind: 'direct_brain',
          sessionKind: 'full',
          sessionStatus: 'idle',
          routable: true,
          workdir: '/home/dev/agora',
          workspace: {
            cwd: '/home/dev/agora',
            source: 'session_override',
            revision: 3,
            updatedAt: '2026-08-10T00:00:00Z',
          },
        },
        {
          agentId: 'agent-b',
          sessionId: 'session-b',
          profileId: 'profile-b',
          displayLabel: 'Roleplay',
          runtimeKind: 'direct_brain',
          sessionKind: 'full',
          sessionStatus: 'active',
          routable: true,
          workdir: '/home/dev/rusty-roleplay',
        },
      ],
    })),
    moveAdminTelegramDiplomatBinding: vi.fn(async () => ({
      binding: {
        ...binding,
        revision: 8,
        sessionId: 'session-b',
      },
    })),
    relabelAdminTelegramDiplomatBinding: vi.fn(async () => ({
      binding,
    })),
    setAdminTelegramDiplomatBindingStatus: vi.fn(async () => ({
      binding,
    })),
    createAdminTelegramDiplomatBinding: vi.fn(async () => ({
      binding,
    })),
    updateAdminTelegramDiplomatCredential: vi.fn(async () => ({
      ...readback,
      tokenUpdated: true as const,
    })),
    reloadAdminTelegramDiplomat: vi.fn(async () => readback),
  };
}

async function createPanel(transport = mockTransport()) {
  await TestBed.configureTestingModule({
    imports: [AdminTelegramDiplomatPanelComponent],
    providers: [
      TelegramDiplomatStore,
      { provide: ChatTransport, useValue: transport },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminTelegramDiplomatPanelComponent);
  fixture.detectChanges();
  await TestBed.inject(TelegramDiplomatStore).refresh();
  fixture.detectChanges();
  return { fixture, transport };
}

describe('AdminTelegramDiplomatPanelComponent', () => {
  it('renders bot, Telegram surface, session, profile, and workdir separately', async () => {
    const { fixture } = await createPanel();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('@InstallDiplomatBot');
    expect(text).toContain('-100200');
    expect(text).toContain('session-a');
    expect(text).toContain('profile-a');
    expect(text).toContain('/home/dev/agora');
    expect(text).toContain('loop terminated');
    expect(text).toContain('media available / failed');
  });

  it('moves only the revisioned binding and never invokes workspace or profile mutation', async () => {
    const transport = mockTransport();
    const { fixture } = await createPanel(transport);
    const host = fixture.nativeElement as HTMLElement;
    const moveSelect = Array.from(
      host.querySelectorAll<HTMLSelectElement>('select'),
    ).find((select) =>
      select.parentElement?.textContent?.includes('Move binding'),
    );
    if (!(moveSelect instanceof HTMLSelectElement)) {
      throw new Error('move session selector not found');
    }
    moveSelect.value = 'session-b';
    moveSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const moveButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === 'Move binding only');
    if (!(moveButton instanceof HTMLButtonElement)) {
      throw new Error('move button not found');
    }
    moveButton.click();
    await fixture.whenStable();
    expect(transport.moveAdminTelegramDiplomatBinding).toHaveBeenCalledWith(
      'diplomat:workshop',
      { expectedRevision: 7, agentId: 'agent-b', sessionId: 'session-b' },
    );
    expect(
      'switchSessionWorkspace' in transport || 'updateProfile' in transport,
    ).toBe(false);
  });

  it('keeps disconnected and empty first-run state legible', async () => {
    const readback = healthyReadback();
    const connector = readback.connector;
    if (connector === undefined) {
      throw new Error('healthy readback requires connector diagnostics');
    }
    const withoutBotIdentity = { ...readback };
    Reflect.deleteProperty(withoutBotIdentity, 'botIdentity');
    const disconnected: TelegramDiplomatReadback = {
      ...withoutBotIdentity,
      state: 'disconnected',
      candidates: [],
      bindings: [],
      connector: { ...connector, running: false, lastError: '401' },
    };
    const { fixture } = await createPanel(mockTransport(disconnected));
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="telegram-diplomat-state"]',
      )?.textContent,
    ).toContain('disconnected');
    expect(fixture.nativeElement.textContent).toContain(
      'No groups or topics observed yet',
    );
    expect(fixture.nativeElement.textContent).toContain('No diplomat is bound');
  });
});

import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type ModelProviderPage,
  type ModelProviderRecord,
  type ModelProviderWriteRequest,
  type ModelProviderWriteResponse,
} from '@rusty-view/transport';

import { AdminProvidersPanelComponent } from './admin-providers-panel';

function makeProvider(alias: string, hasSecret = false): ModelProviderRecord {
  return {
    alias,
    status: 'active',
    protocol: 'chat_completions',
    providerKind: 'local',
    modelId: 'deterministic',
    credential: hasSecret
      ? { hasSecret: true, secretRef: 'kv//default', updatedAt: 't' }
      : { hasSecret: false },
    metadataJson: null,
    revision: 1,
    createdAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:00:00Z',
  };
}

function makeTransport(
  providers: readonly ModelProviderRecord[],
): ChatTransport {
  const page: ModelProviderPage = {
    items: providers,
    total: providers.length,
    limit: 100,
    offset: 0,
  };
  return {
    adminDiagnostics: async () => ({
      overview: {
        generatedAt: '2026-06-27T00:00:00Z',
        health: 'ok',
        degraded: false,
        reasonCodes: [],
        summary: {
          sessions: 0,
          activeSessions: 0,
          idleSessions: 0,
          archivedSessions: 0,
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
    adminSessions: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    adminAgents: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    adminMcpSurfaces: async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    }),
    adminConfigValidation: async () => null,
    adminCapabilities: async () => ({
      schema_version: 1,
      slash_commands: [],
      capabilities: [],
    }),
    adminProfileDiagnostics: async () => null,
    adminModelProviders: async () => page,
    createAdminModelProvider: vi.fn(
      async (
        request: ModelProviderWriteRequest,
      ): Promise<ModelProviderWriteResponse> => ({
        provider: makeProvider(request.modelId),
        refresh: { mode: 'none', affectedProfiles: [], outcomes: [] },
      }),
    ),
    updateAdminModelProvider: vi.fn(
      async (
        _alias: string,
        request: ModelProviderWriteRequest,
      ): Promise<ModelProviderWriteResponse> => ({
        provider: { ...makeProvider(request.modelId ?? 'x') },
        refresh: { mode: 'none', affectedProfiles: [], outcomes: [] },
      }),
    ),
  } as unknown as ChatTransport;
}

async function createPanel(providers: readonly ModelProviderRecord[]) {
  await TestBed.configureTestingModule({
    imports: [AdminProvidersPanelComponent],
    providers: [
      AdminStore,
      { provide: ChatTransport, useValue: makeTransport(providers) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminProvidersPanelComponent);
  fixture.detectChanges();
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

describe('AdminProvidersPanelComponent', () => {
  it('lists configured provider aliases with redacted credential status', async () => {
    const fixture = await createPanel([
      makeProvider('default'),
      makeProvider('alternate', true),
    ]);
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-providers__list',
      )?.textContent ?? '';

    expect(text).toContain('default');
    expect(text).toContain('alternate');
    // Credential status is rendered as a label, never the raw secret.
    expect(text).toContain('no secret');
    expect(text).toContain('secret set');
    expect(text).not.toContain('alternate-secret');
    expect(text).not.toContain('secretRef');
  });

  it('shows an empty state when no providers are configured', async () => {
    const fixture = await createPanel([]);
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-providers__section:last-of-type',
      )?.textContent ?? '';
    expect(text).toContain('No configured providers');
  });

  it('creates a provider through the store when the form is valid', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: { mock: { calls: unknown[] } };
    };
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'alias' | 'modelId',
        event: { target: { value: string } },
      ): void;
      saveProvider(): void;
    };

    component.updateText('alias', { target: { value: 'smoke-alias' } });
    component.updateText('modelId', { target: { value: 'gpt-4o' } });
    fixture.detectChanges();
    component.saveProvider();
    await fixture.whenStable();

    expect(transport.createAdminModelProvider.mock.calls).toHaveLength(1);
  });

  it('disables save when the alias or model id is blank on create', async () => {
    const fixture = await createPanel([]);
    const component = fixture.componentInstance as unknown as {
      saveDisabled(): boolean;
    };
    // Initial form: alias and modelId both blank.
    expect(component.saveDisabled()).toBe(true);
  });
});

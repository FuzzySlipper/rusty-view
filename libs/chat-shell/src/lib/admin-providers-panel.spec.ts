import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  ChatTransportError,
  type ModelProviderPage,
  type ModelProviderRecord,
  type ModelProviderRefreshMode,
  type ModelProviderWriteRequest,
  type ModelProviderWriteResponse,
  type OpenAiOauthCompleteRequest,
  type OpenAiOauthStartResponse,
  type OpenAiOauthStartRequest,
  type ServiceCredentialImpact,
  type ServiceCredentialRecord,
} from '@rusty-view/transport';

import { AdminProvidersPanelComponent } from './admin-providers-panel';

function makeProvider(alias: string, hasSecret = false): ModelProviderRecord {
  return {
    alias,
    status: 'active',
    protocol: 'chat_completions',
    providerKind: 'local',
    modelId: 'deterministic',
    promptCaching: 'disabled',
    chatCompletionsDialect: 'standard',
    thinkingMode: 'provider_default',
    reasoningHistory: 'provider_default',
    credential: hasSecret
      ? { hasSecret: true, secretRef: 'kv//default', updatedAt: 't' }
      : { hasSecret: false },
    metadataJson: null,
    revision: 1,
    createdAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:00:00Z',
  };
}

function openAiOauthLoginConfig(): OpenAiOauthStartResponse['loginConfig'] {
  return {
    issuer: 'https://auth.openai.com',
    clientId: 'app-client',
    redirectUri: 'http://localhost:1455/auth/callback',
    redirectUriOverrideAllowed: false,
    redirectUriMode: 'registered',
    callbackUrlCompletionAccepted: true,
    callbackUrlCompletionField: 'callbackUrl',
    pendingLoginIdRequiredForCallbackUrl: false,
    remoteOperatorFlow: 'paste_callback_url',
  };
}

function makeCredential(
  credentialId: string,
  linkedProviderAliases: readonly string[] = [],
  hasSecret = true,
): ServiceCredentialRecord {
  return {
    credentialId,
    displayName: `Shared ${credentialId}`,
    providerKind: 'openai',
    credentialKind: 'openai_oauth',
    credential: {
      hasSecret,
      kind: 'openai_oauth',
      status: hasSecret ? 'configured' : 'missing',
    },
    linkedProviderAliases,
    revision: 1,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
  };
}

function makeTransport(
  providers: readonly ModelProviderRecord[],
  providerLoadFails = false,
  initialCredentials: readonly ServiceCredentialRecord[] = [],
): ChatTransport {
  let currentProviders = [...providers];
  let currentCredentials = [...initialCredentials];
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
    adminModelProviders: vi.fn(
      providerLoadFails
        ? async () => {
            throw new Error('boom');
          }
        : async () => ({ ...page, items: currentProviders }),
    ),
    adminServiceCredentials: vi.fn(async () => ({
      items: currentCredentials,
      total: currentCredentials.length,
      limit: 100,
      offset: 0,
    })),
    createAdminServiceCredential: vi.fn(async (request) => {
      const credential: ServiceCredentialRecord = {
        credentialId: request.credentialId,
        displayName: request.displayName ?? request.credentialId,
        providerKind: request.providerKind ?? 'custom',
        credentialKind: request.credentialKind ?? 'api_key',
        credential: {
          hasSecret: request.secret !== undefined,
          kind: request.credentialKind ?? 'api_key',
          status: request.secret === undefined ? 'missing' : 'configured',
        },
        linkedProviderAliases: [],
        revision: 1,
        createdAt: '2026-07-02T00:00:00Z',
        updatedAt: '2026-07-02T00:00:00Z',
      };
      currentCredentials = [...currentCredentials, credential];
      return { credential };
    }),
    adminServiceCredentialImpact: vi.fn(async (credentialId: string) => {
      const credential = currentCredentials.find(
        (candidate) => candidate.credentialId === credentialId,
      );
      if (credential === undefined) throw new Error('credential missing');
      const linkedProviders = currentProviders.filter(
        (provider) => provider.credentialId === credentialId,
      );
      return {
        credential,
        linkedProviderAliases: linkedProviders.map(
          (provider) => provider.alias,
        ),
        linkedProviders,
        canClear: linkedProviders.length === 0,
        canDelete: linkedProviders.length === 0,
      } satisfies ServiceCredentialImpact;
    }),
    linkAdminModelProviderCredential: vi.fn(async (alias, request) => {
      const credential = currentCredentials.find(
        (candidate) => candidate.credentialId === request.credentialId,
      );
      if (credential === undefined) throw new Error('credential missing');
      const current = currentProviders.find(
        (provider) => provider.alias === alias,
      );
      const provider = {
        ...(current ?? makeProvider(alias)),
        credentialId: credential.credentialId,
        credential: credential.credential,
        revision: (current?.revision ?? 0) + 1,
      };
      currentProviders = [
        ...currentProviders.filter((candidate) => candidate.alias !== alias),
        provider,
      ];
      currentCredentials = currentCredentials.map((candidate) =>
        candidate.credentialId === credential.credentialId
          ? {
              ...candidate,
              linkedProviderAliases: [
                ...new Set([...candidate.linkedProviderAliases, alias]),
              ],
            }
          : candidate,
      );
      return { provider, credential };
    }),
    unlinkAdminModelProviderCredential: vi.fn(async (alias) => {
      const current = currentProviders.find(
        (provider) => provider.alias === alias,
      );
      const unlinked = { ...(current ?? makeProvider(alias)) };
      delete unlinked.credentialId;
      const provider = {
        ...unlinked,
        credential: { hasSecret: false },
        revision: (current?.revision ?? 0) + 1,
      } satisfies ModelProviderRecord;
      currentProviders = [
        ...currentProviders.filter((candidate) => candidate.alias !== alias),
        provider,
      ];
      currentCredentials = currentCredentials.map((candidate) => ({
        ...candidate,
        linkedProviderAliases: candidate.linkedProviderAliases.filter(
          (linkedAlias) => linkedAlias !== alias,
        ),
      }));
      return { provider };
    }),
    clearAdminServiceCredential: vi.fn(async (credentialId) => {
      const credential = makeCredential(credentialId, [], false);
      return { credential };
    }),
    deleteAdminServiceCredential: vi.fn(async (credentialId) => {
      const credential =
        currentCredentials.find(
          (candidate) => candidate.credentialId === credentialId,
        ) ?? makeCredential(credentialId);
      currentCredentials = currentCredentials.filter(
        (candidate) => candidate.credentialId !== credentialId,
      );
      return { deleted: true as const, credential };
    }),
    adminServiceCredentialOpenAiOauthStatus: vi.fn(
      async (credentialId: string) => ({
        credential:
          currentCredentials.find(
            (candidate) => candidate.credentialId === credentialId,
          ) ?? makeCredential(credentialId, [], false),
        loginConfig: openAiOauthLoginConfig(),
        pendingLogins: [],
      }),
    ),
    adminStartServiceCredentialOpenAiOauthLogin: vi.fn(
      async (credentialId: string) => ({
        credential:
          currentCredentials.find(
            (candidate) => candidate.credentialId === credentialId,
          ) ?? makeCredential(credentialId, [], false),
        loginConfig: openAiOauthLoginConfig(),
        pendingLogin: {
          pendingLoginId: 'pending-1',
          credentialId,
          issuer: 'https://auth.openai.com',
          clientId: 'app-client',
          redirectUri: 'http://localhost:1455/auth/callback',
          scopes: ['openid'],
          codeChallenge: 'challenge',
          authorizationUrl:
            'https://auth.openai.com/oauth/authorize?state=callback-state',
          createdAt: '2026-07-02T00:00:00Z',
          expiresAt: '2026-07-02T00:10:00Z',
        },
      }),
    ),
    adminCompleteServiceCredentialOpenAiOauthLogin: vi.fn(
      async (credentialId: string) => {
        const credential = makeCredential(credentialId, [], true);
        currentCredentials = currentCredentials.map((candidate) =>
          candidate.credentialId === credentialId
            ? {
                ...credential,
                linkedProviderAliases: candidate.linkedProviderAliases,
              }
            : candidate,
        );
        return {
          credential,
          completionMode: 'real' as const,
          pendingLoginId: 'pending-1',
        };
      },
    ),
    adminClearServiceCredentialOpenAiOauth: vi.fn(async (credentialId) => ({
      credential: makeCredential(credentialId, [], false),
    })),
    createAdminModelProvider: vi.fn(
      async (
        request: ModelProviderWriteRequest,
        refresh: ModelProviderRefreshMode,
      ): Promise<ModelProviderWriteResponse> => {
        const provider = {
          ...makeProvider(request.alias ?? request.modelId),
          protocol: request.protocol,
          providerKind: request.providerKind ?? 'custom',
          modelId: request.modelId,
          ...(request.responsesDialect === undefined
            ? {}
            : { responsesDialect: request.responsesDialect }),
          promptCaching: request.promptCaching ?? 'disabled',
          chatCompletionsDialect: request.chatCompletionsDialect ?? 'standard',
          thinkingMode: request.thinkingMode ?? 'provider_default',
          reasoningHistory: request.reasoningHistory ?? 'provider_default',
          ...(request.reasoningBudgetTokens === undefined
            ? {}
            : { reasoningBudgetTokens: request.reasoningBudgetTokens }),
        } satisfies ModelProviderRecord;
        currentProviders = [...currentProviders, provider];
        return {
          provider,
          refresh: { mode: refresh, affectedProfiles: [], outcomes: [] },
        };
      },
    ),
    updateAdminModelProvider: vi.fn(
      async (
        alias: string,
        request: ModelProviderWriteRequest,
        refresh: ModelProviderRefreshMode,
      ): Promise<ModelProviderWriteResponse> => {
        const current = currentProviders.find(
          (provider) => provider.alias === alias,
        );
        const provider = {
          ...(current ?? makeProvider(alias)),
          protocol: request.protocol,
          modelId: request.modelId,
          ...(request.responsesDialect === undefined
            ? { responsesDialect: undefined }
            : { responsesDialect: request.responsesDialect }),
          promptCaching: request.promptCaching ?? 'disabled',
          chatCompletionsDialect: request.chatCompletionsDialect ?? 'standard',
          thinkingMode: request.thinkingMode ?? 'provider_default',
          reasoningHistory: request.reasoningHistory ?? 'provider_default',
          ...(request.reasoningBudgetTokens === undefined
            ? {}
            : { reasoningBudgetTokens: request.reasoningBudgetTokens }),
        } satisfies ModelProviderRecord;
        currentProviders = [
          ...currentProviders.filter((candidate) => candidate.alias !== alias),
          provider,
        ];
        return {
          provider,
          refresh: { mode: refresh, affectedProfiles: [], outcomes: [] },
        };
      },
    ),
    adminOpenAiOauthStatus: vi.fn(async (alias: string) => {
      const configured = providers.some(
        (provider) =>
          provider.alias === alias &&
          provider.credential.hasSecret &&
          provider.credential.kind === 'openai_oauth',
      );
      const credential = configured
        ? ({ hasSecret: true, kind: 'openai_oauth' } as const)
        : ({ hasSecret: false } as const);
      return {
        provider: { ...makeProvider(alias, configured), credential },
        credential,
        loginConfig: openAiOauthLoginConfig(),
        pendingLogins: [],
      };
    }),
    adminStartOpenAiOauthLogin: vi.fn(async (alias: string) => ({
      provider: {
        ...makeProvider(alias),
        credential: { hasSecret: false, kind: 'openai_oauth' },
      },
      loginConfig: openAiOauthLoginConfig(),
      pendingLogin: {
        pendingLoginId: 'pending-1',
        providerAlias: alias,
        issuer: 'https://auth.openai.com',
        clientId: 'app-client',
        redirectUri: 'http://localhost:1455/auth/callback',
        scopes: ['openid'],
        codeChallenge: 'challenge',
        authorizationUrl:
          'https://auth.openai.com/oauth/authorize?state=callback-state',
        createdAt: '2026-07-02T00:00:00Z',
        expiresAt: '2026-07-02T00:10:00Z',
      },
    })),
    adminCompleteOpenAiOauthLogin: vi.fn(async (alias: string) => ({
      provider: {
        ...makeProvider(alias, true),
        credential: { hasSecret: true, kind: 'openai_oauth' },
      },
      credential: { hasSecret: true, kind: 'openai_oauth' },
      completionMode: 'real',
      pendingLoginId: 'pending-1',
    })),
    adminClearOpenAiOauthCredential: vi.fn(async (alias: string) => ({
      provider: makeProvider(alias),
      credential: { hasSecret: false },
    })),
  } as unknown as ChatTransport;
}

async function createPanel(
  providers: readonly ModelProviderRecord[],
  providerLoadFails = false,
  credentials: readonly ServiceCredentialRecord[] = [],
) {
  await TestBed.configureTestingModule({
    imports: [AdminProvidersPanelComponent],
    providers: [
      AdminStore,
      {
        provide: ChatTransport,
        useValue: makeTransport(providers, providerLoadFails, credentials),
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminProvidersPanelComponent);
  fixture.detectChanges();
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

function textContent(
  fixture: ComponentFixture<AdminProvidersPanelComponent>,
): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('AdminProvidersPanelComponent', () => {
  it('lists configured provider aliases with redacted credential status', async () => {
    const fixture = await createPanel([
      makeProvider('default'),
      {
        ...makeProvider('alternate', true),
        credential: {
          hasSecret: true,
          secretRef: 'kv//default',
          updatedAt: '2026-07-02T00:00:00Z',
          kind: 'api_key',
        },
      },
    ]);
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-providers__list',
      )?.textContent ?? '';

    expect(text).toContain('default');
    expect(text).toContain('alternate');
    // Credential status is rendered as a label, never the raw secret.
    expect(text).toContain('missing');
    expect(text).toContain('configured');
    expect(text).toContain('api_key');
    expect(text).toContain('2026-07-02T00:00:00Z');
    expect(text).not.toContain('alternate-secret');
    expect(text).not.toContain('secretRef');
  });

  it('offers only the provider kinds defined by the Crew admin contract', async () => {
    const fixture = await createPanel([]);
    const selector = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="provider-kind-selector"]',
    ) as HTMLSelectElement | null;

    expect(selector).not.toBeNull();
    expect(
      Array.from(selector?.options ?? []).map((option) => option.value),
    ).toEqual([
      'custom',
      'local',
      'den-router',
      'openai',
      'openai-compatible',
      'openrouter',
      'deepseek',
      'moonshot',
    ]);
    expect(textContent(fixture)).toContain(
      'Protocol and dialect define the wire behavior',
    );
  });

  it('requires legacy free-form provider kinds to be explicitly reclassified', async () => {
    const legacyProvider: ModelProviderRecord = {
      ...makeProvider('legacy-provider-kind'),
      providerKind: 'local-certification',
    };
    const fixture = await createPanel([legacyProvider]);
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      providerKindSupported(): boolean;
      saveDisabled(): boolean;
      updateProviderKind(event: { target: { value: string } }): void;
    };

    component.selectProviderForEdit(legacyProvider);
    fixture.detectChanges();

    expect(component.providerKindSupported()).toBe(false);
    expect(component.saveDisabled()).toBe(true);
    expect(textContent(fixture)).toContain(
      'Unsupported legacy value: local-certification',
    );

    component.updateProviderKind({ target: { value: 'custom' } });
    fixture.detectChanges();

    expect(component.providerKindSupported()).toBe(true);
    expect(textContent(fixture)).not.toContain('Unsupported legacy value');
  });

  it('reuses API keys across provider kinds and only protocol-filters OAuth', async () => {
    const customApiKey: ServiceCredentialRecord = {
      ...makeCredential('custom:key'),
      providerKind: 'custom',
      credentialKind: 'api_key',
      credential: { hasSecret: true, kind: 'api_key', status: 'configured' },
    };
    const deepseekApiKey: ServiceCredentialRecord = {
      ...makeCredential('deepseek:key'),
      providerKind: 'deepseek',
      credentialKind: 'api_key',
      credential: { hasSecret: true, kind: 'api_key', status: 'configured' },
    };
    const oauth = makeCredential('openai:oauth');
    const fixture = await createPanel([], false, [
      customApiKey,
      deepseekApiKey,
      oauth,
    ]);
    const component = fixture.componentInstance as unknown as {
      updateProtocol(event: { target: { value: string } }): void;
    };
    const optionValues = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-testid="provider-credential-selector"] option',
        ),
      ).map((option) => (option as HTMLOptionElement).value);

    expect(optionValues()).toContain('reuse:custom:key');
    expect(optionValues()).toContain('reuse:deepseek:key');
    expect(optionValues()).not.toContain('reuse:openai:oauth');

    component.updateProtocol({ target: { value: 'responses' } });
    fixture.detectChanges();

    expect(optionValues()).toContain('reuse:openai:oauth');
    expect(textContent(fixture)).toContain(
      'API-key credentials are reusable across every provider kind',
    );
  });

  it('clears reused and create OAuth selections when switching to Chat Completions', async () => {
    const oauth = makeCredential('openai:oauth');
    const fixture = await createPanel([], false, [oauth]);
    const component = fixture.componentInstance as unknown as {
      form(): { credentialMode: string; credentialId: string };
      updateProtocol(event: { target: { value: string } }): void;
      updateCredentialMode(event: { target: { value: string } }): void;
    };

    component.updateProtocol({ target: { value: 'responses' } });
    component.updateCredentialMode({
      target: { value: 'reuse:openai:oauth' },
    });
    component.updateProtocol({ target: { value: 'chat_completions' } });
    expect(component.form()).toMatchObject({
      credentialMode: 'unconfigured',
      credentialId: '',
    });

    component.updateCredentialMode({
      target: { value: 'create_openai_oauth' },
    });
    component.updateProtocol({ target: { value: 'chat_completions' } });
    expect(component.form()).toMatchObject({
      credentialMode: 'unconfigured',
      credentialId: '',
    });
  });

  it('blocks an existing OAuth-linked provider protocol change before mutation', async () => {
    const oauth = makeCredential('openai:oauth', ['oauth-provider']);
    const provider: ModelProviderRecord = {
      ...makeProvider('oauth-provider'),
      protocol: 'responses',
      responsesDialect: 'openai_stateful',
      credentialId: oauth.credentialId,
      credential: oauth.credential,
    };
    const fixture = await createPanel([provider], false, [oauth]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: { mock: { calls: unknown[][] } };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      updateProtocol(event: { target: { value: string } }): void;
      saveDisabled(): boolean;
      saveProvider(): Promise<void>;
    };

    component.selectProviderForEdit(provider);
    component.updateProtocol({ target: { value: 'chat_completions' } });
    fixture.detectChanges();

    expect(component.saveDisabled()).toBe(true);
    expect(textContent(fixture)).toContain(
      'Switch back to Responses, save it as Unconfigured',
    );
    await component.saveProvider();
    expect(transport.updateAdminModelProvider.mock.calls).toHaveLength(0);
  });

  it('renders a credential-less provider as unconfigured and edits it without assuming API key', async () => {
    const provider: ModelProviderRecord = {
      ...makeProvider('openai-missing'),
      protocol: 'responses',
      providerKind: 'openai',
      credential: { hasSecret: false },
    };
    const fixture = await createPanel([provider]);
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      form(): { credentialMode: string };
    };

    const listText =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-providers__list',
      )?.textContent ?? '';
    expect(listText).toContain('unconfigured');
    expect(listText).not.toContain('api_key');

    component.selectProviderForEdit(provider);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.form().credentialMode).toBe('unconfigured');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="provider-chat-completions-dialect"]',
      ),
    ).toBeNull();
    const credentialSelect = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('select'),
    ).find((select) => select.textContent?.includes('OpenAI OAuth'));
    expect(credentialSelect?.value).toBe('unconfigured');
  });

  it('shows an empty state when no providers are configured', async () => {
    const fixture = await createPanel([]);
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-providers__section:last-of-type',
      )?.textContent ?? '';
    expect(text).toContain('No configured providers');
  });

  it('keeps the editor separate from the scrolling provider list region', async () => {
    const fixture = await createPanel(
      Array.from({ length: 12 }, (_, index) =>
        makeProvider(`provider-${index + 1}`),
      ),
    );
    const host = fixture.nativeElement as HTMLElement;
    const editor = host.querySelector<HTMLElement>(
      '[data-testid="admin-providers-editor"]',
    );
    const listRegion = host.querySelector<HTMLElement>(
      '[data-testid="admin-providers-list-region"]',
    );

    expect(editor).not.toBeNull();
    expect(listRegion).not.toBeNull();
    expect(editor?.querySelector('h2')?.textContent).toContain(
      'Create Provider',
    );
    expect(
      listRegion?.querySelectorAll('.rv-admin-providers__provider'),
    ).toHaveLength(12);
    expect(editor?.contains(listRegion ?? null)).toBe(false);
  });

  it('creates a provider and automatically applies affected Profile rebuilds', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mock: {
          calls: [ModelProviderWriteRequest, ModelProviderRefreshMode][];
        };
      };
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
    expect(transport.createAdminModelProvider.mock.calls[0]?.[1]).toBe('apply');
    expect(textContent(fixture)).not.toContain('Refresh profiles after save');
  });

  it('updates a provider with automatic rebuilds and surfaces blocked outcomes', async () => {
    const provider = makeProvider('blocked-provider');
    const fixture = await createPanel([provider]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mock: {
          calls: [
            string,
            ModelProviderWriteRequest,
            ModelProviderRefreshMode,
          ][];
        };
        mockImplementationOnce(
          fn: (
            alias: string,
            request: ModelProviderWriteRequest,
            refresh: ModelProviderRefreshMode,
          ) => Promise<ModelProviderWriteResponse>,
        ): void;
      };
    };
    transport.updateAdminModelProvider.mockImplementationOnce(
      async (_alias, _request, refresh) => ({
        provider,
        refresh: {
          mode: refresh,
          affectedProfiles: [
            {
              profileId: 'brain-one',
              sessionIds: ['session-one'],
              configuredSessionIds: ['session-one'],
              activeSessionIds: ['session-one'],
            },
          ],
          outcomes: [
            {
              profileId: 'brain-one',
              status: 'blocked',
              summary: 'active wake must finish before rebuild',
              reasonCode: 'profile_rebuild_in_flight',
            },
          ],
        },
      }),
    );
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      saveProvider(): Promise<void>;
    };

    component.selectProviderForEdit(provider);
    await component.saveProvider();
    fixture.detectChanges();

    expect(transport.updateAdminModelProvider.mock.calls[0]?.[2]).toBe('apply');
    expect(textContent(fixture)).toContain(
      'Provider saved; automatic Profile rebuild incomplete',
    );
    expect(textContent(fixture)).toContain(
      'brain-one: blocked — active wake must finish before rebuild',
    );
    expect(textContent(fixture)).toContain('reason profile_rebuild_in_flight');
  });

  it('requires and submits an explicit Responses dialect from all generated choices', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mock: { calls: [ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      form(): { responsesDialect: string };
      saveDisabled(): boolean;
      updateText(
        field: 'alias' | 'modelId',
        event: { target: { value: string } },
      ): void;
      updateProtocol(event: { target: { value: string } }): void;
      updateResponsesDialect(event: { target: { value: string } }): void;
      saveProvider(): Promise<void>;
    };

    component.updateText('alias', { target: { value: 'meta-muse' } });
    component.updateText('modelId', {
      target: { value: 'muse-spark-1.2' },
    });
    component.updateProtocol({ target: { value: 'responses' } });
    fixture.detectChanges();

    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="provider-responses-dialect"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(
      Array.from(select?.options ?? [])
        .map((option) => option.value)
        .filter(Boolean),
    ).toEqual([
      'openai_stateful',
      'openai_stateless',
      'generic_stateless',
      'deepseek',
      'meta',
    ]);
    expect(component.saveDisabled()).toBe(true);

    for (const dialect of [
      'openai_stateful',
      'openai_stateless',
      'generic_stateless',
      'deepseek',
      'meta',
    ]) {
      component.updateResponsesDialect({ target: { value: dialect } });
      expect(component.form().responsesDialect).toBe(dialect);
      expect(component.saveDisabled()).toBe(false);
    }

    await component.saveProvider();
    expect(transport.createAdminModelProvider.mock.calls[0]?.[0]).toMatchObject(
      {
        protocol: 'responses',
        responsesDialect: 'meta',
        modelId: 'muse-spark-1.2',
      },
    );
    expect(textContent(fixture)).toContain('Meta Responses');
  });

  it('clears the hidden dialect on protocol switches and omits it for Chat Completions', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mock: { calls: [ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      form(): { protocol: string; responsesDialect: string };
      saveDisabled(): boolean;
      updateText(
        field: 'alias' | 'modelId',
        event: { target: { value: string } },
      ): void;
      updateProtocol(event: { target: { value: string } }): void;
      updateResponsesDialect(event: { target: { value: string } }): void;
      saveProvider(): Promise<void>;
    };

    component.updateText('alias', { target: { value: 'switching' } });
    component.updateText('modelId', { target: { value: 'model' } });
    component.updateProtocol({ target: { value: 'responses' } });
    component.updateResponsesDialect({ target: { value: 'deepseek' } });
    component.updateProtocol({ target: { value: 'chat_completions' } });
    expect(component.form()).toMatchObject({
      protocol: 'chat_completions',
      responsesDialect: '',
    });

    await component.saveProvider();
    expect(
      transport.createAdminModelProvider.mock.calls[0]?.[0],
    ).not.toHaveProperty('responsesDialect');

    component.updateProtocol({ target: { value: 'responses' } });
    expect(component.form().responsesDialect).toBe('');
    expect(component.saveDisabled()).toBe(true);
  });

  it('populates and preserves the saved Responses dialect while editing', async () => {
    const provider: ModelProviderRecord = {
      ...makeProvider('responses-edit'),
      protocol: 'responses',
      responsesDialect: 'openai_stateful',
    };
    const fixture = await createPanel([provider]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mock: { calls: [string, ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      form(): { responsesDialect: string };
      selectProviderForEdit(provider: ModelProviderRecord): void;
      updateText(
        field: 'displayName',
        event: { target: { value: string } },
      ): void;
      saveProvider(): Promise<void>;
    };

    expect(textContent(fixture)).toContain('dialect openai_stateful');
    component.selectProviderForEdit(provider);
    expect(component.form().responsesDialect).toBe('openai_stateful');
    component.updateText('displayName', { target: { value: 'Renamed' } });
    await component.saveProvider();

    expect(transport.updateAdminModelProvider.mock.calls[0]?.[1]).toMatchObject(
      {
        protocol: 'responses',
        responsesDialect: 'openai_stateful',
        displayName: 'Renamed',
      },
    );
  });

  it('creates an OpenAI OAuth provider without asking for raw OAuth credentials', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mock: { calls: [ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'alias' | 'modelId',
        event: { target: { value: string } },
      ): void;
      updateCredentialMode(event: { target: { value: string } }): void;
      updateResponsesDialect(event: { target: { value: string } }): void;
      saveProvider(): Promise<void>;
      editingAlias(): string | null;
      form(): {
        secret: string;
        protocol: string;
        providerKind: string;
        credentialMode: string;
      };
    };

    component.updateText('alias', { target: { value: 'openai-oauth' } });
    component.updateText('modelId', { target: { value: 'gpt-5' } });
    component.updateCredentialMode({
      target: { value: 'create_openai_oauth' },
    });
    component.updateResponsesDialect({
      target: { value: 'openai_stateful' },
    });
    fixture.detectChanges();
    await component.saveProvider();
    fixture.detectChanges();

    const call = transport.createAdminModelProvider.mock.calls[0];
    if (call === undefined) throw new Error('expected a create call');
    const [request] = call;
    expect(request.protocol).toBe('responses');
    expect(request.responsesDialect).toBe('openai_stateful');
    expect(request.providerKind).toBe('openai');
    expect(request).not.toHaveProperty('secret');
    expect(request).not.toHaveProperty('credentialSecret');
    expect(component.form().secret).toBe('');
    expect(component.form().credentialMode).toBe('reuse');
    expect(component.editingAlias()).toBe('openai-oauth');
    expect(textContent(fixture)).toContain(
      'OAuth is unconfigured for this shared credential',
    );
    expect(textContent(fixture)).toContain(
      'Credentials can be reused by compatible aliases on this Crew service',
    );
  });

  it('starts OpenAI OAuth without overriding Crew registered redirect URL', async () => {
    const oauthProvider: ModelProviderRecord = {
      ...makeProvider('openai-oauth', true),
      protocol: 'responses',
      providerKind: 'openai',
      credentialId: 'openai:shared',
      credential: { hasSecret: true, kind: 'openai_oauth' },
    };
    const fixture = await createPanel([oauthProvider], false, [
      makeCredential('openai:shared', ['openai-oauth']),
    ]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminStartServiceCredentialOpenAiOauthLogin: {
        mock: { calls: [string, OpenAiOauthStartRequest][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      startOpenAiOauthLogin(): void;
    };
    const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => null);

    component.selectProviderForEdit(oauthProvider);
    component.startOpenAiOauthLogin();
    await fixture.whenStable();

    const request =
      transport.adminStartServiceCredentialOpenAiOauthLogin.mock.calls[0]?.[1];
    expect(request).toEqual({ originator: 'rusty_view' });
    expect(request).not.toHaveProperty('redirectUri');
    openSpy.mockRestore();
  });

  it('starts OAuth and completes by forwarding the pasted callback URL to Crew', async () => {
    const oauthProvider: ModelProviderRecord = {
      ...makeProvider('openai-oauth', true),
      protocol: 'responses',
      providerKind: 'openai',
      credentialId: 'openai:shared',
      credential: { hasSecret: true, kind: 'openai_oauth' },
    };
    const fixture = await createPanel([oauthProvider], false, [
      makeCredential('openai:shared', ['openai-oauth']),
    ]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminStartServiceCredentialOpenAiOauthLogin: {
        mock: { calls: [string, OpenAiOauthStartRequest][] };
      };
      adminCompleteServiceCredentialOpenAiOauthLogin: {
        mock: { calls: [string, OpenAiOauthCompleteRequest][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      startOpenAiOauthLogin(): void;
      updateText(
        field: 'oauthCallbackUrl',
        event: { target: { value: string } },
      ): void;
      completeOpenAiOauthLogin(): void;
    };
    const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => null);

    component.selectProviderForEdit(oauthProvider);
    component.startOpenAiOauthLogin();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('authorization URL');
    expect(text).toContain('openai-oauth');
    expect(
      transport.adminStartServiceCredentialOpenAiOauthLogin.mock.calls[0]?.[0],
    ).toBe('openai:shared');
    expect(
      transport.adminStartServiceCredentialOpenAiOauthLogin.mock.calls[0]?.[1],
    ).not.toHaveProperty('redirectUri');

    component.updateText('oauthCallbackUrl', {
      target: {
        value:
          'http://localhost:1455/auth/callback?code=code-1&state=callback-state',
      },
    });
    component.completeOpenAiOauthLogin();
    await fixture.whenStable();

    expect(
      transport.adminCompleteServiceCredentialOpenAiOauthLogin.mock
        .calls[0]?.[1],
    ).toEqual({
      callbackUrl:
        'http://localhost:1455/auth/callback?code=code-1&state=callback-state',
    });
    expect(
      (
        transport as unknown as {
          adminServiceCredentialOpenAiOauthStatus: {
            mock: { calls: unknown[] };
          };
        }
      ).adminServiceCredentialOpenAiOauthStatus.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    fixture.detectChanges();
    expect(textContent(fixture)).toContain(
      'OAuth is configured for this shared credential',
    );
    openSpy.mockRestore();
  });

  it('keeps unlink distinct from guarded shared credential clear', async () => {
    const oauthProvider: ModelProviderRecord = {
      ...makeProvider('openai-oauth', true),
      credentialId: 'openai:shared',
      protocol: 'responses',
      providerKind: 'openai',
      credential: { hasSecret: true, kind: 'openai_oauth' },
    };
    const fixture = await createPanel([oauthProvider], false, [
      makeCredential('openai:shared', ['openai-oauth']),
    ]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      unlinkAdminModelProviderCredential: {
        mock: { calls: [string][] };
      };
      adminClearServiceCredentialOpenAiOauth: {
        mock: { calls: [string, number][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      unlinkSelectedCredential(): void;
      clearSelectedCredential(): void;
    };

    component.selectProviderForEdit(oauthProvider);
    await fixture.whenStable();
    fixture.detectChanges();
    const clearButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Clear Shared Credential'));
    expect(clearButton?.disabled).toBe(true);
    expect(textContent(fixture)).toContain('1 linked aliases');

    component.unlinkSelectedCredential();
    await fixture.whenStable();
    expect(
      transport.unlinkAdminModelProviderCredential.mock.calls[0]?.[0],
    ).toBe('openai-oauth');
    component.clearSelectedCredential();
    await fixture.whenStable();
    expect(
      transport.adminClearServiceCredentialOpenAiOauth.mock.calls[0]?.[0],
    ).toBe('openai:shared');
  });

  it('offers guarded clear for a shared API key credential too', async () => {
    const apiKeyProvider: ModelProviderRecord = {
      ...makeProvider('api-key-provider', true),
      credentialId: 'key:shared',
      credential: { hasSecret: true, kind: 'api_key' },
    };
    const apiKeyCredential: ServiceCredentialRecord = {
      ...makeCredential('key:shared', ['api-key-provider']),
      providerKind: 'local',
      credentialKind: 'api_key',
      credential: { hasSecret: true, kind: 'api_key', status: 'configured' },
    };
    const fixture = await createPanel([apiKeyProvider], false, [
      apiKeyCredential,
    ]);
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
    };

    component.selectProviderForEdit(apiKeyProvider);
    await fixture.whenStable();
    fixture.detectChanges();

    const clearButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Clear Shared Credential'));
    expect(clearButton?.disabled).toBe(true);
    expect(textContent(fixture)).not.toContain('Start OpenAI OAuth');
  });

  it('uses the provider temperature default for new providers', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mock: { calls: [ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'alias' | 'modelId',
        event: { target: { value: string } },
      ): void;
      saveProvider(): void;
    };

    component.updateText('alias', { target: { value: 'defaults-alias' } });
    component.updateText('modelId', { target: { value: 'gpt-4o' } });
    fixture.detectChanges();
    component.saveProvider();
    await fixture.whenStable();

    const call = transport.createAdminModelProvider.mock.calls[0];
    if (call === undefined) throw new Error('expected a create call');
    const [request] = call;
    expect(request.maxOutputTokens).toBe(4096);
    expect(request.temperatureMilli).toBeNull();
  });

  it('creates and reads back typed Qwen thinking controls exactly', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mock: { calls: [ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'alias' | 'modelId' | 'reasoningBudgetTokens',
        event: { target: { value: string } },
      ): void;
      updateChatCompletionsDialect(event: { target: { value: string } }): void;
      updateThinkingMode(event: { target: { value: string } }): void;
      updateReasoningHistory(event: { target: { value: string } }): void;
      saveProvider(): void;
    };

    component.updateText('alias', { target: { value: 'qwen-thinking' } });
    component.updateText('modelId', { target: { value: 'qwen3' } });
    component.updateChatCompletionsDialect({ target: { value: 'qwen' } });
    component.updateThinkingMode({ target: { value: 'enabled' } });
    component.updateReasoningHistory({ target: { value: 'preserve_all' } });
    component.updateText('reasoningBudgetTokens', {
      target: { value: '8192' },
    });
    component.saveProvider();
    await fixture.whenStable();
    fixture.detectChanges();

    const call = transport.createAdminModelProvider.mock.calls[0];
    if (call === undefined) throw new Error('expected a create call');
    expect(call[0]).toMatchObject({
      chatCompletionsDialect: 'qwen',
      thinkingMode: 'enabled',
      reasoningHistory: 'preserve_all',
      reasoningBudgetTokens: 8192,
    });
    const readback = fixture.nativeElement.querySelector(
      '[data-testid="provider-reasoning-policy-readback"]',
    )?.textContent;
    expect(readback).toContain('dialect qwen');
    expect(readback).toContain('thinking enabled');
    expect(readback).toContain('history preserve_all');
    expect(readback).toContain('budget 8192');
  });

  it('defaults prompt caching to disabled and round-trips each typed policy', async () => {
    const fixture = await createPanel([]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mock: { calls: [ModelProviderWriteRequest, string][] };
      };
      updateAdminModelProvider: {
        mock: { calls: [string, ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      form(): { promptCaching: string };
      updateText(
        field: 'alias' | 'modelId',
        event: { target: { value: string } },
      ): void;
      updateProviderKind(event: { target: { value: string } }): void;
      updatePromptCaching(event: { target: { value: string } }): void;
      saveProvider(): Promise<void>;
    };

    expect(component.form().promptCaching).toBe('disabled');
    component.updateText('alias', { target: { value: 'anthropic-cache' } });
    component.updateText('modelId', {
      target: { value: 'anthropic/claude-sonnet' },
    });
    component.updateProviderKind({ target: { value: 'openrouter' } });

    for (const promptCaching of ['disabled', 'automatic_5m', 'automatic_1h']) {
      component.updatePromptCaching({ target: { value: promptCaching } });
      await component.saveProvider();
    }

    expect(transport.createAdminModelProvider.mock.calls[0]?.[0]).toMatchObject(
      { promptCaching: 'disabled' },
    );
    expect(
      transport.updateAdminModelProvider.mock.calls.map(
        (call) => call[1].promptCaching,
      ),
    ).toEqual(['automatic_5m', 'automatic_1h']);
    expect(textContent(fixture)).toContain('prompt caching automatic_1h');
  });

  it('leaves unsupported prompt caching validation to Crew and preserves the typed form', async () => {
    const fixture = await createPanel([]);
    const store = TestBed.inject(AdminStore);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminModelProvider: {
        mockImplementationOnce(fn: () => Promise<never>): void;
      };
    };
    transport.createAdminModelProvider.mockImplementationOnce(async () => {
      throw new ChatTransportError({
        code: 'http_error',
        message: 'automatic_5m requires an OpenRouter Anthropic model',
        statusCode: 400,
        apiError: {
          code: 'invalid_input',
          reason_code: 'invalid_model_provider',
          message: 'automatic_5m requires an OpenRouter Anthropic model',
          retryable: false,
        },
      });
    });
    const component = fixture.componentInstance as unknown as {
      form(): { promptCaching: string };
      updateText(
        field: 'alias' | 'modelId',
        event: { target: { value: string } },
      ): void;
      updatePromptCaching(event: { target: { value: string } }): void;
      saveProvider(): Promise<void>;
    };
    component.updateText('alias', { target: { value: 'invalid-cache' } });
    component.updateText('modelId', { target: { value: 'deterministic' } });
    component.updatePromptCaching({ target: { value: 'automatic_5m' } });
    await component.saveProvider();
    fixture.detectChanges();

    expect(store.error()).toContain('OpenRouter Anthropic');
    expect(component.form().promptCaching).toBe('automatic_5m');
  });

  it('preserves pending reasoning values across reversible control transitions', async () => {
    const fixture = await createPanel([]);
    const component = fixture.componentInstance as unknown as {
      form(): {
        protocol: string;
        chatCompletionsDialect: string;
        thinkingMode: string;
        reasoningHistory: string;
        reasoningBudgetTokens: string;
      };
      reasoningConfigurationIssues(): readonly string[];
      updateProtocol(event: { target: { value: string } }): void;
      updateChatCompletionsDialect(event: { target: { value: string } }): void;
      updateThinkingMode(event: { target: { value: string } }): void;
      updateReasoningHistory(event: { target: { value: string } }): void;
      updateText(
        field: 'reasoningBudgetTokens',
        event: { target: { value: string } },
      ): void;
      clearIncompatibleReasoningSettings(): void;
    };

    component.updateChatCompletionsDialect({ target: { value: 'qwen' } });
    component.updateThinkingMode({ target: { value: 'enabled' } });
    component.updateReasoningHistory({ target: { value: 'preserve_all' } });
    component.updateText('reasoningBudgetTokens', {
      target: { value: '8192' },
    });
    const qwenSettings = {
      chatCompletionsDialect: 'qwen',
      thinkingMode: 'enabled',
      reasoningHistory: 'preserve_all',
      reasoningBudgetTokens: '8192',
    };

    component.updateProtocol({ target: { value: 'responses' } });
    expect(component.reasoningConfigurationIssues()).toEqual([]);
    component.updateProtocol({ target: { value: 'chat_completions' } });
    expect(component.form()).toMatchObject(qwenSettings);

    component.updateChatCompletionsDialect({ target: { value: 'standard' } });
    expect(component.form()).toMatchObject({
      ...qwenSettings,
      chatCompletionsDialect: 'standard',
    });
    fixture.detectChanges();
    const warning = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="provider-reasoning-configuration-warning"]',
    );
    expect(warning?.textContent).toContain(
      'The standard dialect requires provider-default thinking.',
    );
    expect(component.reasoningConfigurationIssues()).toEqual([
      'The standard dialect requires provider-default thinking.',
      'The standard dialect requires provider-default history.',
      'The standard dialect does not support a reasoning budget.',
    ]);
    component.updateChatCompletionsDialect({ target: { value: 'qwen' } });
    expect(component.form()).toMatchObject(qwenSettings);

    component.updateThinkingMode({ target: { value: 'disabled' } });
    expect(component.form()).toMatchObject({
      ...qwenSettings,
      thinkingMode: 'disabled',
    });
    component.updateThinkingMode({ target: { value: 'enabled' } });
    expect(component.form()).toMatchObject(qwenSettings);

    component.updateChatCompletionsDialect({ target: { value: 'standard' } });
    component.clearIncompatibleReasoningSettings();
    expect(component.form()).toMatchObject({
      chatCompletionsDialect: 'standard',
      thinkingMode: 'provider_default',
      reasoningHistory: 'provider_default',
      reasoningBudgetTokens: '',
    });
  });

  it('explains all reasoning history policies', async () => {
    const fixture = await createPanel([]);
    const rendered = textContent(fixture);

    expect(rendered).toContain(
      'provider_default strips historical reasoning without a vendor history control',
    );
    expect(rendered).toContain(
      'discard strips it and sends a clear control where supported',
    );
    expect(rendered).toContain('preserve_all replays all reasoning');
    expect(rendered).toContain(
      'tool_calls_only keeps DeepSeek reasoning only on assistant tool-call messages',
    );
  });

  it('round-trips DeepSeek discard and tool-call-only history as distinct policies', async () => {
    const discard = {
      ...makeProvider('deepseek-legacy'),
      chatCompletionsDialect: 'deepseek' as const,
      thinkingMode: 'enabled' as const,
      reasoningHistory: 'discard' as const,
    };
    const toolCalls = {
      ...makeProvider('deepseek-tools'),
      chatCompletionsDialect: 'deepseek' as const,
      thinkingMode: 'enabled' as const,
      reasoningHistory: 'tool_calls_only' as const,
    };
    const fixture = await createPanel([discard, toolCalls]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mock: { calls: [string, ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      saveProvider(): void;
    };

    component.selectProviderForEdit(discard);
    component.saveProvider();
    await fixture.whenStable();
    component.selectProviderForEdit(toolCalls);
    component.saveProvider();
    await fixture.whenStable();

    expect(transport.updateAdminModelProvider.mock.calls[0]?.[1]).toMatchObject(
      { reasoningHistory: 'discard' },
    );
    expect(transport.updateAdminModelProvider.mock.calls[1]?.[1]).toMatchObject(
      { reasoningHistory: 'tool_calls_only' },
    );
  });

  it('keeps typed form state when Crew rejects a Kimi policy', async () => {
    const provider = {
      ...makeProvider('kimi-invalid'),
      maxOutputTokens: 4096,
      temperatureMilli: 700,
      chatCompletionsDialect: 'kimi' as const,
      thinkingMode: 'enabled' as const,
      reasoningHistory: 'preserve_all' as const,
    };
    const fixture = await createPanel([provider]);
    const store = TestBed.inject(AdminStore);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mockImplementationOnce(fn: () => Promise<never>): void;
      };
    };
    transport.updateAdminModelProvider.mockImplementationOnce(async () => {
      throw new ChatTransportError({
        code: 'http_error',
        message: 'kimi thinking models do not accept a temperature override',
        statusCode: 400,
        apiError: {
          code: 'invalid_input',
          reason_code: 'invalid_model_provider',
          message: 'kimi thinking models do not accept a temperature override',
          retryable: false,
        },
      });
    });
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      form(): {
        chatCompletionsDialect: string;
        thinkingMode: string;
        reasoningHistory: string;
        temperature: string;
      };
      saveProvider(): void;
    };

    component.selectProviderForEdit(provider);
    component.saveProvider();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.error()).toContain('temperature override');
    expect(component.form()).toMatchObject({
      chatCompletionsDialect: 'kimi',
      thinkingMode: 'enabled',
      reasoningHistory: 'preserve_all',
      temperature: '0.7',
    });
    expect(textContent(fixture)).toContain(
      'requires Max Output Tokens of at least 16,000',
    );
  });

  it('shows reasoning format as diagnostic readback and does not write it', async () => {
    const provider = { ...makeProvider('format'), reasoningFormat: 'qwen' };
    const fixture = await createPanel([provider]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mock: { calls: [string, ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      saveProvider(): void;
    };

    component.selectProviderForEdit(provider);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      'input[aria-describedby="provider-reasoning-format-help"]',
    ) as HTMLInputElement | null;
    expect(input?.readOnly).toBe(true);
    expect(input?.value).toBe('qwen');
    component.saveProvider();
    await fixture.whenStable();
    expect(
      transport.updateAdminModelProvider.mock.calls[0]?.[1],
    ).not.toHaveProperty('reasoningFormat');
  });

  it('round-trips an existing provider temperature from milli to the decimal field', async () => {
    const fixture = await createPanel([
      { ...makeProvider('warm'), temperatureMilli: 250 },
    ]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mock: { calls: [string, ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      saveProvider(): void;
    };

    component.selectProviderForEdit({
      ...makeProvider('warm'),
      temperatureMilli: 250,
    });
    fixture.detectChanges();
    component.saveProvider();
    await fixture.whenStable();

    const call = transport.updateAdminModelProvider.mock.calls[0];
    if (call === undefined) throw new Error('expected an update call');
    const [, request] = call;
    // 250 milli seeded as 0.25 in the field, sent back as 250 milli.
    expect(request.temperatureMilli).toBe(250);
  });

  it('sends null when an existing temperature override is cleared', async () => {
    const provider = { ...makeProvider('warm'), temperatureMilli: 250 };
    const fixture = await createPanel([provider]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mock: { calls: [string, ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      updateText(
        field: 'temperature',
        event: { target: { value: string } },
      ): void;
      saveProvider(): void;
    };

    component.selectProviderForEdit(provider);
    component.updateText('temperature', { target: { value: '' } });
    fixture.detectChanges();
    component.saveProvider();
    await fixture.whenStable();

    const call = transport.updateAdminModelProvider.mock.calls[0];
    if (call === undefined) throw new Error('expected an update call');
    expect(call[1].temperatureMilli).toBeNull();
  });

  it('shows an unset provider temperature as a blank field', async () => {
    const provider = makeProvider('provider-default');
    const fixture = await createPanel([provider]);
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
    };

    component.selectProviderForEdit(provider);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      'input[placeholder="Provider default"]',
    ) as HTMLInputElement | null;
    expect(input?.value).toBe('');
  });

  it('omits expectedRevision when saving an edited provider so the save overwrites (#3722)', async () => {
    // Provider record carries revision 1; after the record advances elsewhere
    // a stale revision would 409. The save must overwrite, so the request
    // body must not carry expectedRevision at all.
    const fixture = await createPanel([makeProvider('default')]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mock: { calls: [string, ModelProviderWriteRequest, string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      updateText(field: 'modelId', event: { target: { value: string } }): void;
      saveProvider(): void;
    };

    component.selectProviderForEdit(makeProvider('default'));
    component.updateText('modelId', { target: { value: 'gpt-4o-mini' } });
    fixture.detectChanges();
    component.saveProvider();
    await fixture.whenStable();

    const calls = transport.updateAdminModelProvider.mock.calls;
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error('expected an update call');
    const [alias, request] = call;
    expect(alias).toBe('default');
    expect(request).not.toHaveProperty('expectedRevision');
    expect(request.modelId).toBe('gpt-4o-mini');
  });

  it('treats a revision-mismatch 409 as a refreshable conflict, not a generic error (#3722)', async () => {
    const fixture = await createPanel([makeProvider('default')]);
    const store = TestBed.inject(AdminStore);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      updateAdminModelProvider: {
        mockImplementationOnce(fn: () => Promise<never>): void;
      };
    };
    // The next update raises Crew's revision-mismatch conflict envelope.
    transport.updateAdminModelProvider.mockImplementationOnce(async () => {
      throw new ChatTransportError({
        code: 'http_error',
        message: 'expected 2, found 3',
        statusCode: 409,
        apiError: {
          code: 'conflict',
          reason_code: 'model_provider_revision_mismatch',
          message: 'expected 2, found 3',
          retryable: false,
        },
      });
    });

    const component = fixture.componentInstance as unknown as {
      selectProviderForEdit(provider: ModelProviderRecord): void;
      saveProvider(): void;
    };
    component.selectProviderForEdit(makeProvider('default'));
    component.saveProvider();
    await fixture.whenStable();

    // Recoverable, actionable message — not a raw service error string.
    expect(store.error()).toContain('changed elsewhere');
    expect(store.error()).not.toContain('expected 2, found 3');
    expect(store.saving()).toBe(false);
  });

  it('auto-fills context window and reasoning format from a den-router-style probe', async () => {
    const fixture = await createPanel([]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'qwen3', context_length: 40960, thinking_format: 'qwen' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'baseUrl' | 'modelId',
        event: { target: { value: string } },
      ): void;
      probeProvider(): Promise<void>;
      form(): { contextWindowTokens: string; reasoningFormat: string };
      probeStatus(): string;
    };

    // Trailing /v1 is normalized away before hitting /v1/models.
    component.updateText('baseUrl', {
      target: { value: 'http://127.0.0.1:18082/v1' },
    });
    component.updateText('modelId', { target: { value: 'qwen3' } });
    await component.probeProvider();

    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:18082/v1/models');
    expect(component.form().contextWindowTokens).toBe('40960');
    expect(component.form().reasoningFormat).toBe('qwen');
    expect(component.probeStatus()).toContain('Detected');
    fetchSpy.mockRestore();
  });

  it('degrades to a soft message when the provider probe is blocked or offline', async () => {
    const fixture = await createPanel([]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const component = fixture.componentInstance as unknown as {
      updateText(field: 'baseUrl', event: { target: { value: string } }): void;
      probeProvider(): Promise<void>;
      form(): { contextWindowTokens: string };
      probeStatus(): string;
    };

    component.updateText('baseUrl', {
      target: { value: 'http://10.0.0.5:9000' },
    });
    await component.probeProvider();

    expect(component.probeStatus()).toContain('Could not read');
    // Fields are left untouched for manual entry.
    expect(component.form().contextWindowTokens).toBe('');
    fetchSpy.mockRestore();
  });

  it('disables save when the alias or model id is blank on create', async () => {
    const fixture = await createPanel([]);
    const component = fixture.componentInstance as unknown as {
      saveDisabled(): boolean;
    };
    // Initial form: alias and modelId both blank.
    expect(component.saveDisabled()).toBe(true);
  });

  it('surfaces a provider load failure visibly instead of an empty state', async () => {
    const fixture = await createPanel([], true);
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-providers',
      )?.textContent ?? '';

    // A failed provider load must not look like a legitimately empty registry.
    expect(text).toContain('Failed to load providers');
    expect(text).toContain('boom');
    expect(text).not.toContain('No configured providers');
  });
});

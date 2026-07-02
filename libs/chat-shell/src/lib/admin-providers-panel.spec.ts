import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  ChatTransportError,
  type ModelProviderPage,
  type ModelProviderRecord,
  type ModelProviderWriteRequest,
  type ModelProviderWriteResponse,
  type OpenAiOauthCompleteRequest,
  type OpenAiOauthStartResponse,
  type OpenAiOauthStartRequest,
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

function makeTransport(
  providers: readonly ModelProviderRecord[],
  providerLoadFails = false,
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
    adminModelProviders: providerLoadFails
      ? async () => {
          throw new Error('boom');
        }
      : async () => page,
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
    adminOpenAiOauthStatus: vi.fn(async (alias: string) => ({
      provider: {
        ...makeProvider(alias, true),
        credential: { hasSecret: true, kind: 'openai_oauth' },
      },
      credential: { hasSecret: true, kind: 'openai_oauth' },
      loginConfig: openAiOauthLoginConfig(),
      pendingLogins: [],
    })),
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
) {
  await TestBed.configureTestingModule({
    imports: [AdminProvidersPanelComponent],
    providers: [
      AdminStore,
      {
        provide: ChatTransport,
        useValue: makeTransport(providers, providerLoadFails),
      },
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
      saveProvider(): void;
      form(): { secret: string; protocol: string; providerKind: string };
    };

    component.updateText('alias', { target: { value: 'openai-oauth' } });
    component.updateText('modelId', { target: { value: 'gpt-5' } });
    component.updateCredentialMode({
      target: { value: 'openai_oauth' },
    });
    fixture.detectChanges();
    component.saveProvider();
    await fixture.whenStable();

    const call = transport.createAdminModelProvider.mock.calls[0];
    if (call === undefined) throw new Error('expected a create call');
    const [request] = call;
    expect(request.protocol).toBe('responses');
    expect(request.providerKind).toBe('openai');
    expect(request).not.toHaveProperty('secret');
    expect(request).not.toHaveProperty('credentialSecret');
    expect(component.form().secret).toBe('');
  });

  it('starts OpenAI OAuth without overriding Crew registered redirect URL', async () => {
    const oauthProvider: ModelProviderRecord = {
      ...makeProvider('openai-oauth', true),
      protocol: 'responses',
      providerKind: 'openai',
      credential: { hasSecret: true, kind: 'openai_oauth' },
    };
    const fixture = await createPanel([oauthProvider]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminStartOpenAiOauthLogin: {
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

    const request = transport.adminStartOpenAiOauthLogin.mock.calls[0]?.[1];
    expect(request).toEqual({ originator: 'rusty_view' });
    expect(request).not.toHaveProperty('redirectUri');
    openSpy.mockRestore();
  });

  it('starts OAuth and completes by forwarding the pasted callback URL to Crew', async () => {
    const oauthProvider: ModelProviderRecord = {
      ...makeProvider('openai-oauth', true),
      protocol: 'responses',
      providerKind: 'openai',
      credential: { hasSecret: true, kind: 'openai_oauth' },
    };
    const fixture = await createPanel([oauthProvider]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminStartOpenAiOauthLogin: {
        mock: { calls: [string, OpenAiOauthStartRequest][] };
      };
      adminCompleteOpenAiOauthLogin: {
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
    expect(transport.adminStartOpenAiOauthLogin.mock.calls[0]?.[0]).toBe(
      'openai-oauth',
    );
    expect(
      transport.adminStartOpenAiOauthLogin.mock.calls[0]?.[1],
    ).not.toHaveProperty('redirectUri');

    component.updateText('oauthCallbackUrl', {
      target: {
        value:
          'http://localhost:1455/auth/callback?code=code-1&state=callback-state',
      },
    });
    component.completeOpenAiOauthLogin();
    await fixture.whenStable();

    expect(transport.adminCompleteOpenAiOauthLogin.mock.calls[0]?.[1]).toEqual({
      callbackUrl:
        'http://localhost:1455/auth/callback?code=code-1&state=callback-state',
    });
    openSpy.mockRestore();
  });

  it('clears OpenAI OAuth credentials through the explicit clear route', async () => {
    const oauthProvider: ModelProviderRecord = {
      ...makeProvider('openai-oauth', true),
      credential: { hasSecret: true, kind: 'openai_oauth' },
    };
    const fixture = await createPanel([oauthProvider]);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminClearOpenAiOauthCredential: {
        mock: { calls: [string][] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      clearOpenAiOauthCredential(provider: ModelProviderRecord): void;
    };

    component.clearOpenAiOauthCredential(oauthProvider);
    await fixture.whenStable();

    expect(transport.adminClearOpenAiOauthCredential.mock.calls[0]?.[0]).toBe(
      'openai-oauth',
    );
  });

  it('applies create defaults and converts the decimal temperature to milli', async () => {
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
    // Sensible defaults populated, temperature sent in milli (0.7 -> 700).
    expect(request.maxOutputTokens).toBe(4096);
    expect(request.temperatureMilli).toBe(700);
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

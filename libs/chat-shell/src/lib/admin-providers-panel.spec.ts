import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AdminStore } from '@rusty-view/chat-store';
import type {
  ModelConfigurationRecord,
  ModelEndpointRecord,
  ModelProviderRecord,
  ServiceCredentialRecord,
} from '@rusty-view/transport';
import { AdminProvidersPanelComponent } from './admin-providers-panel';

const endpoint: ModelEndpointRecord = {
  endpointId: 'shared-openai',
  status: 'active',
  displayName: 'Shared OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  protocol: 'responses',
  wireDialect: 'openai_stateful',
  authScheme: 'bearer_api_key',
  credentialId: 'credential:any-kind',
  promptCacheTransport: 'none',
  metadataJson: {},
  revision: 7,
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T00:00:00Z',
};

const configuration: ModelConfigurationRecord = {
  modelConfigId: 'gpt-main',
  endpointId: endpoint.endpointId,
  status: 'active',
  modelId: 'gpt-5.6',
  reasoningHistory: 'provider_default',
  thinkingMode: 'provider_default',
  promptCachingPolicy: 'disabled',
  capabilities: { version: 1, imageInput: true },
  metadataJson: {},
  revision: 11,
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T00:00:00Z',
};

const credential: ServiceCredentialRecord = {
  credentialId: 'credential:any-kind',
  displayName: 'Reusable credential',
  providerKind: 'moonshot',
  credentialKind: 'api_key',
  credential: { hasSecret: true, kind: 'api_key' },
  linkedProviderAliases: [],
  revision: 3,
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T00:00:00Z',
};

const legacyProvider: ModelProviderRecord = {
  alias: 'legacy-joined',
  status: 'active',
  protocol: 'responses',
  providerKind: 'openai',
  modelId: 'gpt-old',
  chatCompletionsDialect: 'standard',
  thinkingMode: 'provider_default',
  reasoningHistory: 'provider_default',
  credential: { hasSecret: false },
  metadataJson: {},
  revision: 1,
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T00:00:00Z',
};

function setup() {
  const endpoints = signal<readonly ModelEndpointRecord[]>([endpoint]);
  const configurations = signal<readonly ModelConfigurationRecord[]>([
    configuration,
  ]);
  const createModelEndpoint = vi.fn(async (write) => ({
    endpoint: { ...endpoint, ...write, revision: 1 },
  }));
  const updateModelEndpoint = vi.fn(async (_id, write) => ({
    endpoint: { ...endpoint, ...write, revision: endpoint.revision + 1 },
  }));
  const createModelConfiguration = vi.fn(async (write) => ({
    configuration: { ...configuration, ...write, revision: 1 },
  }));
  const updateModelConfiguration = vi.fn(async (_id, write) => ({
    configuration: {
      ...configuration,
      ...write,
      revision: configuration.revision + 1,
    },
  }));
  const store = {
    refresh: vi.fn(async () => undefined),
    loading: signal(false),
    saving: signal(false),
    error: signal(null),
    modelEndpoints: endpoints,
    modelConfigurations: configurations,
    modelEndpointLoadError: signal(null),
    modelConfigurationLoadError: signal(null),
    serviceCredentials: signal<readonly ServiceCredentialRecord[]>([
      credential,
    ]),
    providerAliases: signal<readonly ModelProviderRecord[]>([legacyProvider]),
    createModelEndpoint,
    updateModelEndpoint,
    createModelConfiguration,
    updateModelConfiguration,
    createServiceCredential: vi.fn(async () => credential),
    startServiceCredentialOpenAiOauthLogin: vi.fn(async () => undefined),
    completeServiceCredentialOpenAiOauthLogin: vi.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    imports: [AdminProvidersPanelComponent],
    providers: [{ provide: AdminStore, useValue: store }],
  });
  const fixture = TestBed.createComponent(AdminProvidersPanelComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance as unknown as {
      editEndpoint(value: ModelEndpointRecord): void;
      saveEndpoint(): Promise<void>;
      editConfiguration(value: ModelConfigurationRecord): void;
      saveConfiguration(): Promise<void>;
    },
    store,
  };
}

describe('AdminProvidersPanelComponent normalized administration', () => {
  it('renders separate endpoint/configuration editors and legacy read-only visibility', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="model-endpoint-editor"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-testid="model-configuration-editor"]'),
    ).not.toBeNull();
    const legacy = root.querySelector('[data-testid="legacy-model-providers"]');
    expect(legacy?.textContent).toContain(
      'Legacy Joined Providers (read-only)',
    );
    expect(legacy?.textContent).toContain('legacy-joined');
    expect(legacy?.querySelector('button')).toBeNull();
  });

  it('uses closed protocol-dependent dialect controls and lists every credential', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const dialect = root.querySelector(
      '[data-testid="model-endpoint-wire-dialect"]',
    ) as HTMLSelectElement;
    expect(Array.from(dialect.options).map((item) => item.value)).toEqual([
      'standard',
      'kimi',
      'glm',
      'qwen',
      'deepseek',
    ]);
    const protocol = root.querySelector(
      '[data-testid="model-endpoint-protocol"]',
    ) as HTMLSelectElement;
    protocol.value = 'responses';
    protocol.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(Array.from(dialect.options).map((item) => item.value)).toEqual([
      'openai_stateful',
      'openai_stateless',
      'generic_stateless',
      'deepseek',
      'meta',
    ]);
    expect(root.textContent).toContain('Reusable credential');
    expect(root.textContent).toContain(
      'compatibility is determined by endpoint auth settings',
    );
  });

  it('shows all configurations affected by editing a shared endpoint', () => {
    const { fixture, component } = setup();
    component.editEndpoint(endpoint);
    fixture.detectChanges();
    const impact = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="model-endpoint-impact"]',
    );
    expect(impact?.textContent).toContain('1 model configurations');
    expect(impact?.textContent).toContain('gpt-main');
  });

  it('writes endpoint and configuration with independent expected revisions', async () => {
    const { component, store } = setup();
    component.editEndpoint(endpoint);
    await component.saveEndpoint();
    expect(store.updateModelEndpoint).toHaveBeenCalledWith(
      endpoint.endpointId,
      expect.objectContaining({ expectedRevision: 7 }),
    );
    component.editConfiguration(configuration);
    await component.saveConfiguration();
    expect(store.updateModelConfiguration).toHaveBeenCalledWith(
      configuration.modelConfigId,
      expect.objectContaining({ expectedRevision: 11 }),
    );
  });
});

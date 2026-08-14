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

function setup(credentials: readonly ServiceCredentialRecord[] = [credential]) {
  const serviceCredentials =
    signal<readonly ServiceCredentialRecord[]>(credentials);
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
  const deleteModelEndpoint = vi.fn(
    async (
      value: ModelEndpointRecord,
    ): Promise<{ endpoint: ModelEndpointRecord } | undefined> => ({
      endpoint: value,
    }),
  );
  const deleteModelConfiguration = vi.fn(
    async (value: ModelConfigurationRecord) => ({ configuration: value }),
  );
  const store = {
    refresh: vi.fn(async () => undefined),
    loading: signal(false),
    saving: signal(false),
    error: signal(null),
    modelEndpoints: endpoints,
    modelConfigurations: configurations,
    modelEndpointLoadError: signal(null),
    modelConfigurationLoadError: signal(null),
    serviceCredentials,
    providerAliases: signal<readonly ModelProviderRecord[]>([legacyProvider]),
    createModelEndpoint,
    updateModelEndpoint,
    deleteModelEndpoint,
    createModelConfiguration,
    updateModelConfiguration,
    deleteModelConfiguration,
    createServiceCredential: vi.fn(async (request) => {
      const created = {
        ...credential,
        credentialId: request.credentialId,
        displayName: request.displayName ?? request.credentialId,
        credentialKind: request.credentialKind ?? 'api_key',
      };
      serviceCredentials.update((current) => [...current, created]);
      return created;
    }),
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
      openCreateEndpoint(): void;
      openCreateConfiguration(): void;
    },
    store,
  };
}

describe('AdminProvidersPanelComponent normalized administration', () => {
  it('renders concise normalized lists and top-level create actions', () => {
    const { fixture, component } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('.rv-admin-providers__title')?.textContent?.trim(),
    ).toBe('Model Providers');
    expect(
      root
        .querySelector('.rv-admin-providers__close')
        ?.getAttribute('aria-label'),
    ).toBe('Close model providers panel');
    expect(
      root.querySelector('[data-testid="create-model-provider"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-testid="create-model-configuration"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-testid="model-endpoint-editor"]'),
    ).toBeNull();
    expect(
      root.querySelector('[data-testid="model-configuration-editor"]'),
    ).toBeNull();
    expect(
      Array.from(root.querySelectorAll('h2')).map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(
      expect.arrayContaining(['Model Providers', 'Model Configurations']),
    );
    root
      .querySelector<HTMLButtonElement>('[data-testid="create-model-provider"]')
      ?.click();
    fixture.detectChanges();
    expect(
      root.querySelector('[data-testid="model-endpoint-editor"]'),
    ).not.toBeNull();
    expect(root.textContent).toContain('Create Model Provider');
    component.openCreateConfiguration();
    fixture.detectChanges();
    expect(
      root.querySelector('[data-testid="model-configuration-editor"]'),
    ).not.toBeNull();
    expect(root.textContent).toContain('Create Model Configuration');
  });

  it('uses closed protocol-dependent dialect controls and lists every credential', () => {
    const { fixture, component } = setup();
    component.openCreateEndpoint();
    fixture.detectChanges();
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
      'compatibility is determined by provider authentication settings',
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

  it('creates an API-key credential from an empty registry and selects it', async () => {
    const { fixture, component, store } = setup([]);
    component.editEndpoint(endpoint);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    selectValue(
      root,
      '[data-testid="model-endpoint-auth-scheme"]',
      'bearer_api_key',
    );
    fixture.detectChanges();
    inputValue(
      root,
      '[data-testid="new-endpoint-credential-id"]',
      'credential:new-key',
    );
    inputValue(root, 'input[type="password"]', 'secret-value');
    root.querySelector<HTMLButtonElement>('button')?.focus();
    const create = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Create API Key Credential',
    );
    create?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.createServiceCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential:new-key',
        credentialKind: 'api_key',
        secret: 'secret-value',
      }),
    );
    expect(
      root.querySelector<HTMLSelectElement>(
        '[data-testid="model-endpoint-credential"]',
      )?.value,
    ).toBe('credential:new-key');
  });

  it('creates an OAuth credential from an empty registry, selects it, and starts login', async () => {
    const { fixture, component, store } = setup([]);
    component.editEndpoint(endpoint);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    selectValue(
      root,
      '[data-testid="model-endpoint-auth-scheme"]',
      'openai_codex_oauth',
    );
    fixture.detectChanges();
    inputValue(
      root,
      '[data-testid="new-endpoint-credential-id"]',
      'credential:new-oauth',
    );
    const start = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Start OpenAI OAuth',
    );
    start?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.createServiceCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential:new-oauth',
        credentialKind: 'openai_oauth',
      }),
    );
    expect(store.startServiceCredentialOpenAiOauthLogin).toHaveBeenCalledWith(
      'credential:new-oauth',
      {},
    );
    expect(
      root.querySelector<HTMLSelectElement>(
        '[data-testid="model-endpoint-credential"]',
      )?.value,
    ).toBe('credential:new-oauth');
  });

  it('opens, cancels, and click-confirms endpoint deletion without text entry', async () => {
    const { fixture, store } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="model-endpoint-delete"]'),
    ).toBeNull();
    root
      .querySelector<HTMLButtonElement>('[data-testid="model-endpoint-edit"]')
      ?.click();
    fixture.detectChanges();
    root
      .querySelector<HTMLButtonElement>('[data-testid="model-endpoint-delete"]')
      ?.click();
    fixture.detectChanges();

    expect(
      root.querySelector('[data-testid="model-endpoint-delete-confirm"] input'),
    ).toBeNull();
    const confirmButton = root.querySelector<HTMLButtonElement>(
      '[data-testid="model-endpoint-confirm-delete"]',
    );
    if (confirmButton === null)
      throw new Error('missing endpoint delete button');
    expect(confirmButton.disabled).toBe(false);

    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-endpoint-delete-confirm"] button:not([data-testid])',
      )
      ?.click();
    fixture.detectChanges();
    expect(store.deleteModelEndpoint).not.toHaveBeenCalled();
    expect(
      root.querySelector('[data-testid="model-endpoint-delete-confirm"]'),
    ).toBeNull();

    root
      .querySelector<HTMLButtonElement>('[data-testid="model-endpoint-delete"]')
      ?.click();
    fixture.detectChanges();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-endpoint-confirm-delete"]',
      )
      ?.click();
    await fixture.whenStable();

    expect(store.deleteModelEndpoint).toHaveBeenCalledTimes(1);
    expect(store.deleteModelEndpoint).toHaveBeenCalledWith(endpoint);
    expect(
      root.querySelector('[data-testid="model-endpoint-delete-confirm"]'),
    ).toBeNull();
  });

  it('keeps endpoint confirmation open when deletion fails', async () => {
    const { fixture, store } = setup();
    const root = fixture.nativeElement as HTMLElement;
    store.deleteModelEndpoint.mockResolvedValueOnce(undefined);

    root
      .querySelector<HTMLButtonElement>('[data-testid="model-endpoint-edit"]')
      ?.click();
    fixture.detectChanges();
    root
      .querySelector<HTMLButtonElement>('[data-testid="model-endpoint-delete"]')
      ?.click();
    fixture.detectChanges();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-endpoint-confirm-delete"]',
      )
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.deleteModelEndpoint).toHaveBeenCalledTimes(1);
    expect(
      root.querySelector('[data-testid="model-endpoint-delete-confirm"]'),
    ).not.toBeNull();
  });

  it('opens, cancels, and click-confirms configuration deletion without text entry', async () => {
    const { fixture, store } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="model-configuration-delete"]'),
    ).toBeNull();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-configuration-edit"]',
      )
      ?.click();
    fixture.detectChanges();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-configuration-delete"]',
      )
      ?.click();
    fixture.detectChanges();

    expect(
      root.querySelector(
        '[data-testid="model-configuration-delete-confirm"] input',
      ),
    ).toBeNull();
    const confirmButton = root.querySelector<HTMLButtonElement>(
      '[data-testid="model-configuration-confirm-delete"]',
    );
    if (confirmButton === null)
      throw new Error('missing configuration delete button');
    expect(confirmButton.disabled).toBe(false);

    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-configuration-delete-confirm"] button:not([data-testid])',
      )
      ?.click();
    fixture.detectChanges();
    expect(store.deleteModelConfiguration).not.toHaveBeenCalled();
    expect(
      root.querySelector('[data-testid="model-configuration-delete-confirm"]'),
    ).toBeNull();

    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-configuration-delete"]',
      )
      ?.click();
    fixture.detectChanges();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="model-configuration-confirm-delete"]',
      )
      ?.click();
    await fixture.whenStable();

    expect(store.deleteModelConfiguration).toHaveBeenCalledTimes(1);
    expect(store.deleteModelConfiguration).toHaveBeenCalledWith(configuration);
    expect(
      root.querySelector('[data-testid="model-configuration-delete-confirm"]'),
    ).toBeNull();
  });
});

function selectValue(root: HTMLElement, selector: string, value: string): void {
  const select = root.querySelector<HTMLSelectElement>(selector);
  if (select === null) throw new Error(`missing select ${selector}`);
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

function inputValue(root: HTMLElement, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (input === null) throw new Error(`missing input ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

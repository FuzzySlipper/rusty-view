import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { AdminStore } from '@rusty-view/chat-store';
import type {
  ModelConfigurationRecord,
  ModelEndpointAuthScheme,
  ModelEndpointProtocol,
  ModelEndpointRecord,
  ModelEndpointWireDialect,
  ModelPromptCachingPolicy,
  ModelReasoningHistory,
  ModelThinkingMode,
  NormalizedModelStatus,
  PromptCacheTransport,
} from '@rusty-view/transport';

interface EndpointForm {
  endpointId: string;
  displayName: string;
  description: string;
  baseUrl: string;
  protocol: ModelEndpointProtocol;
  wireDialect: ModelEndpointWireDialect;
  authScheme: ModelEndpointAuthScheme;
  credentialId: string;
  promptCacheTransport: PromptCacheTransport;
  status: NormalizedModelStatus;
  revision?: number;
}

interface ConfigurationForm {
  modelConfigId: string;
  endpointId: string;
  displayName: string;
  description: string;
  modelId: string;
  contextWindowTokens: string;
  maxOutputTokens: string;
  temperatureMilli: string;
  reasoningEffort: string;
  reasoningFormat: string;
  reasoningHistory: ModelReasoningHistory;
  reasoningBudgetTokens: string;
  thinkingMode: ModelThinkingMode;
  promptCachingPolicy: ModelPromptCachingPolicy;
  imageInput: boolean;
  status: NormalizedModelStatus;
  revision?: number;
}

const STATUS: readonly NormalizedModelStatus[] = [
  'active',
  'disabled',
  'archived',
];
const RESPONSES_DIALECTS: readonly ModelEndpointWireDialect[] = [
  'openai_stateful',
  'openai_stateless',
  'generic_stateless',
  'deepseek',
  'meta',
];
const CHAT_DIALECTS: readonly ModelEndpointWireDialect[] = [
  'standard',
  'kimi',
  'glm',
  'qwen',
  'deepseek',
];
const AUTH: readonly ModelEndpointAuthScheme[] = [
  'none',
  'bearer_api_key',
  'openai_codex_oauth',
];
const CACHE_TRANSPORT: readonly PromptCacheTransport[] = [
  'none',
  'openrouter_anthropic',
];
const HISTORY: readonly ModelReasoningHistory[] = [
  'provider_default',
  'discard',
  'preserve_all',
  'tool_calls_only',
];
const THINKING: readonly ModelThinkingMode[] = [
  'provider_default',
  'enabled',
  'disabled',
];
const CACHING: readonly ModelPromptCachingPolicy[] = [
  'disabled',
  'automatic_5m',
  'automatic_1h',
];

function newEndpoint(): EndpointForm {
  return {
    endpointId: '',
    displayName: '',
    description: '',
    baseUrl: '',
    protocol: 'chat_completions',
    wireDialect: 'standard',
    authScheme: 'none',
    credentialId: '',
    promptCacheTransport: 'none',
    status: 'active',
  };
}

function newConfiguration(): ConfigurationForm {
  return {
    modelConfigId: '',
    endpointId: '',
    displayName: '',
    description: '',
    modelId: '',
    contextWindowTokens: '',
    maxOutputTokens: '',
    temperatureMilli: '',
    reasoningEffort: '',
    reasoningFormat: '',
    reasoningHistory: 'provider_default',
    reasoningBudgetTokens: '',
    thinkingMode: 'provider_default',
    promptCachingPolicy: 'disabled',
    imageInput: false,
    status: 'active',
  };
}

@Component({
  selector: 'rv-admin-providers-panel',
  templateUrl: './admin-providers-panel.html',
  styleUrl: './admin-providers-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProvidersPanelComponent {
  protected readonly admin = inject(AdminStore);
  readonly dismissed = output<void>();

  protected readonly statuses = STATUS;
  protected readonly authSchemes = AUTH;
  protected readonly cacheTransports = CACHE_TRANSPORT;
  protected readonly histories = HISTORY;
  protected readonly thinkingModes = THINKING;
  protected readonly cachingPolicies = CACHING;
  protected readonly endpointForm = signal<EndpointForm>(newEndpoint());
  protected readonly configurationForm =
    signal<ConfigurationForm>(newConfiguration());
  protected readonly editingEndpointId = signal<string | null>(null);
  protected readonly editingModelConfigId = signal<string | null>(null);
  protected readonly oauthCallbackUrl = signal('');
  protected readonly newCredentialName = signal('');
  protected readonly newCredentialSecret = signal('');

  protected readonly wireDialects = computed(() =>
    this.endpointForm().protocol === 'responses'
      ? RESPONSES_DIALECTS
      : CHAT_DIALECTS,
  );
  protected readonly endpointImpact = computed(() => {
    const id = this.editingEndpointId();
    return id === null
      ? []
      : this.admin
          .modelConfigurations()
          .filter((item) => item.endpointId === id);
  });
  protected readonly selectedCredential = computed(() =>
    this.admin
      .serviceCredentials()
      .find((item) => item.credentialId === this.endpointForm().credentialId),
  );
  protected readonly endpointSaveDisabled = computed(() => {
    const form = this.endpointForm();
    return (
      this.admin.saving() ||
      form.endpointId.trim() === '' ||
      form.baseUrl.trim() === '' ||
      (form.authScheme !== 'none' && form.credentialId === '')
    );
  });
  protected readonly configurationSaveDisabled = computed(() => {
    const form = this.configurationForm();
    return (
      this.admin.saving() ||
      form.modelConfigId.trim() === '' ||
      form.endpointId === '' ||
      form.modelId.trim() === ''
    );
  });

  constructor() {
    void this.admin.refresh();
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }
  protected refresh(): void {
    void this.admin.refresh();
  }
  protected endpointText(field: keyof EndpointForm, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.endpointForm.update((current) => ({ ...current, [field]: value }));
  }
  protected configurationText(
    field: keyof ConfigurationForm,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.configurationForm.update((current) => ({
      ...current,
      [field]: value,
    }));
  }
  protected updateProtocol(event: Event): void {
    const protocol = (event.target as HTMLSelectElement)
      .value as ModelEndpointProtocol;
    this.endpointForm.update((current) => ({
      ...current,
      protocol,
      wireDialect: protocol === 'responses' ? 'openai_stateful' : 'standard',
    }));
  }
  protected updateAuth(event: Event): void {
    const authScheme = (event.target as HTMLSelectElement)
      .value as ModelEndpointAuthScheme;
    this.endpointForm.update((current) => ({
      ...current,
      authScheme,
      credentialId: authScheme === 'none' ? '' : current.credentialId,
    }));
  }
  protected updateImageInput(event: Event): void {
    const imageInput = (event.target as HTMLInputElement).checked;
    this.configurationForm.update((current) => ({ ...current, imageInput }));
  }
  protected editEndpoint(endpoint: ModelEndpointRecord): void {
    this.editingEndpointId.set(endpoint.endpointId);
    this.endpointForm.set({
      endpointId: endpoint.endpointId,
      displayName: endpoint.displayName ?? '',
      description: endpoint.description ?? '',
      baseUrl: endpoint.baseUrl,
      protocol: endpoint.protocol,
      wireDialect: endpoint.wireDialect,
      authScheme: endpoint.authScheme,
      credentialId: endpoint.credentialId ?? '',
      promptCacheTransport: endpoint.promptCacheTransport,
      status: endpoint.status,
      revision: endpoint.revision,
    });
  }
  protected editConfiguration(configuration: ModelConfigurationRecord): void {
    this.editingModelConfigId.set(configuration.modelConfigId);
    this.configurationForm.set({
      modelConfigId: configuration.modelConfigId,
      endpointId: configuration.endpointId,
      displayName: configuration.displayName ?? '',
      description: configuration.description ?? '',
      modelId: configuration.modelId,
      contextWindowTokens: numberText(configuration.contextWindowTokens),
      maxOutputTokens: numberText(configuration.maxOutputTokens),
      temperatureMilli: numberText(configuration.temperatureMilli),
      reasoningEffort: configuration.reasoningEffort ?? '',
      reasoningFormat: configuration.reasoningFormat ?? '',
      reasoningHistory: configuration.reasoningHistory,
      reasoningBudgetTokens: numberText(configuration.reasoningBudgetTokens),
      thinkingMode: configuration.thinkingMode,
      promptCachingPolicy: configuration.promptCachingPolicy,
      imageInput: configuration.capabilities.imageInput,
      status: configuration.status,
      revision: configuration.revision,
    });
  }
  protected cancelEndpoint(): void {
    this.editingEndpointId.set(null);
    this.endpointForm.set(newEndpoint());
  }
  protected cancelConfiguration(): void {
    this.editingModelConfigId.set(null);
    this.configurationForm.set(newConfiguration());
  }
  protected async saveEndpoint(): Promise<void> {
    if (this.endpointSaveDisabled()) return;
    const form = this.endpointForm();
    const write = {
      endpointId: form.endpointId.trim(),
      status: form.status,
      ...(form.displayName.trim()
        ? { displayName: form.displayName.trim() }
        : {}),
      ...(form.description.trim()
        ? { description: form.description.trim() }
        : {}),
      baseUrl: form.baseUrl.trim(),
      protocol: form.protocol,
      wireDialect: form.wireDialect,
      authScheme: form.authScheme,
      ...(form.credentialId ? { credentialId: form.credentialId } : {}),
      promptCacheTransport: form.promptCacheTransport,
      metadataJson: {},
      ...(form.revision === undefined
        ? {}
        : { expectedRevision: form.revision }),
    };
    const result = this.editingEndpointId()
      ? await this.admin.updateModelEndpoint(form.endpointId, write)
      : await this.admin.createModelEndpoint(write);
    if (result !== undefined) this.editEndpoint(result.endpoint);
  }
  protected async saveConfiguration(): Promise<void> {
    if (this.configurationSaveDisabled()) return;
    const form = this.configurationForm();
    const write = {
      modelConfigId: form.modelConfigId.trim(),
      endpointId: form.endpointId,
      status: form.status,
      ...(form.displayName.trim()
        ? { displayName: form.displayName.trim() }
        : {}),
      ...(form.description.trim()
        ? { description: form.description.trim() }
        : {}),
      modelId: form.modelId.trim(),
      ...optionalNumber('contextWindowTokens', form.contextWindowTokens),
      ...optionalNumber('maxOutputTokens', form.maxOutputTokens),
      ...optionalNumber('temperatureMilli', form.temperatureMilli),
      ...(form.reasoningEffort.trim()
        ? { reasoningEffort: form.reasoningEffort.trim() }
        : {}),
      ...(form.reasoningFormat.trim()
        ? { reasoningFormat: form.reasoningFormat.trim() }
        : {}),
      reasoningHistory: form.reasoningHistory,
      ...optionalNumber('reasoningBudgetTokens', form.reasoningBudgetTokens),
      thinkingMode: form.thinkingMode,
      promptCachingPolicy: form.promptCachingPolicy,
      capabilities: { version: 1 as const, imageInput: form.imageInput },
      metadataJson: {},
      ...(form.revision === undefined
        ? {}
        : { expectedRevision: form.revision }),
    };
    const result = this.editingModelConfigId()
      ? await this.admin.updateModelConfiguration(form.modelConfigId, write)
      : await this.admin.createModelConfiguration(write);
    if (result !== undefined) this.editConfiguration(result.configuration);
  }
  protected async createApiKeyCredential(): Promise<void> {
    const id = this.endpointForm().credentialId.trim();
    if (!id || !this.newCredentialSecret().trim()) return;
    const credential = await this.admin.createServiceCredential({
      credentialId: id,
      displayName: this.newCredentialName().trim() || id,
      providerKind: 'custom',
      credentialKind: 'api_key',
      secret: this.newCredentialSecret().trim(),
    });
    if (credential) this.newCredentialSecret.set('');
  }
  protected async startOauth(): Promise<void> {
    const id = this.endpointForm().credentialId.trim();
    if (!id) return;
    if (!this.selectedCredential()) {
      await this.admin.createServiceCredential({
        credentialId: id,
        displayName: this.newCredentialName().trim() || id,
        providerKind: 'openai',
        credentialKind: 'openai_oauth',
      });
    }
    await this.admin.startServiceCredentialOpenAiOauthLogin(id, {});
  }
  protected async completeOauth(): Promise<void> {
    const id = this.endpointForm().credentialId.trim();
    const callbackUrl = this.oauthCallbackUrl().trim();
    if (id && callbackUrl) {
      await this.admin.completeServiceCredentialOpenAiOauthLogin(id, {
        callbackUrl,
      });
    }
  }
}

function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function optionalNumber<K extends string>(
  key: K,
  value: string,
): Partial<Record<K, number>> {
  const trimmed = value.trim();
  return trimmed === ''
    ? {}
    : ({ [key]: Number(trimmed) } as Partial<Record<K, number>>);
}

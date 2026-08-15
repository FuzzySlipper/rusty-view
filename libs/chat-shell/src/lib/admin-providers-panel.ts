import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { AdminStore } from '@rusty-view/chat-store';
import type {
  ModelConfigurationPatch,
  ModelConfigurationRecord,
  ModelConfigurationWrite,
  ModelEndpointAuthScheme,
  ModelEndpointProtocol,
  ModelEndpointRecord,
  ModelEndpointWireDialect,
  ModelPromptCachingPolicy,
  ModelReasoningHistory,
  ModelThinkingMode,
  NormalizedModelStatus,
  PromptCacheTransport,
  ServiceCredentialRecord,
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
const REASONING_EFFORT_OPTIONS: readonly {
  value: string;
  label: string;
}[] = [
  { value: '', label: 'Provider default' },
  { value: 'none', label: 'none' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
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
    contextWindowTokens: '1000000',
    maxOutputTokens: '64000',
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
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly dismissed = output<void>();

  protected readonly statuses = STATUS;
  protected readonly authSchemes = AUTH;
  protected readonly cacheTransports = CACHE_TRANSPORT;
  protected readonly histories = HISTORY;
  protected readonly thinkingModes = THINKING;
  protected readonly cachingPolicies = CACHING;
  protected readonly reasoningEffortOptions = REASONING_EFFORT_OPTIONS;
  protected readonly endpointForm = signal<EndpointForm>(newEndpoint());
  protected readonly configurationForm =
    signal<ConfigurationForm>(newConfiguration());
  protected readonly editingEndpointId = signal<string | null>(null);
  protected readonly editingModelConfigId = signal<string | null>(null);
  protected readonly endpointEditorOpen = signal(false);
  protected readonly configurationEditorOpen = signal(false);
  protected readonly endpointDeleteId = signal<string | null>(null);
  protected readonly configurationDeleteId = signal<string | null>(null);
  protected readonly oauthCallbackUrl = signal('');
  protected readonly newCredentialId = signal('');
  protected readonly newCredentialName = signal('');
  protected readonly newCredentialSecret = signal('');
  private readonly createdCredential = signal<ServiceCredentialRecord | null>(
    null,
  );
  private readonly localCredentialId = signal<string | null>(null);

  protected readonly credentialOptions = computed(() => {
    const credentials = this.admin.serviceCredentials();
    const created = this.createdCredential();
    return created === null ||
      credentials.some((item) => item.credentialId === created.credentialId)
      ? credentials
      : [...credentials, created];
  });
  protected readonly localCredentialOption = computed(() => {
    const id = this.localCredentialId();
    return id === null ||
      this.credentialOptions().some((item) => item.credentialId === id)
      ? null
      : id;
  });

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
  protected readonly editingEndpoint = computed(() => {
    const id = this.editingEndpointId();
    return id === null
      ? undefined
      : this.admin.modelEndpoints().find((item) => item.endpointId === id);
  });
  protected readonly editingConfiguration = computed(() => {
    const id = this.editingModelConfigId();
    return id === null
      ? undefined
      : this.admin
          .modelConfigurations()
          .find((item) => item.modelConfigId === id);
  });
  protected readonly selectedCredential = computed(() =>
    this.credentialOptions().find(
      (item) => item.credentialId === this.endpointForm().credentialId,
    ),
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

  protected openCreateEndpoint(): void {
    this.cancelConfiguration();
    this.endpointForm.set(newEndpoint());
    this.editingEndpointId.set(null);
    this.endpointEditorOpen.set(true);
  }

  protected openCreateConfiguration(): void {
    this.cancelEndpoint();
    this.configurationForm.set(newConfiguration());
    this.editingModelConfigId.set(null);
    this.configurationEditorOpen.set(true);
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
    this.cancelDeleteEndpoint();
    this.editingEndpointId.set(endpoint.endpointId);
    this.endpointEditorOpen.set(true);
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
    this.cancelDeleteConfiguration();
    this.editingModelConfigId.set(configuration.modelConfigId);
    this.configurationEditorOpen.set(true);
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
    this.cancelDeleteEndpoint();
    this.editingEndpointId.set(null);
    this.endpointEditorOpen.set(false);
    this.endpointForm.set(newEndpoint());
  }
  protected cancelConfiguration(): void {
    this.cancelDeleteConfiguration();
    this.editingModelConfigId.set(null);
    this.configurationEditorOpen.set(false);
    this.configurationForm.set(newConfiguration());
  }

  protected requestDeleteEndpoint(endpoint: ModelEndpointRecord): void {
    if (this.admin.saving()) return;
    this.endpointDeleteId.set(endpoint.endpointId);
  }

  protected cancelDeleteEndpoint(): void {
    this.endpointDeleteId.set(null);
  }

  protected async deleteEndpoint(endpoint: ModelEndpointRecord): Promise<void> {
    if (this.endpointDeleteId() !== endpoint.endpointId) return;
    const result = await this.admin.deleteModelEndpoint(endpoint);
    if (result === undefined) return;
    this.cancelDeleteEndpoint();
    if (this.editingEndpointId() === endpoint.endpointId) {
      this.cancelEndpoint();
    }
  }

  protected requestDeleteConfiguration(
    configuration: ModelConfigurationRecord,
  ): void {
    if (this.admin.saving()) return;
    this.configurationDeleteId.set(configuration.modelConfigId);
  }

  protected cancelDeleteConfiguration(): void {
    this.configurationDeleteId.set(null);
  }

  protected async deleteConfiguration(
    configuration: ModelConfigurationRecord,
  ): Promise<void> {
    if (this.configurationDeleteId() !== configuration.modelConfigId) return;
    const result = await this.admin.deleteModelConfiguration(configuration);
    if (result === undefined) return;
    this.cancelDeleteConfiguration();
    if (this.editingModelConfigId() === configuration.modelConfigId) {
      this.cancelConfiguration();
    }
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
    const common = {
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
      reasoningHistory: form.reasoningHistory,
      thinkingMode: form.thinkingMode,
      promptCachingPolicy: form.promptCachingPolicy,
      capabilities: { version: 1 as const, imageInput: form.imageInput },
      metadataJson: {},
      ...(form.revision === undefined
        ? {}
        : { expectedRevision: form.revision }),
    };
    const editing = this.editingModelConfigId() !== null;
    const reasoningEffort = form.reasoningEffort.trim();
    const reasoningFormat = form.reasoningFormat.trim();
    const reasoningBudgetTokens = form.reasoningBudgetTokens.trim();
    const write: ModelConfigurationWrite | ModelConfigurationPatch = {
      ...common,
      ...(reasoningEffort !== ''
        ? { reasoningEffort }
        : editing
          ? { reasoningEffort: null }
          : {}),
      ...(reasoningFormat !== ''
        ? { reasoningFormat }
        : editing
          ? { reasoningFormat: null }
          : {}),
      ...(reasoningBudgetTokens !== ''
        ? optionalNumber('reasoningBudgetTokens', reasoningBudgetTokens)
        : editing
          ? { reasoningBudgetTokens: null }
          : {}),
    };
    const result = editing
      ? await this.admin.updateModelConfiguration(
          form.modelConfigId,
          write as ModelConfigurationPatch,
        )
      : await this.admin.createModelConfiguration(
          write as ModelConfigurationWrite,
        );
    if (result !== undefined) this.editConfiguration(result.configuration);
  }
  protected createApiKeyCredential(): void {
    const id = this.newCredentialId().trim();
    if (!id || !this.newCredentialSecret().trim()) return;
    this.localCredentialId.set(id);
    this.endpointForm.update((current) => ({ ...current, credentialId: id }));
    this.changeDetector.detectChanges();
    void this.persistApiKeyCredential(id);
  }

  private async persistApiKeyCredential(id: string): Promise<void> {
    const credential = await this.admin.createServiceCredential({
      credentialId: id,
      displayName: this.newCredentialName().trim() || id,
      providerKind: 'custom',
      credentialKind: 'api_key',
      secret: this.newCredentialSecret().trim(),
    });
    if (credential) {
      this.createdCredential.set(credential);
      this.endpointForm.update((current) => ({
        ...current,
        credentialId: credential.credentialId,
      }));
      this.changeDetector.detectChanges();
      this.newCredentialSecret.set('');
    } else {
      this.newCredentialSecret.set('');
    }
  }
  protected startOauth(): void {
    const id =
      this.newCredentialId().trim() || this.endpointForm().credentialId.trim();
    if (!id) return;
    const existingCredential = this.credentialOptions().find(
      (credential) => credential.credentialId === id,
    );
    if (existingCredential === undefined) {
      this.localCredentialId.set(id);
      this.endpointForm.update((current) => ({ ...current, credentialId: id }));
      this.changeDetector.detectChanges();
      void this.createAndStartOauth(id);
      return;
    }
    void this.admin.startServiceCredentialOpenAiOauthLogin(id, {});
  }

  private async createAndStartOauth(id: string): Promise<void> {
    const credential = await this.admin.createServiceCredential({
      credentialId: id,
      displayName: this.newCredentialName().trim() || id,
      providerKind: 'openai',
      credentialKind: 'openai_oauth',
    });
    if (credential !== undefined) {
      this.createdCredential.set(credential);
      this.endpointForm.update((current) => ({
        ...current,
        credentialId: credential.credentialId,
      }));
      this.changeDetector.detectChanges();
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

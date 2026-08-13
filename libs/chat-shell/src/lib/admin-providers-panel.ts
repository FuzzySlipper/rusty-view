import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { AdminStore } from '@rusty-view/chat-store';
import type {
  ChatCompletionsDialect,
  ChatCompletionsPromptCaching,
  ChatCompletionsReasoningHistory,
  ChatCompletionsThinkingMode,
  ModelProviderProtocol,
  ModelProviderKind,
  ModelProviderRecord,
  ModelProviderStatus,
  ModelProviderWriteRequest,
  ModelProviderWriteResponse,
  OpenAiOauthPendingLogin,
  ResponsesProviderDialect,
  ServiceCredentialRecord,
} from '@rusty-view/transport';

type ProviderCredentialMode =
  | 'unconfigured'
  | 'create_api_key'
  | 'create_openai_oauth'
  | 'reuse';

interface ProviderFormState {
  readonly alias: string;
  readonly displayName: string;
  readonly description: string;
  readonly protocol: ModelProviderProtocol;
  readonly providerKind: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly contextWindowTokens: string;
  readonly maxOutputTokens: string;
  /** Optional temperature override as a decimal (0–2); blank uses provider default. */
  readonly temperature: string;
  readonly reasoningEffort: string;
  /** Probe/readback diagnostic only; Crew does not map this as configuration. */
  readonly reasoningFormat: string;
  readonly responsesDialect: ResponsesProviderDialect | '';
  readonly promptCaching: ChatCompletionsPromptCaching;
  readonly chatCompletionsDialect: ChatCompletionsDialect;
  readonly thinkingMode: ChatCompletionsThinkingMode;
  readonly reasoningHistory: ChatCompletionsReasoningHistory;
  readonly reasoningBudgetTokens: string;
  readonly credentialMode: ProviderCredentialMode;
  readonly credentialId: string;
  readonly credentialDisplayName: string;
  readonly secret: string;
  readonly oauthCallbackUrl: string;
  readonly status: ModelProviderStatus;
}

function initialForm(): ProviderFormState {
  return {
    alias: '',
    displayName: '',
    description: '',
    protocol: 'chat_completions',
    providerKind: 'custom',
    baseUrl: '',
    modelId: '',
    contextWindowTokens: '',
    maxOutputTokens: '4096',
    temperature: '',
    reasoningEffort: '',
    reasoningFormat: '',
    responsesDialect: '',
    promptCaching: 'disabled',
    chatCompletionsDialect: 'standard',
    thinkingMode: 'provider_default',
    reasoningHistory: 'provider_default',
    reasoningBudgetTokens: '',
    credentialMode: 'unconfigured',
    credentialId: '',
    credentialDisplayName: '',
    secret: '',
    oauthCallbackUrl: '',
    status: 'active',
  };
}

/**
 * Reasoning effort levels offered in the dropdown. `''` leaves the field unset
 * (omitted from the request, provider default applies). The named levels mirror
 * the usual provider spread.
 */
const REASONING_EFFORT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: '(default)' },
  { value: 'none', label: 'none' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

const CHAT_COMPLETIONS_DIALECTS: readonly ChatCompletionsDialect[] = [
  'standard',
  'kimi',
  'glm',
  'qwen',
  'deepseek',
];

const PROMPT_CACHING_OPTIONS: readonly {
  value: ChatCompletionsPromptCaching;
  label: string;
}[] = [
  { value: 'disabled', label: 'Disabled (default)' },
  { value: 'automatic_5m', label: 'Automatic (5 minutes)' },
  { value: 'automatic_1h', label: 'Automatic (1 hour)' },
];

const RESPONSES_DIALECT_OPTIONS: readonly {
  value: ResponsesProviderDialect;
  label: string;
}[] = [
  { value: 'openai_stateful', label: 'OpenAI stateful' },
  { value: 'openai_stateless', label: 'OpenAI stateless' },
  { value: 'generic_stateless', label: 'Generic stateless' },
  { value: 'deepseek', label: 'DeepSeek (direct)' },
  { value: 'meta', label: 'Meta Responses' },
];

const PROVIDER_KIND_OPTIONS: readonly {
  value: ModelProviderKind;
  label: string;
}[] = [
  { value: 'custom', label: 'Custom / generic' },
  { value: 'local', label: 'Local deterministic' },
  { value: 'den-router', label: 'Den Router' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'moonshot', label: 'Moonshot' },
];

function isSupportedProviderKind(value: string): value is ModelProviderKind {
  return PROVIDER_KIND_OPTIONS.some((option) => option.value === value);
}

function isCredentialSelectionCompatible(
  form: ProviderFormState,
  credentials: readonly ServiceCredentialRecord[],
): boolean {
  if (form.protocol === 'responses') return true;
  if (form.credentialMode === 'create_openai_oauth') return false;
  if (form.credentialMode !== 'reuse') return true;
  return !credentials.some(
    (credential) =>
      credential.credentialId === form.credentialId &&
      credential.credentialKind === 'openai_oauth',
  );
}

const THINKING_MODES: readonly ChatCompletionsThinkingMode[] = [
  'provider_default',
  'enabled',
  'disabled',
];

const REASONING_HISTORY_OPTIONS: readonly ChatCompletionsReasoningHistory[] = [
  'provider_default',
  'discard',
  'preserve_all',
  'tool_calls_only',
];

/**
 * Admin panel for the service-level model provider registry (tasks #3534/#3537).
 *
 * Operators create reusable provider aliases here; profiles then reference an
 * alias by id instead of embedding full model/provider config. Secrets are
 * never displayed — `credential.hasSecret` shows whether a key is configured
 * and the panel only accepts an explicit set/replace/clear action.
 */
@Component({
  selector: 'rv-admin-providers-panel',
  templateUrl: './admin-providers-panel.html',
  styleUrl: './admin-providers-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProvidersPanelComponent {
  protected readonly admin = inject(AdminStore);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly dismissed = output<void>();

  protected readonly reasoningEffortOptions = REASONING_EFFORT_OPTIONS;
  protected readonly responsesDialectOptions = RESPONSES_DIALECT_OPTIONS;
  protected readonly providerKindOptions = PROVIDER_KIND_OPTIONS;
  protected readonly chatCompletionsDialects = CHAT_COMPLETIONS_DIALECTS;
  protected readonly promptCachingOptions = PROMPT_CACHING_OPTIONS;
  protected readonly thinkingModes = THINKING_MODES;
  protected readonly reasoningHistoryOptions = REASONING_HISTORY_OPTIONS;
  protected readonly form = signal<ProviderFormState>(initialForm());
  protected readonly editingAlias = signal<string | null>(null);
  /** Status line for the most recent base-URL capability probe (#3722 follow-up). */
  protected readonly probeStatus = signal<string>('');
  protected readonly oauthCallbackReady = computed(
    () => this.form().oauthCallbackUrl.trim() !== '',
  );
  protected readonly providerKindSupported = computed(() =>
    isSupportedProviderKind(this.form().providerKind),
  );
  protected readonly availableCredentials = computed(() => {
    const form = this.form();
    return this.admin.serviceCredentials().filter((credential) => {
      return !(
        credential.credentialKind === 'openai_oauth' &&
        form.protocol !== 'responses'
      );
    });
  });
  protected readonly selectedCredential = computed(() => {
    const credentialId = this.form().credentialId;
    return (
      this.admin
        .serviceCredentials()
        .find((credential) => credential.credentialId === credentialId) ?? null
    );
  });
  protected readonly selectedOauthStatus = computed(() => {
    const credentialId = this.form().credentialId;
    const status = this.admin.serviceCredentialOauthStatus();
    return status?.credential.credentialId === credentialId ? status : null;
  });
  protected readonly oauthCredentialState = computed<
    'checking' | 'configured' | 'pending' | 'unconfigured'
  >(() => {
    if (this.admin.saving()) return 'checking';
    const status = this.selectedOauthStatus();
    if (status === null) return 'unconfigured';
    if (status.pendingLogins.length > 0) return 'pending';
    return status.credential.credential.hasSecret &&
      status.credential.credentialKind === 'openai_oauth'
      ? 'configured'
      : 'unconfigured';
  });
  protected readonly selectedCredentialImpact = computed(() => {
    const credentialId = this.form().credentialId;
    const impact = this.admin.serviceCredentialImpact();
    return impact?.credential.credentialId === credentialId ? impact : null;
  });
  protected readonly credentialChoice = computed(() => {
    const form = this.form();
    return form.credentialMode === 'reuse'
      ? `reuse:${form.credentialId}`
      : form.credentialMode;
  });
  protected readonly oauthMode = computed(() => {
    const form = this.form();
    return (
      form.credentialMode === 'create_openai_oauth' ||
      this.selectedCredential()?.credentialKind === 'openai_oauth'
    );
  });
  protected readonly persistedOauthProtocolConflict = computed(() => {
    const alias = this.editingAlias();
    if (alias === null || this.form().protocol === 'responses') return false;
    const provider = this.admin
      .modelProviders()
      ?.items.find((candidate) => candidate.alias === alias);
    if (provider?.credentialId === undefined) return false;
    return this.admin
      .serviceCredentials()
      .some(
        (credential) =>
          credential.credentialId === provider.credentialId &&
          credential.credentialKind === 'openai_oauth',
      );
  });
  protected readonly credentialSelectionCompatible = computed(() =>
    isCredentialSelectionCompatible(
      this.form(),
      this.admin.serviceCredentials(),
    ),
  );
  protected readonly reasoningBudgetEnabled = computed(() => {
    const form = this.form();
    return (
      form.protocol === 'chat_completions' &&
      form.chatCompletionsDialect === 'qwen' &&
      form.thinkingMode === 'enabled'
    );
  });
  protected readonly kimiThinkingConstraintsActive = computed(() => {
    const form = this.form();
    return (
      form.protocol === 'chat_completions' &&
      form.chatCompletionsDialect === 'kimi' &&
      form.thinkingMode !== 'disabled'
    );
  });
  protected readonly reasoningConfigurationIssues = computed(() =>
    reasoningConfigurationIssues(this.form()),
  );

  protected readonly saveDisabled = computed(() => {
    const form = this.form();
    if (this.admin.saving()) return true;
    if (!this.providerKindSupported()) return true;
    // Create requires an alias and model id; edit uses the path alias.
    if (this.editingAlias() === null && form.alias.trim() === '') return true;
    if (form.modelId.trim() === '') return true;
    if (form.protocol === 'responses' && form.responsesDialect === '') {
      return true;
    }
    if (!this.credentialSelectionCompatible()) return true;
    if (this.persistedOauthProtocolConflict()) return true;
    return this.reasoningConfigurationIssues().length > 0;
  });

  constructor() {
    void this.admin.refresh();
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }

  protected refresh(): void {
    void this.admin.refresh().then(() => this.refreshView());
  }

  protected updateText(
    field: Exclude<
      keyof ProviderFormState,
      | 'protocol'
      | 'providerKind'
      | 'status'
      | 'credentialMode'
      | 'responsesDialect'
      | 'promptCaching'
      | 'chatCompletionsDialect'
      | 'thinkingMode'
      | 'reasoningHistory'
    >,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  /**
   * Best-effort capability probe (#3722 follow-up). den-router-style providers
   * expose `GET {baseUrl}/v1/models` with no auth, and each model entry carries
   * `context_length` and `thinking_format`. When the Base URL changes we read
   * those for the configured model and auto-fill Context Window / Reasoning
   * Format. The provider host is a different origin than Crew, so this is
   * best-effort: CORS or an offline host degrades to a soft status message and
   * leaves the operator to fill the fields manually.
   */
  protected async probeProvider(): Promise<void> {
    const baseUrl = this.form().baseUrl.trim();
    if (baseUrl === '') {
      this.probeStatus.set('');
      return;
    }
    this.probeStatus.set(`Checking ${baseUrl}…`);
    let models: readonly ProbedModel[];
    try {
      models = await probeProviderModels(baseUrl);
    } catch {
      this.probeStatus.set(
        `Could not read ${baseUrl}/v1/models (offline or blocked by CORS). Set context window / reasoning format manually.`,
      );
      return;
    }
    if (models.length === 0) {
      this.probeStatus.set('Provider reported no models.');
      return;
    }
    const modelId = this.form().modelId.trim();
    const match =
      modelId !== ''
        ? models.find((model) => model.id === modelId)
        : models.length === 1
          ? models[0]
          : undefined;
    if (match === undefined) {
      this.probeStatus.set(
        `${models.length} models reported; set Model ID to auto-fill context window / reasoning format.`,
      );
      return;
    }
    const patch: { contextWindowTokens?: string; reasoningFormat?: string } =
      {};
    const detected: string[] = [];
    if (
      typeof match.context_length === 'number' &&
      Number.isFinite(match.context_length) &&
      match.context_length > 0
    ) {
      patch.contextWindowTokens = String(match.context_length);
      detected.push(`context ${match.context_length}`);
    }
    const format =
      typeof match.thinking_format === 'string'
        ? match.thinking_format.trim()
        : '';
    if (format !== '') {
      patch.reasoningFormat = format;
      detected.push(`reasoning format "${format}"`);
    }
    if (detected.length === 0) {
      this.probeStatus.set(
        `Found ${match.id}, but it reports no context window or reasoning format.`,
      );
      return;
    }
    this.form.update((current) => ({ ...current, ...patch }));
    this.probeStatus.set(`Detected from ${match.id}: ${detected.join(', ')}.`);
  }

  protected updateProtocol(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'responses' || value === 'chat_completions') {
      this.form.update((current) => {
        const oauthSelection =
          current.credentialMode === 'create_openai_oauth' ||
          (current.credentialMode === 'reuse' &&
            this.admin
              .serviceCredentials()
              .some(
                (credential) =>
                  credential.credentialId === current.credentialId &&
                  credential.credentialKind === 'openai_oauth',
              ));
        const clearOauthSelection =
          value === 'chat_completions' && oauthSelection;
        return {
          ...current,
          protocol: value,
          responsesDialect: '',
          promptCaching: 'disabled',
          ...(clearOauthSelection
            ? {
                credentialMode: 'unconfigured' as const,
                credentialId: '',
                credentialDisplayName: '',
                oauthCallbackUrl: '',
              }
            : {}),
        };
      });
    }
  }

  protected updateProviderKind(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const providerKind = PROVIDER_KIND_OPTIONS.find(
      (option) => option.value === value,
    )?.value;
    if (providerKind !== undefined) {
      this.form.update((current) => ({ ...current, providerKind }));
    }
  }

  protected updateResponsesDialect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isResponsesProviderDialect(value)) return;
    this.form.update((current) => ({
      ...current,
      responsesDialect: value,
    }));
  }

  protected updateChatCompletionsDialect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isChatCompletionsDialect(value)) return;
    this.form.update((current) => ({
      ...current,
      chatCompletionsDialect: value,
    }));
  }

  protected updatePromptCaching(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isPromptCaching(value)) return;
    this.form.update((current) => ({ ...current, promptCaching: value }));
  }

  protected updateThinkingMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isThinkingMode(value)) return;
    this.form.update((current) => ({
      ...current,
      thinkingMode: value,
    }));
  }

  protected updateReasoningHistory(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isReasoningHistory(value)) return;
    this.form.update((current) => ({ ...current, reasoningHistory: value }));
  }

  protected clearIncompatibleReasoningSettings(): void {
    this.form.update((current) => {
      if (current.protocol !== 'chat_completions') return current;
      if (current.chatCompletionsDialect === 'standard') {
        return {
          ...current,
          thinkingMode: 'provider_default',
          reasoningHistory: 'provider_default',
          reasoningBudgetTokens: '',
        };
      }
      return {
        ...current,
        ...(current.reasoningHistory === 'tool_calls_only' &&
        current.chatCompletionsDialect !== 'deepseek'
          ? { reasoningHistory: 'provider_default' as const }
          : {}),
        ...(current.thinkingMode === 'disabled' &&
        current.reasoningHistory !== 'provider_default'
          ? { reasoningHistory: 'provider_default' as const }
          : {}),
        ...(current.reasoningBudgetTokens.trim() !== '' &&
        (current.chatCompletionsDialect !== 'qwen' ||
          current.thinkingMode !== 'enabled')
          ? { reasoningBudgetTokens: '' }
          : {}),
      };
    });
  }

  protected reasoningHistoryDisabled(
    option: ChatCompletionsReasoningHistory,
  ): boolean {
    const form = this.form();
    if (form.chatCompletionsDialect === 'standard') {
      return option !== 'provider_default';
    }
    if (form.thinkingMode === 'disabled') {
      return option !== 'provider_default';
    }
    return (
      option === 'tool_calls_only' && form.chatCompletionsDialect !== 'deepseek'
    );
  }

  protected updateStatus(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'active' || value === 'disabled' || value === 'archived') {
      this.form.update((current) => ({ ...current, status: value }));
    }
  }

  protected updateCredentialMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const reusedCredentialId = value.startsWith('reuse:')
      ? value.slice('reuse:'.length)
      : '';
    const mode: ProviderCredentialMode | null =
      reusedCredentialId !== ''
        ? 'reuse'
        : value === 'unconfigured' ||
            value === 'create_api_key' ||
            value === 'create_openai_oauth'
          ? value
          : null;
    if (mode === null) return;
    this.form.update((current) =>
      mode === 'create_openai_oauth'
        ? {
            ...current,
            credentialMode: mode,
            credentialId:
              current.credentialId || suggestedCredentialId(current.alias),
            credentialDisplayName:
              current.credentialDisplayName ||
              current.displayName ||
              current.alias,
            protocol: 'responses',
            responsesDialect: '',
            providerKind:
              current.providerKind.trim() === 'custom'
                ? 'openai'
                : current.providerKind,
            baseUrl:
              current.baseUrl.trim() === ''
                ? 'https://chatgpt.com/backend-api/codex'
                : current.baseUrl,
            secret: '',
          }
        : {
            ...current,
            credentialMode: mode,
            credentialId:
              mode === 'reuse'
                ? reusedCredentialId
                : mode === 'create_api_key'
                  ? current.credentialId || suggestedCredentialId(current.alias)
                  : '',
            credentialDisplayName:
              mode === 'create_api_key'
                ? current.credentialDisplayName ||
                  current.displayName ||
                  current.alias
                : '',
            oauthCallbackUrl: '',
            secret: '',
          },
    );
    if (mode === 'reuse') {
      void this.loadSelectedCredential(reusedCredentialId);
    }
  }

  protected selectProviderForEdit(provider: ModelProviderRecord): void {
    const credentialMode: ProviderCredentialMode =
      provider.credentialId === undefined ? 'unconfigured' : 'reuse';
    this.editingAlias.set(provider.alias);
    this.form.set({
      alias: provider.alias,
      displayName: provider.displayName ?? '',
      description: provider.description ?? '',
      protocol: provider.protocol,
      providerKind: provider.providerKind,
      baseUrl: provider.baseUrl ?? '',
      modelId: provider.modelId,
      contextWindowTokens:
        provider.contextWindowTokens === undefined
          ? ''
          : String(provider.contextWindowTokens),
      maxOutputTokens:
        provider.maxOutputTokens === undefined
          ? ''
          : String(provider.maxOutputTokens),
      temperature:
        provider.temperatureMilli === undefined
          ? ''
          : milliToDecimal(provider.temperatureMilli),
      reasoningEffort: provider.reasoningEffort ?? '',
      reasoningFormat: provider.reasoningFormat ?? '',
      responsesDialect: provider.responsesDialect ?? '',
      promptCaching: provider.promptCaching ?? 'disabled',
      chatCompletionsDialect: provider.chatCompletionsDialect,
      thinkingMode: provider.thinkingMode,
      reasoningHistory: provider.reasoningHistory,
      reasoningBudgetTokens:
        provider.reasoningBudgetTokens === undefined
          ? ''
          : String(provider.reasoningBudgetTokens),
      credentialMode,
      credentialId: provider.credentialId ?? '',
      credentialDisplayName: '',
      secret: '',
      oauthCallbackUrl: '',
      status: provider.status,
    });
    if (provider.credentialId !== undefined) {
      void this.loadSelectedCredential(provider.credentialId);
    }
  }

  protected cancelEdit(): void {
    this.editingAlias.set(null);
    this.form.set(initialForm());
  }

  protected async saveProvider(): Promise<void> {
    const form = this.form();
    if (
      this.saveDisabled() ||
      !isCredentialSelectionCompatible(form, this.admin.serviceCredentials())
    ) {
      return;
    }
    const request = buildWriteRequest(form);
    let result: ModelProviderWriteResponse | undefined;
    if (this.editingAlias() !== null) {
      result = await this.admin.updateModelProvider(
        this.editingAlias() as string,
        request,
      );
    } else {
      result = await this.admin.createModelProvider(request);
    }
    if (result === undefined) return;
    const alias = result.provider.alias;
    let credential = selectedReusableCredential(
      form,
      this.admin.serviceCredentials(),
    );
    if (
      form.credentialMode === 'create_api_key' ||
      form.credentialMode === 'create_openai_oauth'
    ) {
      const credentialId =
        form.credentialId.trim() || suggestedCredentialId(alias);
      credential = await this.admin.createServiceCredential({
        credentialId,
        displayName:
          form.credentialDisplayName.trim() || form.displayName.trim() || alias,
        providerKind: form.providerKind,
        credentialKind:
          form.credentialMode === 'create_openai_oauth'
            ? 'openai_oauth'
            : 'api_key',
        ...(form.credentialMode === 'create_api_key' &&
        form.secret.trim() !== ''
          ? { secret: form.secret.trim() }
          : {}),
      });
    }
    if (form.credentialMode === 'unconfigured') {
      if (result.provider.credentialId !== undefined) {
        await this.admin.unlinkModelProviderCredential(result.provider);
      }
    } else if (credential !== undefined) {
      const linked = await this.admin.linkModelProviderCredential(
        alias,
        credential,
      );
      if (linked === undefined) return;
      this.form.update((current) => ({
        ...current,
        credentialMode: 'reuse',
        credentialId: credential?.credentialId ?? '',
        secret: '',
      }));
      await this.loadSelectedCredential(credential.credentialId);
    }
    this.editingAlias.set(alias);
    this.refreshView();
  }

  protected oauthStateLabel(): string {
    switch (this.oauthCredentialState()) {
      case 'checking':
        return 'Checking this shared credential on the current Crew service…';
      case 'configured':
        return 'OAuth is configured for this shared credential.';
      case 'pending':
        return 'OAuth login is pending for this shared credential. Complete it with the callback URL.';
      case 'unconfigured':
        return 'OAuth is unconfigured for this shared credential. Start and complete OAuth before using linked aliases.';
    }
  }

  protected credentialLabel(provider: ModelProviderRecord): string {
    return credentialLabel(provider);
  }

  protected credentialKindLabel(provider: ModelProviderRecord): string {
    return (
      provider.credential.kind ??
      (provider.credential.hasSecret
        ? 'configured-kind-unknown'
        : 'unconfigured')
    );
  }

  protected credentialUpdatedLabel(provider: ModelProviderRecord): string {
    return provider.credential.updatedAt ?? 'not updated';
  }

  protected providerRefreshNeedsAttention(
    result: ModelProviderWriteResponse,
  ): boolean {
    return result.refresh.outcomes.some(
      (outcome) => outcome.status === 'blocked' || outcome.status === 'failed',
    );
  }

  protected providerRefreshSummary(result: ModelProviderWriteResponse): string {
    if (this.providerRefreshNeedsAttention(result)) {
      return 'Provider saved; automatic Profile rebuild incomplete';
    }
    if (result.refresh.affectedProfiles.length === 0) {
      return 'Provider saved; no Profile rebuild required';
    }
    return 'Provider saved; affected Profiles rebuilt';
  }

  protected oauthPendingLogin(): OpenAiOauthPendingLogin | null {
    const credentialId = this.form().credentialId;
    const started =
      this.admin.serviceCredentialOauthStartResult()?.pendingLogin;
    if (started?.credentialId === credentialId) return started;
    return this.selectedOauthStatus()?.pendingLogins[0] ?? null;
  }

  protected startOpenAiOauthLogin(): void {
    const credentialId = this.form().credentialId;
    if (credentialId === '') return;
    void this.admin
      .startServiceCredentialOpenAiOauthLogin(credentialId, {
        originator: 'rusty_view',
      })
      .then(() => {
        const authorizationUrl =
          this.admin.serviceCredentialOauthStartResult()?.pendingLogin
            .authorizationUrl;
        if (
          authorizationUrl !== undefined &&
          typeof globalThis.open === 'function'
        ) {
          try {
            globalThis.open(authorizationUrl, '_blank', 'noopener');
          } catch {
            // Some test DOMs expose window.open but throw a not-implemented error.
          }
        }
        this.refreshView();
      });
  }

  protected completeOpenAiOauthLogin(): void {
    const credentialId = this.form().credentialId;
    const callbackUrl = this.form().oauthCallbackUrl.trim();
    if (credentialId === '' || callbackUrl === '') return;
    void this.admin
      .completeServiceCredentialOpenAiOauthLogin(credentialId, {
        callbackUrl,
      })
      .then(() => this.refreshView());
  }

  protected unlinkSelectedCredential(): void {
    const alias = this.editingAlias();
    const provider = this.admin
      .providerAliases()
      .find((candidate) => candidate.alias === alias);
    if (provider === undefined || provider.credentialId === undefined) return;
    void this.admin.unlinkModelProviderCredential(provider).then((result) => {
      if (result === undefined) return;
      this.form.update((current) => ({
        ...current,
        credentialMode: 'unconfigured',
      }));
      this.refreshView();
    });
  }

  protected clearSelectedCredential(): void {
    const credential = this.selectedCredential();
    if (credential === null) return;
    void (
      credential.credentialKind === 'openai_oauth'
        ? this.admin.clearServiceCredentialOpenAiOauth(credential)
        : this.admin.clearServiceCredential(credential)
    ).then(() => this.refreshView());
  }

  protected deleteSelectedCredential(): void {
    const credential = this.selectedCredential();
    if (credential === null) return;
    void this.admin.deleteServiceCredential(credential).then((result) => {
      if (result === undefined) return;
      this.form.update((current) => ({
        ...current,
        credentialMode: 'unconfigured',
        credentialId: '',
      }));
      this.refreshView();
    });
  }

  private async loadSelectedCredential(credentialId: string): Promise<void> {
    await this.admin.loadServiceCredentialImpact(credentialId);
    const credential = this.admin
      .serviceCredentials()
      .find((candidate) => candidate.credentialId === credentialId);
    if (credential?.credentialKind === 'openai_oauth') {
      await this.admin.loadServiceCredentialOpenAiOauthStatus(credentialId);
    }
    this.refreshView();
  }

  private refreshView(): void {
    if (!this.destroyRef.destroyed) this.changeDetector.detectChanges();
  }
}

function buildWriteRequest(form: ProviderFormState): ModelProviderWriteRequest {
  if (!isSupportedProviderKind(form.providerKind)) {
    throw new Error(
      `unsupported legacy provider kind ${form.providerKind}; select a supported value`,
    );
  }
  const request: ModelProviderWriteRequest = {
    protocol: form.protocol,
    modelId: form.modelId.trim(),
    status: form.status,
    providerKind: form.providerKind,
    ...optionalStringField('alias', form.alias),
    ...optionalStringField('displayName', form.displayName),
    ...optionalStringField('description', form.description),
    ...optionalStringField('baseUrl', form.baseUrl),
    ...optionalStringField('reasoningEffort', form.reasoningEffort),
    ...optionalNumberField('contextWindowTokens', form.contextWindowTokens),
    ...optionalNumberField('maxOutputTokens', form.maxOutputTokens),
    ...optionalTemperatureMilli(form.temperature),
    promptCaching: form.promptCaching,
    ...(form.protocol === 'chat_completions'
      ? {
          chatCompletionsDialect: form.chatCompletionsDialect,
          thinkingMode: form.thinkingMode,
          reasoningHistory: form.reasoningHistory,
          ...optionalNumberField(
            'reasoningBudgetTokens',
            form.reasoningBudgetTokens,
          ),
        }
      : form.responsesDialect === ''
        ? {}
        : { responsesDialect: form.responsesDialect }),
  };
  // NOTE: `expectedRevision` is intentionally omitted (task #3722). Crew
  // overwrites the current record when it is absent, so normal edits succeed
  // even after the record advanced elsewhere. Reintroduce it only behind an
  // explicit compare-and-swap/advanced edit mode.
  return request;
}

function isChatCompletionsDialect(
  value: string,
): value is ChatCompletionsDialect {
  return CHAT_COMPLETIONS_DIALECTS.some((candidate) => candidate === value);
}

function isPromptCaching(value: string): value is ChatCompletionsPromptCaching {
  return PROMPT_CACHING_OPTIONS.some((candidate) => candidate.value === value);
}

function isResponsesProviderDialect(
  value: string,
): value is ResponsesProviderDialect {
  return RESPONSES_DIALECT_OPTIONS.some(
    (candidate) => candidate.value === value,
  );
}

function isThinkingMode(value: string): value is ChatCompletionsThinkingMode {
  return THINKING_MODES.some((candidate) => candidate === value);
}

function isReasoningHistory(
  value: string,
): value is ChatCompletionsReasoningHistory {
  return REASONING_HISTORY_OPTIONS.some((candidate) => candidate === value);
}

function reasoningConfigurationIssues(
  form: ProviderFormState,
): readonly string[] {
  if (form.protocol !== 'chat_completions') return [];
  const issues: string[] = [];
  const hasBudget = form.reasoningBudgetTokens.trim() !== '';

  if (form.chatCompletionsDialect === 'standard') {
    if (form.thinkingMode !== 'provider_default') {
      issues.push('The standard dialect requires provider-default thinking.');
    }
    if (form.reasoningHistory !== 'provider_default') {
      issues.push('The standard dialect requires provider-default history.');
    }
    if (hasBudget) {
      issues.push('The standard dialect does not support a reasoning budget.');
    }
    return issues;
  }

  if (
    form.reasoningHistory === 'tool_calls_only' &&
    form.chatCompletionsDialect !== 'deepseek'
  ) {
    issues.push('Tool-call-only history requires the DeepSeek dialect.');
  }
  if (
    form.thinkingMode === 'disabled' &&
    form.reasoningHistory !== 'provider_default'
  ) {
    issues.push('Disabled thinking requires provider-default history.');
  }
  if (hasBudget && form.chatCompletionsDialect !== 'qwen') {
    issues.push('A reasoning budget requires the Qwen dialect.');
  }
  if (hasBudget && form.thinkingMode !== 'enabled') {
    issues.push('A reasoning budget requires enabled thinking.');
  }
  return issues;
}

function optionalStringField<TKey extends string>(
  key: TKey,
  value: string,
): Record<TKey, string> | Record<string, never> {
  const trimmed = value.trim();
  return trimmed === '' ? {} : ({ [key]: trimmed } as Record<TKey, string>);
}

function optionalNumberField<TKey extends string>(
  key: TKey,
  value: string,
): Record<TKey, number> | Record<string, never> {
  const trimmed = value.trim();
  if (trimmed === '') return {};
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return {};
  return { [key]: parsed } as Record<TKey, number>;
}

function credentialLabel(provider: ModelProviderRecord): string {
  const status =
    provider.credential.status ??
    (provider.credential.hasSecret ? 'configured' : 'missing');
  return status.replace('_', '-');
}

function suggestedCredentialId(alias: string): string {
  const trimmed = alias.trim();
  return trimmed === '' ? '' : `provider:${trimmed}`;
}

function selectedReusableCredential(
  form: ProviderFormState,
  credentials: readonly ServiceCredentialRecord[],
): ServiceCredentialRecord | undefined {
  if (form.credentialMode !== 'reuse') return undefined;
  return credentials.find(
    (credential) => credential.credentialId === form.credentialId,
  );
}

/**
 * Convert a human-friendly decimal temperature (e.g. "0.7") to the backend's
 * integer milli units (700). Blank explicitly clears the backend override.
 */
function optionalTemperatureMilli(
  value: string,
): { temperatureMilli: number | null } | Record<string, never> {
  const trimmed = value.trim();
  if (trimmed === '') return { temperatureMilli: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return {};
  return { temperatureMilli: Math.round(parsed * 1000) };
}

/** Convert backend milli temperature (700) to a decimal string ("0.7"). */
function milliToDecimal(milli: number): string {
  return String(milli / 1000);
}

/**
 * One entry from a den-router-style `GET {baseUrl}/v1/models` payload. Only the
 * fields the probe consumes are modelled; `context_length`/`thinking_format`
 * mirror what den-router exposes per model.
 */
interface ProbedModel {
  readonly id: string;
  readonly context_length?: number;
  readonly thinking_format?: string;
}

/**
 * Best-effort fetch of a provider's model catalog (#3722 follow-up). Normalizes
 * the base URL the same way den-pi does (drop trailing slash and a trailing
 * `/v1`) before hitting `/v1/models`. Throws on network/HTTP failure so the
 * caller can degrade gracefully. No auth is sent — targets local/LAN proxies
 * like den-router that expose this openly.
 */
async function probeProviderModels(
  baseUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<readonly ProbedModel[]> {
  const normalized = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (normalized === '') return [];
  const response = await fetchImpl(`${normalized}/v1/models`);
  if (!response.ok) {
    throw new Error(`/v1/models returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: readonly ProbedModel[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

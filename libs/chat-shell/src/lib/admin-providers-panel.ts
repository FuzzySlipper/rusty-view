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
  ModelProviderProtocol,
  ModelProviderRecord,
  ModelProviderRefreshMode,
  ModelProviderStatus,
  ModelProviderWriteRequest,
  OpenAiOauthPendingLogin,
} from '@rusty-view/transport';

type ProviderCredentialMode = 'api_key' | 'openai_oauth';

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
  readonly reasoningFormat: string;
  readonly credentialMode: ProviderCredentialMode;
  readonly secret: string;
  readonly clearSecret: boolean;
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
    credentialMode: 'api_key',
    secret: '',
    clearSecret: false,
    oauthCallbackUrl: '',
    status: 'active',
  };
}

const REFRESH_MODES: readonly ModelProviderRefreshMode[] = [
  'none',
  'plan',
  'apply',
];

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

  readonly dismissed = output<void>();

  protected readonly refreshModes = REFRESH_MODES;
  protected readonly reasoningEffortOptions = REASONING_EFFORT_OPTIONS;
  protected readonly form = signal<ProviderFormState>(initialForm());
  protected readonly editingAlias = signal<string | null>(null);
  protected readonly refreshMode = signal<ModelProviderRefreshMode>('none');
  /** Status line for the most recent base-URL capability probe (#3722 follow-up). */
  protected readonly probeStatus = signal<string>('');
  protected readonly oauthCallbackReady = computed(
    () => this.form().oauthCallbackUrl.trim() !== '',
  );

  protected readonly saveDisabled = computed(() => {
    const form = this.form();
    if (this.admin.saving()) return true;
    // Create requires an alias and model id; edit uses the path alias.
    if (this.editingAlias() === null && form.alias.trim() === '') return true;
    return form.modelId.trim() === '';
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

  protected updateText(
    field: Exclude<
      keyof ProviderFormState,
      'protocol' | 'status' | 'credentialMode' | 'clearSecret'
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
      this.form.update((current) => ({ ...current, protocol: value }));
    }
  }

  protected updateStatus(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'active' || value === 'disabled' || value === 'archived') {
      this.form.update((current) => ({ ...current, status: value }));
    }
  }

  protected updateCredentialMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value !== 'api_key' && value !== 'openai_oauth') return;
    this.form.update((current) =>
      value === 'openai_oauth'
        ? {
            ...current,
            credentialMode: value,
            protocol: 'responses',
            providerKind:
              current.providerKind.trim() === 'custom'
                ? 'openai'
                : current.providerKind,
            baseUrl:
              current.baseUrl.trim() === ''
                ? 'https://chatgpt.com/backend-api/codex'
                : current.baseUrl,
            secret: '',
            clearSecret: false,
          }
        : { ...current, credentialMode: value, oauthCallbackUrl: '' },
    );
  }

  protected updateRefreshMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'none' || value === 'plan' || value === 'apply') {
      this.refreshMode.set(value);
    }
  }

  protected toggleClearSecret(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.update((current) => ({ ...current, clearSecret: checked }));
  }

  protected selectProviderForEdit(provider: ModelProviderRecord): void {
    const credentialMode =
      provider.credential.kind === 'openai_oauth' ? 'openai_oauth' : 'api_key';
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
      credentialMode,
      secret: '',
      clearSecret: false,
      oauthCallbackUrl: '',
      status: provider.status,
    });
    if (credentialMode === 'openai_oauth') {
      void this.admin.loadOpenAiOauthStatus(provider.alias);
    }
  }

  protected cancelEdit(): void {
    this.editingAlias.set(null);
    this.form.set(initialForm());
  }

  protected saveProvider(): void {
    const form = this.form();
    const request = buildWriteRequest(form);
    const refresh = this.refreshMode();
    if (this.editingAlias() !== null) {
      void this.admin.updateModelProvider(
        this.editingAlias() as string,
        request,
        refresh,
      );
    } else {
      void this.admin.createModelProvider(request, refresh);
    }
  }

  protected credentialLabel(provider: ModelProviderRecord): string {
    return credentialLabel(provider);
  }

  protected credentialKindLabel(provider: ModelProviderRecord): string {
    return provider.credential.kind ?? 'api_key';
  }

  protected credentialUpdatedLabel(provider: ModelProviderRecord): string {
    return provider.credential.updatedAt ?? 'not updated';
  }

  protected oauthPendingLogin(): OpenAiOauthPendingLogin | null {
    return (
      this.admin.openAiOauthStartResult()?.pendingLogin ??
      this.admin.openAiOauthStatus()?.pendingLogins[0] ??
      null
    );
  }

  protected startOpenAiOauthLogin(): void {
    const alias = this.editingAlias();
    if (alias === null) return;
    void this.admin
      .startOpenAiOauthLogin(alias, { originator: 'rusty_view' })
      .then(() => {
        const authorizationUrl =
          this.admin.openAiOauthStartResult()?.pendingLogin.authorizationUrl;
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
      });
  }

  protected completeOpenAiOauthLogin(): void {
    const alias = this.editingAlias();
    const callbackUrl = this.form().oauthCallbackUrl.trim();
    if (alias === null || callbackUrl === '') return;
    void this.admin.completeOpenAiOauthLogin(alias, {
      callbackUrl,
    });
  }

  protected clearOpenAiOauthCredential(provider?: ModelProviderRecord): void {
    const alias = provider?.alias ?? this.editingAlias();
    if (alias === null) return;
    void this.admin.clearOpenAiOauthCredential(alias);
  }
}

function buildWriteRequest(form: ProviderFormState): ModelProviderWriteRequest {
  const request: ModelProviderWriteRequest = {
    protocol: form.protocol,
    modelId: form.modelId.trim(),
    status: form.status,
    providerKind: form.providerKind.trim() || 'custom',
    ...optionalStringField('alias', form.alias),
    ...optionalStringField('displayName', form.displayName),
    ...optionalStringField('description', form.description),
    ...optionalStringField('baseUrl', form.baseUrl),
    ...optionalStringField('reasoningEffort', form.reasoningEffort),
    ...optionalStringField('reasoningFormat', form.reasoningFormat),
    ...optionalSecret(form),
    ...optionalNumberField('contextWindowTokens', form.contextWindowTokens),
    ...optionalNumberField('maxOutputTokens', form.maxOutputTokens),
    ...optionalTemperatureMilli(form.temperature),
    ...(form.credentialMode === 'api_key' && form.clearSecret
      ? { clearSecret: true }
      : {}),
  };
  // NOTE: `expectedRevision` is intentionally omitted (task #3722). Crew
  // overwrites the current record when it is absent, so normal edits succeed
  // even after the record advanced elsewhere. Reintroduce it only behind an
  // explicit compare-and-swap/advanced edit mode.
  return request;
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

function optionalSecret(
  form: ProviderFormState,
): { secret: string } | Record<string, never> {
  if (form.credentialMode !== 'api_key' || form.clearSecret) return {};
  const trimmed = form.secret.trim();
  return trimmed === '' ? {} : { secret: trimmed };
}

function credentialLabel(provider: ModelProviderRecord): string {
  const status =
    provider.credential.status ??
    (provider.credential.hasSecret ? 'configured' : 'missing');
  return status.replace('_', '-');
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

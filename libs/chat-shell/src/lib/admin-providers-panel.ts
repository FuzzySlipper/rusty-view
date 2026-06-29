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
} from '@rusty-view/transport';

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
  readonly temperatureMilli: string;
  readonly reasoningEffort: string;
  readonly reasoningFormat: string;
  readonly secret: string;
  readonly clearSecret: boolean;
  readonly status: ModelProviderStatus;
}

const INITIAL_FORM: ProviderFormState = {
  alias: '',
  displayName: '',
  description: '',
  protocol: 'chat_completions',
  providerKind: 'custom',
  baseUrl: '',
  modelId: '',
  contextWindowTokens: '',
  maxOutputTokens: '',
  temperatureMilli: '',
  reasoningEffort: '',
  reasoningFormat: '',
  secret: '',
  clearSecret: false,
  status: 'active',
};

const REFRESH_MODES: readonly ModelProviderRefreshMode[] = [
  'none',
  'plan',
  'apply',
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
  protected readonly form = signal<ProviderFormState>(INITIAL_FORM);
  protected readonly editingAlias = signal<string | null>(null);
  protected readonly refreshMode = signal<ModelProviderRefreshMode>('none');

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
      'protocol' | 'status' | 'clearSecret'
    >,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.update((current) => ({ ...current, [field]: value }));
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
      temperatureMilli:
        provider.temperatureMilli === undefined
          ? ''
          : String(provider.temperatureMilli),
      reasoningEffort: provider.reasoningEffort ?? '',
      reasoningFormat: provider.reasoningFormat ?? '',
      secret: '',
      clearSecret: false,
      status: provider.status,
    });
  }

  protected cancelEdit(): void {
    this.editingAlias.set(null);
    this.form.set(INITIAL_FORM);
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
    return provider.credential.hasSecret ? 'secret set' : 'no secret';
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
    ...optionalSecret(form.secret, form.clearSecret),
    ...optionalNumberField('contextWindowTokens', form.contextWindowTokens),
    ...optionalNumberField('maxOutputTokens', form.maxOutputTokens),
    ...optionalNumberField('temperatureMilli', form.temperatureMilli),
    ...(form.clearSecret ? { clearSecret: true } : {}),
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
  secret: string,
  clearSecret: boolean,
): { secret: string } | Record<string, never> {
  if (clearSecret) return {};
  const trimmed = secret.trim();
  return trimmed === '' ? {} : { secret: trimmed };
}

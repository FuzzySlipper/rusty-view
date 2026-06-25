import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import type { CreateAdminProfileRequest } from '@rusty-view/transport';

interface ProfileFormState {
  readonly profileId: string;
  readonly displayName: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly implementationId: string;
  readonly kind: 'full' | 'worker' | 'delegated';
  readonly provider: string;
  readonly modelName: string;
  readonly baseUrl: string;
  readonly mcpToolProfile: string;
}

const INITIAL_FORM: ProfileFormState = {
  profileId: '',
  displayName: '',
  agentId: '',
  sessionId: '',
  implementationId: '',
  kind: 'full',
  provider: 'local',
  modelName: 'deterministic',
  baseUrl: '',
  mcpToolProfile: '',
};

@Component({
  selector: 'rv-admin-profiles-panel',
  templateUrl: './admin-profiles-panel.html',
  styleUrl: './admin-profiles-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProfilesPanelComponent {
  protected readonly admin = inject(AdminStore);
  private readonly chatStore = inject(ChatStore);

  readonly dismissed = output<void>();

  protected readonly form = signal<ProfileFormState>(INITIAL_FORM);
  protected readonly createDisabled = computed(
    () =>
      this.admin.saving() ||
      this.form().profileId.trim() === '' ||
      this.form().provider.trim() === '' ||
      this.form().modelName.trim() === '',
  );

  constructor() {
    void this.admin.refresh();
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }

  protected refresh(): void {
    void this.admin.refresh();
    void this.chatStore.refreshSessions();
  }

  protected updateText(
    field: Exclude<keyof ProfileFormState, 'kind'>,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  protected updateKind(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'full' || value === 'worker' || value === 'delegated') {
      this.form.update((current) => ({ ...current, kind: value }));
    }
  }

  protected createProfile(): void {
    const request = buildCreateProfileRequest(this.form());
    void this.admin.createProfile(request).then(() => {
      if (this.admin.error() === null) {
        this.form.set(INITIAL_FORM);
        void this.chatStore.refreshSessions();
      }
    });
  }
}

function buildCreateProfileRequest(
  form: ProfileFormState,
): CreateAdminProfileRequest {
  const request: CreateAdminProfileRequest = {
    profileId: form.profileId.trim(),
    kind: form.kind,
    modelConfig: {
      provider: form.provider.trim(),
      modelName: form.modelName.trim(),
      ...(form.baseUrl.trim() === '' ? {} : { baseUrl: form.baseUrl.trim() }),
    },
    reason: 'created from rusty-view profiles panel',
    ...optionalString('displayName', form.displayName),
    ...optionalString('agentId', form.agentId),
    ...optionalString('sessionId', form.sessionId),
    ...optionalString('implementationId', form.implementationId),
    ...optionalString('mcpToolProfile', form.mcpToolProfile),
  };
  return request;
}

function optionalString<TKey extends string>(
  key: TKey,
  value: string,
): Record<TKey, string> | Record<string, never> {
  const trimmed = value.trim();
  return trimmed === '' ? {} : ({ [key]: trimmed } as Record<TKey, string>);
}

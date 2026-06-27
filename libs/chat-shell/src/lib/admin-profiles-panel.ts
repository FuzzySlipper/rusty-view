import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import type {
  AdminProfileRegistryRecord,
  CreateAdminProfileRequest,
  ProfileBundleExportEntry,
} from '@rusty-view/transport';

interface ProfileFormState {
  readonly profileId: string;
  readonly displayName: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly implementationId: string;
  readonly kind: 'full' | 'worker' | 'delegated';
  readonly modelOverrideEnabled: boolean;
  readonly provider: string;
  readonly modelName: string;
  readonly baseUrl: string;
  readonly mcpToolProfile: string;
}

interface CreateProfileModelConfig {
  readonly provider: string;
  readonly modelName: string;
  readonly baseUrl?: string;
}

interface CapabilityRow {
  readonly label: string;
  readonly capabilityIds: readonly string[];
  readonly availableLabel?: string;
}

const INITIAL_FORM: ProfileFormState = {
  profileId: '',
  displayName: '',
  agentId: '',
  sessionId: '',
  implementationId: '',
  kind: 'full',
  modelOverrideEnabled: false,
  provider: '',
  modelName: '',
  baseUrl: '',
  mcpToolProfile: '',
};

const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  {
    label: 'Create profile',
    capabilityIds: ['admin.control.profiles.create'],
  },
  {
    label: 'Config reload',
    capabilityIds: ['admin.control.config.reload'],
  },
  {
    label: 'MCP reload',
    capabilityIds: ['admin.control.mcp.reload'],
  },
  {
    label: 'Profile file edits',
    capabilityIds: [
      'admin.control.profiles.read',
      'admin.control.profiles.update.plan',
      'admin.control.profiles.update.apply',
    ],
  },
  {
    label: 'Model/provider changes',
    capabilityIds: [
      'admin.control.profiles.update.plan',
      'admin.control.profiles.update.apply',
      'admin.control.sessions.rebuild_runtime.plan',
      'admin.control.sessions.rebuild_runtime.apply',
      'admin.control.profiles.rebuild_brain.plan',
      'admin.control.profiles.rebuild_brain.apply',
    ],
    availableLabel: 'guarded rebuild available',
  },
];

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

  protected readonly capabilityRows = CAPABILITY_ROWS;
  protected readonly form = signal<ProfileFormState>(INITIAL_FORM);
  protected readonly exportProfileId = signal<string | null>(null);
  protected readonly createDisabled = computed(() => {
    const form = this.form();
    if (this.admin.saving() || form.profileId.trim() === '') return true;
    // Provider/model are only required when the user explicitly opts into a
    // model override. The default create path omits modelConfig so the backend
    // applies official registry defaults (ADR 0019).
    if (
      form.modelOverrideEnabled &&
      (form.provider.trim() === '' || form.modelName.trim() === '')
    ) {
      return true;
    }
    return false;
  });
  protected readonly exportPlan = computed(() => this.admin.exportPlan());
  protected readonly exportPlanMatchesProfile = computed(
    () => this.exportPlan()?.profileId === this.exportProfileId(),
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

  protected requestExportPlan(profileId: string): void {
    this.exportProfileId.set(profileId);
    void this.admin.loadExportPlan(profileId);
  }

  protected closeExportPlan(): void {
    this.exportProfileId.set(null);
    this.admin.clearExportPlan();
  }

  protected isFileAssetEntry(entry: ProfileBundleExportEntry): boolean {
    return entry.source === 'file_asset';
  }

  protected isActiveDbStateEntry(entry: ProfileBundleExportEntry): boolean {
    return entry.source === 'registry_active_state';
  }

  protected sourceLabel(record: AdminProfileRegistryRecord): string {
    return record.source === 'registry' ? 'DB registry' : 'file fallback';
  }

  protected planSourceLabel(source: 'registry' | 'file_fallback'): string {
    return source === 'registry' ? 'DB registry' : 'file fallback';
  }

  protected updateText(
    field: Exclude<keyof ProfileFormState, 'kind' | 'modelOverrideEnabled'>,
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

  protected toggleModelOverride(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.update((current) => ({
      ...current,
      modelOverrideEnabled: checked,
    }));
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

  protected capabilityStatus(row: CapabilityRow): string {
    const states = row.capabilityIds.map((id) =>
      this.admin.controlCapabilityState(id),
    );
    if (states.every((state) => state === 'available')) {
      return row.availableLabel ?? 'available';
    }
    if (states.some((state) => state === 'unknown')) return 'checking';
    if (states.some((state) => state === 'available')) return 'partial';
    return 'backend API needed';
  }
}

function buildCreateProfileRequest(
  form: ProfileFormState,
): CreateAdminProfileRequest {
  const request: CreateAdminProfileRequest = {
    profileId: form.profileId.trim(),
    kind: form.kind,
    reason: 'created from rusty-view profiles panel',
    ...optionalString('displayName', form.displayName),
    ...optionalString('agentId', form.agentId),
    ...optionalString('sessionId', form.sessionId),
    ...optionalString('implementationId', form.implementationId),
    ...optionalString('mcpToolProfile', form.mcpToolProfile),
    ...buildModelConfig(form),
  };
  return request;
}

/**
 * Only include modelConfig when the user explicitly opts into a model
 * override. The default create path omits it so the backend applies official
 * registry defaults (ADR 0019).
 */
function buildModelConfig(
  form: ProfileFormState,
): { modelConfig: CreateProfileModelConfig } | Record<string, never> {
  if (!form.modelOverrideEnabled) return {};
  const provider = form.provider.trim();
  const modelName = form.modelName.trim();
  if (provider === '' || modelName === '') return {};
  const baseUrl = form.baseUrl.trim();
  return {
    modelConfig: {
      provider,
      modelName,
      ...(baseUrl === '' ? {} : { baseUrl }),
    },
  };
}

function optionalString<TKey extends string>(
  key: TKey,
  value: string,
): Record<TKey, string> | Record<string, never> {
  const trimmed = value.trim();
  return trimmed === '' ? {} : ({ [key]: trimmed } as Record<TKey, string>);
}

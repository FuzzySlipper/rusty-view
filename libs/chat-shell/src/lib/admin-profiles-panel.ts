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
  CreatedProfileRuntimeAction,
  CreateAdminProfileRequest,
  ProfileBundleExportEntry,
  ProfileRegistryDerivedRuntimeRef,
} from '@rusty-view/transport';

interface ProfileFormState {
  readonly profileId: string;
  readonly displayName: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly implementationId: string;
  /** '' means use the backend default session kind. */
  readonly kind: '' | 'full' | 'worker' | 'delegated';
  /**
   * Reference to a reusable model provider alias. Preferred over the inline
   * model override. '' means no alias; the backend then applies defaults.
   */
  readonly providerAlias: string;
  readonly mcpToolProfile: string;
}

/** A group of derived runtime refs sharing a `refKind`, for preview rendering. */
interface RuntimeRefGroup {
  readonly refKind: string;
  readonly label: string;
  readonly refs: readonly ProfileRegistryDerivedRuntimeRef[];
}

const RUNTIME_REF_KIND_ORDER: readonly string[] = [
  'brain',
  'session',
  'scheduled_job',
  'channel_binding',
  'mcp_binding',
  'profile_mcp_config',
];

function groupRuntimeRefs(
  refs: readonly ProfileRegistryDerivedRuntimeRef[],
): readonly RuntimeRefGroup[] {
  if (refs.length === 0) return [];
  const buckets = new Map<string, ProfileRegistryDerivedRuntimeRef[]>();
  for (const ref of refs) {
    const existing = buckets.get(ref.refKind);
    if (existing === undefined) {
      buckets.set(ref.refKind, [ref]);
    } else {
      existing.push(ref);
    }
  }
  const orderedKinds = [
    ...RUNTIME_REF_KIND_ORDER.filter((kind) => buckets.has(kind)),
    ...[...buckets.keys()]
      .filter((kind) => !RUNTIME_REF_KIND_ORDER.includes(kind))
      .sort(),
  ];
  return orderedKinds.map((refKind) => ({
    refKind,
    label: runtimeRefKindLabel(refKind),
    refs: buckets.get(refKind) ?? [],
  }));
}

function runtimeRefKindLabel(refKind: string): string {
  switch (refKind) {
    case 'brain':
      return 'Brains';
    case 'session':
      return 'Sessions';
    case 'scheduled_job':
      return 'Scheduled jobs';
    case 'channel_binding':
      return 'Channel bindings';
    case 'mcp_binding':
    case 'profile_mcp_config':
      return 'MCP bindings';
    default:
      return refKind;
  }
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
  kind: '',
  providerAlias: '',
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
  protected readonly createDisabled = computed(
    () => this.admin.saving() || this.form().profileId.trim() === '',
  );
  protected readonly exportPlan = computed(() => this.admin.exportPlan());
  protected readonly exportPlanMatchesProfile = computed(
    () => this.exportPlan()?.profileId === this.exportProfileId(),
  );

  /**
   * Derived runtime graph actions from the most recent create-profile call
   * (task #3407 planner output). Surfaced as a before/after preview of the
   * runtime graph that was created.
   */
  protected readonly createdRuntimeActions = computed<
    readonly CreatedProfileRuntimeAction[]
  >(
    () =>
      this.admin.createResult()?.outcome?.result?.derivedRuntimeActions ?? [],
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

  /**
   * Group a profile's derived runtime refs by `refKind` for the runtime-graph
   * preview. Returns groups in a stable order (brains, sessions, jobs,
   * channel bindings, MCP bindings, then any other kinds).
   */
  protected runtimeRefGroups(
    record: AdminProfileRegistryRecord,
  ): readonly RuntimeRefGroup[] {
    return groupRuntimeRefs(record.activeRuntimeRefs);
  }

  protected createdActionGroups(): readonly RuntimeRefGroup[] {
    const actions = this.createdRuntimeActions();
    const refs: ProfileRegistryDerivedRuntimeRef[] = actions.map((action) => ({
      refKind: action.refKind,
      refId: action.refId,
      status: 'planned',
      metadataJson: action.metadataJson ?? null,
    }));
    return groupRuntimeRefs(refs);
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
    if (
      value === '' ||
      value === 'full' ||
      value === 'worker' ||
      value === 'delegated'
    ) {
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
    reason: 'created from rusty-view profiles panel',
    ...optionalString('displayName', form.displayName),
    ...optionalString('agentId', form.agentId),
    ...optionalString('sessionId', form.sessionId),
    ...optionalString('implementationId', form.implementationId),
    ...optionalString('mcpToolProfile', form.mcpToolProfile),
    ...optionalString('providerAlias', form.providerAlias),
    ...optionalKind(form.kind),
  };
  return request;
}

/**
 * Only include kind when the user explicitly selects a session kind. The
 * default '' selection omits kind so the backend applies the official default
 * session kind (ADR 0019).
 */
function optionalKind(
  kind: '' | 'full' | 'worker' | 'delegated',
): { kind: 'full' | 'worker' | 'delegated' } | Record<string, never> {
  return kind === '' ? {} : { kind };
}

function optionalString<TKey extends string>(
  key: TKey,
  value: string,
): Record<TKey, string> | Record<string, never> {
  const trimmed = value.trim();
  return trimmed === '' ? {} : ({ [key]: trimmed } as Record<TKey, string>);
}

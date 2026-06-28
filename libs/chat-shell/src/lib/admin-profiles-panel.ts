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
  ProfileRegistryFieldUpdateRequest,
  ProfileRegistryLifecycleRequest,
  ProfileRegistryLifecycleStatus,
  ProfileRegistryPromptRequest,
  ProfileRegistryWritePlan,
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

/** Editable registry-owned fields for an existing profile (#3519). */
interface RegistryEditFormState {
  readonly displayName: string;
  readonly summary: string;
  readonly ownerId: string;
  readonly agentId: string;
  /**
   * '' keeps the current value; '__clear__' sends null to clear it back to the
   * backend default; otherwise an explicit full/worker/delegated selection.
   */
  readonly defaultSessionKind:
    | ''
    | '__clear__'
    | 'full'
    | 'worker'
    | 'delegated';
}

const INITIAL_REGISTRY_EDIT: RegistryEditFormState = {
  displayName: '',
  summary: '',
  ownerId: '',
  agentId: '',
  defaultSessionKind: '',
};

/**
 * Draft state for the prompt viewer/editor (#3555). Per-field semantics:
 * - `undefined`: keep current (field is omitted from the request).
 * - `null`: explicit clear (sends `null` to the backend).
 * - `string` (including `''`): set to this markdown value.
 *
 * Empty strings are valid markdown content; they are only sent when the
 * operator has explicitly edited the textarea (i.e. the field has been
 * transitioned from `undefined` to `''`).
 */
interface PromptEditFormState {
  readonly soulMarkdown: string | null | undefined;
  readonly memoryMarkdown: string | null | undefined;
}

const INITIAL_PROMPT_EDIT: PromptEditFormState = {
  soulMarkdown: undefined,
  memoryMarkdown: undefined,
};

const LIFECYCLE_STATUSES: readonly ProfileRegistryLifecycleStatus[] = [
  'active',
  'paused',
  'decommissioned',
  'archived',
];

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
  protected readonly lifecycleStatuses = LIFECYCLE_STATUSES;
  protected readonly form = signal<ProfileFormState>(INITIAL_FORM);
  protected readonly exportProfileId = signal<string | null>(null);
  protected readonly editingRegistryProfileId = signal<string | null>(null);
  protected readonly registryEditForm = signal<RegistryEditFormState>(
    INITIAL_REGISTRY_EDIT,
  );
  protected readonly promptEditProfileId = signal<string | null>(null);
  protected readonly promptEditForm =
    signal<PromptEditFormState>(INITIAL_PROMPT_EDIT);
  protected readonly lifecycleTargetProfileId = signal<string | null>(null);
  protected readonly lifecycleTargetStatus =
    signal<ProfileRegistryLifecycleStatus>('paused');
  protected readonly createDisabled = computed(
    () => this.admin.saving() || this.form().profileId.trim() === '',
  );
  protected readonly exportPlan = computed(() => this.admin.exportPlan());
  protected readonly exportPlanMatchesProfile = computed(
    () => this.exportPlan()?.profileId === this.exportProfileId(),
  );
  /** The active registry write plan, scoped to the profile being edited. */
  protected readonly registryWritePlan =
    computed<ProfileRegistryWritePlan | null>(() => {
      const plan = this.admin.registryWritePlan();
      return plan?.profileId === this.editingRegistryProfileId() ||
        plan?.profileId === this.lifecycleTargetProfileId() ||
        plan?.profileId === this.promptEditProfileId()
        ? plan
        : null;
    });

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

  /** Open the registry-field edit form for a profile, seeded from its record. */
  protected startRegistryEdit(record: AdminProfileRegistryRecord): void {
    this.lifecycleTargetProfileId.set(null);
    this.admin.clearRegistryWrite();
    this.editingRegistryProfileId.set(record.profileId);
    this.registryEditForm.set({
      displayName: record.displayName ?? '',
      summary: record.summary ?? '',
      ownerId: record.ownerId ?? '',
      agentId: record.agentId ?? '',
      defaultSessionKind:
        record.defaultSessionKind === 'full' ||
        record.defaultSessionKind === 'worker' ||
        record.defaultSessionKind === 'delegated'
          ? record.defaultSessionKind
          : '',
    });
  }

  protected cancelRegistryEdit(): void {
    this.editingRegistryProfileId.set(null);
    this.registryEditForm.set(INITIAL_REGISTRY_EDIT);
    this.admin.clearRegistryWrite();
  }

  protected updateRegistryEditText(
    field: Exclude<keyof RegistryEditFormState, 'defaultSessionKind'>,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.registryEditForm.update((current) => ({ ...current, [field]: value }));
  }

  protected updateRegistryEditKind(event: Event): void {
    const value = (event.target as HTMLSelectElement)
      .value as RegistryEditFormState['defaultSessionKind'];
    if (
      value === '' ||
      value === '__clear__' ||
      value === 'full' ||
      value === 'worker' ||
      value === 'delegated'
    ) {
      this.registryEditForm.update((current) => ({
        ...current,
        defaultSessionKind: value,
      }));
    }
  }

  /**
   * Build the update request from the edit form. Omitted fields keep their
   * current value; the backend treats `null` as a clear, so empty strings are
   * only sent as clears for fields the operator explicitly blanked.
   */
  protected buildRegistryUpdateRequest(
    record: AdminProfileRegistryRecord,
  ): ProfileRegistryFieldUpdateRequest {
    const form = this.registryEditForm();
    const request: ProfileRegistryFieldUpdateRequest = {
      expectedRevision: record.revision ?? 0,
      ...registryFieldEntry(
        'displayName',
        form.displayName,
        record.displayName,
      ),
      ...registryFieldEntry('summary', form.summary, record.summary),
      ...registryFieldEntry('ownerId', form.ownerId, record.ownerId),
      ...registryFieldEntry('agentId', form.agentId, record.agentId),
      ...(form.defaultSessionKind === ''
        ? {}
        : form.defaultSessionKind === '__clear__'
          ? { defaultSessionKind: null }
          : { defaultSessionKind: form.defaultSessionKind }),
    };
    return request;
  }

  protected planRegistryUpdate(record: AdminProfileRegistryRecord): void {
    void this.admin.planRegistryUpdate(
      record.profileId,
      this.buildRegistryUpdateRequest(record),
    );
  }

  protected applyRegistryUpdate(record: AdminProfileRegistryRecord): void {
    void this.admin.applyRegistryUpdate(
      record.profileId,
      this.buildRegistryUpdateRequest(record),
    );
  }

  /** Open the lifecycle transition control for a profile. */
  protected startLifecycleTransition(record: AdminProfileRegistryRecord): void {
    this.editingRegistryProfileId.set(null);
    this.admin.clearRegistryWrite();
    this.lifecycleTargetProfileId.set(record.profileId);
    this.lifecycleTargetStatus.set(
      record.lifecycleStatus === 'active'
        ? 'paused'
        : ((record.lifecycleStatus as ProfileRegistryLifecycleStatus) ??
            'paused'),
    );
  }

  protected cancelLifecycleTransition(): void {
    this.lifecycleTargetProfileId.set(null);
    this.admin.clearRegistryWrite();
  }

  protected updateLifecycleTarget(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (
      value === 'active' ||
      value === 'paused' ||
      value === 'decommissioned' ||
      value === 'archived'
    ) {
      this.lifecycleTargetStatus.set(value);
    }
  }

  protected buildLifecycleRequest(
    record: AdminProfileRegistryRecord,
  ): ProfileRegistryLifecycleRequest {
    return {
      expectedRevision: record.revision ?? 0,
      lifecycleStatus: this.lifecycleTargetStatus(),
    };
  }

  protected planLifecycleTransition(record: AdminProfileRegistryRecord): void {
    void this.admin.planRegistryLifecycle(
      record.profileId,
      this.buildLifecycleRequest(record),
    );
  }

  protected applyLifecycleTransition(record: AdminProfileRegistryRecord): void {
    void this.admin.applyRegistryLifecycle(
      record.profileId,
      this.buildLifecycleRequest(record),
    );
  }

  /** Whether a registry record can be edited (registry-backed only). */
  protected isRegistryEditable(record: AdminProfileRegistryRecord): boolean {
    return record.source === 'registry';
  }

  /** The registry record currently being field-edited, or undefined. */
  protected registryEditRecord(): AdminProfileRegistryRecord | undefined {
    const profileId = this.editingRegistryProfileId();
    if (profileId === null) return undefined;
    return this.admin
      .registryRecords()
      .find((record) => record.profileId === profileId);
  }

  /** The registry record currently targeted for a lifecycle transition. */
  protected lifecycleEditRecord(): AdminProfileRegistryRecord | undefined {
    const profileId = this.lifecycleTargetProfileId();
    if (profileId === null) return undefined;
    return this.admin
      .registryRecords()
      .find((record) => record.profileId === profileId);
  }

  /** The registry record currently being prompt-edited, or undefined. */
  protected promptEditRecord(): AdminProfileRegistryRecord | undefined {
    const profileId = this.promptEditProfileId();
    if (profileId === null) return undefined;
    return this.admin
      .registryRecords()
      .find((record) => record.profileId === profileId);
  }

  /**
   * Text shown in the soul textarea. When the draft is `undefined` (untouched)
   * it shows the current DB value; after an explicit clear it surfaces a
   * placeholder so the operator sees the pending state.
   */
  protected promptEditSoulValue(): string {
    const draft = this.promptEditForm().soulMarkdown;
    if (draft === undefined) {
      const current = this.promptEditRecord()?.promptSoulMarkdown;
      return current ?? '';
    }
    if (draft === null) return '';
    return draft;
  }

  protected promptEditMemoryValue(): string {
    const draft = this.promptEditForm().memoryMarkdown;
    if (draft === undefined) {
      const current = this.promptEditRecord()?.promptMemoryMarkdown;
      return current ?? '';
    }
    if (draft === null) return '';
    return draft;
  }

  /** `true` when soul is pending a clear (will send `null`). */
  protected promptEditSoulCleared(): boolean {
    return this.promptEditForm().soulMarkdown === null;
  }

  protected promptEditMemoryCleared(): boolean {
    return this.promptEditForm().memoryMarkdown === null;
  }

  /** `true` when the operator has made any change (edit or clear). */
  protected promptEditDirty(): boolean {
    const form = this.promptEditForm();
    return form.soulMarkdown !== undefined || form.memoryMarkdown !== undefined;
  }

  /** Open the prompt editor for a registry-backed profile. */
  protected startPromptEdit(record: AdminProfileRegistryRecord): void {
    this.editingRegistryProfileId.set(null);
    this.lifecycleTargetProfileId.set(null);
    this.admin.clearRegistryWrite();
    this.promptEditProfileId.set(record.profileId);
    this.promptEditForm.set(INITIAL_PROMPT_EDIT);
  }

  /** Close the prompt editor without applying. */
  protected cancelPromptEdit(): void {
    this.promptEditProfileId.set(null);
    this.promptEditForm.set(INITIAL_PROMPT_EDIT);
    this.admin.clearRegistryWrite();
  }

  protected updatePromptEditSoul(event: Event): void {
    const value = (event.target as HTMLTextAreaElement | null)?.value ?? '';
    this.promptEditForm.update((current) => ({
      ...current,
      soulMarkdown: value,
    }));
  }

  protected updatePromptEditMemory(event: Event): void {
    const value = (event.target as HTMLTextAreaElement | null)?.value ?? '';
    this.promptEditForm.update((current) => ({
      ...current,
      memoryMarkdown: value,
    }));
  }

  /** Explicit clear of the soul prompt — sends `null` to the backend. */
  protected clearPromptEditSoul(): void {
    this.promptEditForm.update((current) => ({
      ...current,
      soulMarkdown: null,
    }));
  }

  protected clearPromptEditMemory(): void {
    this.promptEditForm.update((current) => ({
      ...current,
      memoryMarkdown: null,
    }));
  }

  /** Revert a single prompt field to "keep current" (omit from request). */
  protected revertPromptEditSoul(): void {
    this.promptEditForm.update((current) => ({
      ...current,
      soulMarkdown: undefined,
    }));
  }

  protected revertPromptEditMemory(): void {
    this.promptEditForm.update((current) => ({
      ...current,
      memoryMarkdown: undefined,
    }));
  }

  /** Build the prompt plan/apply request from the current draft state. */
  protected buildPromptEditRequest(
    record: AdminProfileRegistryRecord,
  ): ProfileRegistryPromptRequest {
    const form = this.promptEditForm();
    const request: ProfileRegistryPromptRequest = {
      expectedRevision: record.revision ?? 0,
    };
    // Omit unchanged fields (`undefined`) entirely; include explicit clears as
    // `null` and explicit edits as their string (including empty string).
    if (form.soulMarkdown !== undefined) {
      (request as { soulMarkdown?: string | null }).soulMarkdown =
        form.soulMarkdown;
    }
    if (form.memoryMarkdown !== undefined) {
      (request as { memoryMarkdown?: string | null }).memoryMarkdown =
        form.memoryMarkdown;
    }
    return request;
  }

  protected planPromptEdit(record: AdminProfileRegistryRecord): void {
    void this.admin.planPromptEdit(
      record.profileId,
      this.buildPromptEditRequest(record),
    );
  }

  protected applyPromptEdit(record: AdminProfileRegistryRecord): void {
    void this.admin.applyPromptEdit(
      record.profileId,
      this.buildPromptEditRequest(record),
    );
  }

  /** Lifecycle reason shown when a file-backed profile can't be edited. */
  protected registryEditBlockReason(
    record: AdminProfileRegistryRecord,
  ): string {
    return record.source === 'registry'
      ? ''
      : 'Import this file-backed profile into the registry before editing registry-owned fields.';
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

  /**
   * Runtime-graph groups projected by the current registry write plan's `next`
   * record (e.g. which refs a lifecycle transition will disable). Empty when no
   * plan is loaded for the profile being edited.
   */
  protected plannedRuntimeRefGroups(): readonly RuntimeRefGroup[] {
    const next = this.registryWritePlan()?.next;
    if (next === undefined) return [];
    return groupRuntimeRefs(next.activeRuntimeRefs);
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

/**
 * Build a registry field entry for the update request. If the operator left
 * the field equal to the current record value, omit it (no change); if they
 * blanked it, send `null` to clear; otherwise send the new value.
 */
type RegistryNullableField = 'displayName' | 'summary' | 'ownerId' | 'agentId';

function registryFieldEntry(
  key: RegistryNullableField,
  formValue: string,
  currentValue: string | undefined,
): Partial<Record<RegistryNullableField, string | null>> {
  const trimmed = formValue.trim();
  if (trimmed === (currentValue ?? '')) return {};
  return { [key]: trimmed === '' ? null : trimmed };
}

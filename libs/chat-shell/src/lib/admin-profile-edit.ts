import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AdminStore,
  ChatStore,
  ExternalAgentStore,
} from '@rusty-view/chat-store';
import type {
  ExternalAgentBinding,
  ExternalMessageDeliveryPolicy,
} from '@rusty-view/protocol';
import type {
  AdminControlResponse,
  AdminLocalToolProfile,
  AdminMcpBinding,
  AdminMcpServer,
  AdminProfileMaterializedMcpBinding,
  AdminProfileRegistryRecord,
  AdminToolDescriptor,
  AdminToolsetDescriptor,
  ContextDebugVisibility,
  ContextStrategyDescriptor,
  ContextStrategyPolicy,
  CreateProfileMcpBinding,
  ModelConfigurationRecord,
  ProfileBundleExportEntry,
  ProfileDeleteResult,
  ProfileRegistryFieldUpdateRequest,
  ProfileRegistryLifecycleRequest,
  ProfileRegistryLifecycleStatus,
  ProfileRegistryPromptRequest,
  ProfileRegistryRuntimeConfigAppliedResult,
  ProfileRegistryRuntimeConfigPlan,
  ProfileRegistryRuntimeConfigRequest,
  ProfileRegistryWritePlan,
} from '@rusty-view/transport';

import {
  groupRuntimeRefs,
  type RuntimeRefGroup,
} from './admin-profile-runtime-refs';
import {
  localToolProfileLabel,
  mcpServerLabel,
  toolLabel,
  toolsetLabel,
  type McpBindingDraft,
} from './admin-profile-tool-selection';

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

const CONTEXT_DEBUG_VISIBILITIES: readonly ContextDebugVisibility[] = [
  'off',
  'status',
  'verbose',
];

type CapabilityStatus = 'available' | 'partial' | 'checking' | 'missing';

const PROFILE_DELETE_CAPABILITY_ID = 'admin.control.profiles.delete';
const PROFILE_DELETE_REASON = 'profile hard-deleted from Rusty View';

/**
 * Editable view of a {@link ContextStrategyPolicy} (task #3849). Mirrors the
 * wire policy minus `strategyConfig`, which the form preserves verbatim from the
 * seed source rather than editing.
 */
interface ContextPolicyDraft {
  readonly enabled: boolean;
  readonly strategyId: string;
  readonly autoCompactionEnabled: boolean;
  readonly compactAtPercent: number;
  readonly targetPercentAfterCompaction: number;
  readonly maxContextPercentForWake: number;
  readonly debugVisibility: ContextDebugVisibility;
  readonly includeDebugEventsInModelContext: boolean;
}

/** Local fallback used only when neither the record nor the catalog seed one. */
const FALLBACK_CONTEXT_POLICY: ContextPolicyDraft = {
  enabled: true,
  strategyId: '',
  autoCompactionEnabled: false,
  compactAtPercent: 80,
  targetPercentAfterCompaction: 55,
  maxContextPercentForWake: 95,
  debugVisibility: 'status',
  includeDebugEventsInModelContext: false,
};

/**
 * Edit Profile window (#3690). Extracted from the former monolithic profiles
 * panel; scoped to a single profile by {@link profileId}. Owns registry field
 * editing (#3519), lifecycle transitions (#3521), prompt editing (#3555), the
 * bundle export plan, and this profile's MCP binding resolution diagnostics
 * (#3649). Reads/writes the shared {@link AdminStore}; emits {@link closed}
 * when dismissed.
 */
@Component({
  selector: 'rv-admin-profile-edit',
  templateUrl: './admin-profile-edit.html',
  styleUrls: ['./admin-profile-shared.css', './admin-profile-edit.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProfileEditComponent {
  protected readonly admin = inject(AdminStore);
  private readonly chat = inject(ChatStore);
  private readonly external = inject(ExternalAgentStore, { optional: true });

  /** The profile this window edits. */
  readonly profileId = input.required<string>();
  /** Emitted when the operator closes the edit window. */
  readonly closed = output<void>();

  protected readonly lifecycleStatuses = LIFECYCLE_STATUSES;

  protected readonly registryEditForm = signal<RegistryEditFormState>(
    INITIAL_REGISTRY_EDIT,
  );
  protected readonly promptEditForm =
    signal<PromptEditFormState>(INITIAL_PROMPT_EDIT);
  protected readonly lifecycleTargetStatus =
    signal<ProfileRegistryLifecycleStatus>('paused');
  protected readonly deleteConfirmation = signal('');
  protected readonly deleteConfirmOpen = signal(false);
  /** Which sub-form is active in the edit window: registry fields by default. */
  protected readonly section = signal<
    'fields' | 'lifecycle' | 'prompts' | 'runtime'
  >('fields');

  // ---- runtime-config edit (provider / tools / MCP, #3742) ----------------

  /** Selected model configuration; '' keeps the profile's current model. */
  protected readonly runtimeModelConfigId = signal<string>('');
  /** Policy used for new managed external bindings for this profile. */
  protected readonly runtimeExternalMessageDeliveryPolicy =
    signal<ExternalMessageDeliveryPolicy>('immediate_steer');
  /** Selected reusable local tool profile id; '' = use inline toolsets/tools. */
  protected readonly runtimeLocalToolProfileId = signal<string>('');
  /** Draft selection shown only inside the explicit tool-profile operation. */
  protected readonly runtimeToolProfileDraftId = signal<string>('');
  /** Whether the explicit tool-profile operation is open. */
  protected readonly runtimeToolProfilePickerOpen = signal(false);
  /** Whether built-in tool state should be included in the runtime request. */
  protected readonly runtimeToolsDirty = signal(false);
  /** Whether the advanced inline "custom built-in tools" disclosure is open. */
  protected readonly runtimeCustomToolsOpen = signal(false);
  protected readonly runtimeToolsetSelections = signal<readonly string[]>([]);
  protected readonly runtimeToolSelections = signal<readonly string[]>([]);
  /** Draft MCP server bindings; serverId + optional toolProfileKey. */
  protected readonly runtimeMcpSelections = signal<readonly McpBindingDraft[]>(
    [],
  );
  /**
   * Whether the operator has touched the MCP bindings. MCP bindings are only
   * sent when dirty so an untouched edit preserves the profile's current
   * bindings (and any advanced fields the draft form does not model).
   */
  protected readonly runtimeMcpDirty = signal(false);
  /** Current full bindings, kept to merge advanced fields back on build. */
  private seededMcpBindings: readonly CreateProfileMcpBinding[] = [];

  // ---- context strategy policy (#3849) ----
  protected readonly debugVisibilities = CONTEXT_DEBUG_VISIBILITIES;
  protected readonly contextPolicyForm = signal<ContextPolicyDraft>(
    FALLBACK_CONTEXT_POLICY,
  );
  /**
   * Whether the operator touched the context policy. Only sent when dirty so an
   * untouched edit preserves the profile's current policy.
   */
  protected readonly runtimeContextDirty = signal(false);
  /** Opaque strategy config preserved verbatim from the seed source on build. */
  private seededStrategyConfig: Record<string, unknown> = {};

  /** The registry record being edited, resolved from the store by id. */
  protected readonly record = computed<AdminProfileRegistryRecord | undefined>(
    () =>
      this.admin
        .registryRecords()
        .find((entry) => entry.profileId === this.profileId()),
  );

  protected readonly exportPlan = computed(() => this.admin.exportPlan());
  protected readonly exportPlanMatchesProfile = computed(
    () => this.exportPlan()?.profileId === this.profileId(),
  );

  /** The active registry write plan, scoped to this profile. */
  protected readonly registryWritePlan =
    computed<ProfileRegistryWritePlan | null>(() => {
      const plan = this.admin.registryWritePlan();
      return plan?.profileId === this.profileId() ? plan : null;
    });

  /** The active runtime-config plan (#3742), scoped to this profile. */
  protected readonly runtimeConfigPlan =
    computed<ProfileRegistryRuntimeConfigPlan | null>(() => {
      const plan = this.admin.runtimeConfigPlan();
      return plan?.profileId === this.profileId() ? plan : null;
    });

  /** The applied runtime-config result (#3742), scoped to this profile. */
  protected readonly runtimeConfigResult =
    computed<ProfileRegistryRuntimeConfigAppliedResult | null>(() => {
      const result = this.admin.runtimeConfigResult();
      return result !== null &&
        'applied' in result &&
        result.profileId === this.profileId()
        ? result
        : null;
    });

  protected readonly profileDeleteResult =
    computed<AdminControlResponse<ProfileDeleteResult> | null>(() => {
      const result = this.admin.profileDeleteResult();
      if (result === null) return null;
      const target = result.command.target;
      const targetProfile =
        target['profile_id'] ?? target['profileId'] ?? target['profile'];
      const resultProfile = result.outcome.result?.profileId;
      return targetProfile === undefined ||
        targetProfile === this.profileId() ||
        resultProfile === this.profileId()
        ? result
        : null;
    });
  protected readonly deleteCapabilityStatus = computed<CapabilityStatus>(() =>
    this.capabilityStatusFor([PROFILE_DELETE_CAPABILITY_ID]),
  );
  protected readonly canDeleteProfile = computed(
    () =>
      this.admin.controlCapabilityState(PROFILE_DELETE_CAPABILITY_ID) ===
      'available',
  );
  protected readonly deleteConfirmed = computed(
    () => this.deleteConfirmation() === this.profileId(),
  );

  /** Seed the registry-fields form from the record once it resolves. */
  private seeded = false;

  constructor() {
    effect(() => {
      const record = this.record();
      if (record !== undefined && !this.seeded) {
        this.seeded = true;
        this.seedRegistryEdit(record);
      }
    });
  }

  protected close(): void {
    this.admin.clearRegistryWrite();
    this.closed.emit();
  }

  // ---- section switching --------------------------------------------------

  protected showSection(
    section: 'fields' | 'lifecycle' | 'prompts' | 'runtime',
  ): void {
    this.admin.clearRegistryWrite();
    this.closeDeleteConfirmationBox();
    this.section.set(section);
    const record = this.record();
    if (record === undefined) return;
    if (section === 'fields') {
      this.seedRegistryEdit(record);
    } else if (section === 'lifecycle') {
      this.lifecycleTargetStatus.set(
        record.lifecycleStatus === 'active'
          ? 'paused'
          : ((record.lifecycleStatus as ProfileRegistryLifecycleStatus) ??
              'paused'),
      );
    } else if (section === 'runtime') {
      this.seedRuntimeConfig(record);
    } else {
      this.promptEditForm.set(INITIAL_PROMPT_EDIT);
    }
  }

  // ---- registry field edit (#3519) ---------------------------------------

  private seedRegistryEdit(record: AdminProfileRegistryRecord): void {
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

  protected buildRegistryUpdateRequest(
    record: AdminProfileRegistryRecord,
  ): ProfileRegistryFieldUpdateRequest {
    const form = this.registryEditForm();
    return {
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

  // ---- lifecycle (#3521) --------------------------------------------------

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

  protected plannedRuntimeRefGroups(): readonly RuntimeRefGroup[] {
    const next = this.registryWritePlan()?.next;
    if (next === undefined) return [];
    return groupRuntimeRefs(next.activeRuntimeRefs);
  }

  /** Read-only derived runtime graph groups for the current record (overview). */
  protected runtimeRefGroups(): readonly RuntimeRefGroup[] {
    const record = this.record();
    if (record === undefined) return [];
    return groupRuntimeRefs(record.activeRuntimeRefs);
  }

  // ---- prompt edit (#3555) ------------------------------------------------

  protected promptEditSoulValue(): string {
    const draft = this.promptEditForm().soulMarkdown;
    if (draft === undefined) return this.record()?.promptSoulMarkdown ?? '';
    if (draft === null) return '';
    return draft;
  }

  protected promptEditMemoryValue(): string {
    const draft = this.promptEditForm().memoryMarkdown;
    if (draft === undefined) return this.record()?.promptMemoryMarkdown ?? '';
    if (draft === null) return '';
    return draft;
  }

  protected promptEditSoulCleared(): boolean {
    return this.promptEditForm().soulMarkdown === null;
  }

  protected promptEditMemoryCleared(): boolean {
    return this.promptEditForm().memoryMarkdown === null;
  }

  protected promptEditDirty(): boolean {
    const form = this.promptEditForm();
    return form.soulMarkdown !== undefined || form.memoryMarkdown !== undefined;
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

  protected buildPromptEditRequest(
    record: AdminProfileRegistryRecord,
  ): ProfileRegistryPromptRequest {
    const form = this.promptEditForm();
    const request: ProfileRegistryPromptRequest = {
      expectedRevision: record.revision ?? 0,
    };
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

  // ---- export plan --------------------------------------------------------

  protected requestExportPlan(): void {
    void this.admin.loadExportPlan(this.profileId());
  }

  protected closeExportPlan(): void {
    this.admin.clearExportPlan();
  }

  protected planSourceLabel(source: 'registry' | 'file_fallback'): string {
    return source === 'registry' ? 'DB registry' : 'file fallback';
  }

  protected isFileAssetEntry(entry: ProfileBundleExportEntry): boolean {
    return entry.source === 'file_asset';
  }

  protected isActiveDbStateEntry(entry: ProfileBundleExportEntry): boolean {
    return entry.source === 'registry_active_state';
  }

  // ---- runtime-config edit: provider / tools / MCP (#3742) ---------------

  /** Seed the runtime-config form from the record's current provider/tools/MCP. */
  private seedRuntimeConfig(record: AdminProfileRegistryRecord): void {
    this.runtimeModelConfigId.set(record.modelConfigId ?? '');
    this.runtimeExternalMessageDeliveryPolicy.set(
      record.externalMessageDeliveryPolicy ?? 'immediate_steer',
    );
    this.runtimeLocalToolProfileId.set(record.localToolProfileId ?? '');
    this.runtimeToolProfileDraftId.set(record.localToolProfileId ?? '');
    this.runtimeToolProfilePickerOpen.set(false);
    this.runtimeToolsDirty.set(false);
    const toolsets = record.toolPolicy?.requestedToolsets ?? [];
    const tools = record.toolPolicy?.requestedTools ?? [];
    this.runtimeToolsetSelections.set([...toolsets]);
    this.runtimeToolSelections.set([...tools]);
    // Reveal the inline disclosure when the profile uses inline tools (no
    // reusable local tool profile) and has any selected.
    this.runtimeCustomToolsOpen.set(
      (record.localToolProfileId ?? '') === '' &&
        toolsets.length + tools.length > 0,
    );
    this.seededMcpBindings = (record.mcpBindings ?? []).map((binding) => ({
      ...binding,
    }));
    this.runtimeMcpSelections.set(
      this.seededMcpBindings.map((binding) => ({
        serverId: binding.serverId,
        toolProfileKey: binding.toolProfileKey ?? '',
      })),
    );
    this.runtimeMcpDirty.set(false);
    this.seedContextPolicy(record);
    void this.external?.refresh();
  }

  /**
   * Seed the context-policy form (#3849): prefer the profile's current policy,
   * then the catalog defaults, then a local fallback. The catalog's default
   * strategy id fills in a missing/empty strategy so the dropdown is never blank.
   */
  private seedContextPolicy(record: AdminProfileRegistryRecord): void {
    const seed =
      record.contextPolicy ?? this.admin.contextPolicyDefaults() ?? undefined;
    const fallbackStrategy =
      this.admin.defaultContextStrategyId() ??
      FALLBACK_CONTEXT_POLICY.strategyId;
    this.seededStrategyConfig = seed?.strategyConfig ?? {};
    this.contextPolicyForm.set({
      enabled: seed?.enabled ?? FALLBACK_CONTEXT_POLICY.enabled,
      strategyId: seed?.strategyId ?? fallbackStrategy,
      autoCompactionEnabled:
        seed?.autoCompactionEnabled ??
        FALLBACK_CONTEXT_POLICY.autoCompactionEnabled,
      compactAtPercent:
        seed?.compactAtPercent ?? FALLBACK_CONTEXT_POLICY.compactAtPercent,
      targetPercentAfterCompaction:
        seed?.targetPercentAfterCompaction ??
        FALLBACK_CONTEXT_POLICY.targetPercentAfterCompaction,
      maxContextPercentForWake:
        seed?.maxContextPercentForWake ??
        FALLBACK_CONTEXT_POLICY.maxContextPercentForWake,
      debugVisibility:
        seed?.debugVisibility ?? FALLBACK_CONTEXT_POLICY.debugVisibility,
      includeDebugEventsInModelContext:
        seed?.includeDebugEventsInModelContext ??
        FALLBACK_CONTEXT_POLICY.includeDebugEventsInModelContext,
    });
    this.runtimeContextDirty.set(false);
  }

  protected modelConfigurations(): readonly ModelConfigurationRecord[] {
    return this.admin.modelConfigurations();
  }

  protected modelConfigurationLabel(
    configuration: ModelConfigurationRecord,
  ): string {
    const endpoint = this.admin
      .modelEndpoints()
      .find((candidate) => candidate.endpointId === configuration.endpointId);
    const endpointIdentity =
      endpoint?.displayName?.trim() || configuration.endpointId;
    return `${configuration.modelId} · ${endpointIdentity} (${configuration.modelConfigId})`;
  }

  protected updateRuntimeModelConfigId(event: Event): void {
    this.runtimeModelConfigId.set((event.target as HTMLSelectElement).value);
  }

  protected updateRuntimeExternalMessageDeliveryPolicy(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'immediate_steer' || value === 'serial_next_turn') {
      this.runtimeExternalMessageDeliveryPolicy.set(value);
    }
  }

  protected externalBindingsForProfile(): readonly ExternalAgentBinding[] {
    return (
      this.external
        ?.bindings()
        .filter((binding) => binding.profileId === this.profileId()) ?? []
    );
  }

  protected externalBindingPolicyMatchesProfile(
    binding: ExternalAgentBinding,
  ): boolean {
    return (
      binding.messageDeliveryPolicy ===
      this.runtimeExternalMessageDeliveryPolicy()
    );
  }

  /** Reusable local tool profiles available to the explicit apply operation. */
  protected localToolProfiles(): readonly AdminLocalToolProfile[] {
    return this.admin.localToolProfiles();
  }

  protected localToolProfileLabel(profile: AdminLocalToolProfile): string {
    return localToolProfileLabel(profile);
  }

  protected currentLocalToolProfileLabel(): string {
    const currentId = this.runtimeLocalToolProfileId();
    if (currentId === '') return 'Inline custom tools';
    const profile = this.localToolProfiles().find(
      (candidate) => candidate.id === currentId,
    );
    return profile === undefined
      ? `Unavailable tool profile (${currentId})`
      : this.localToolProfileLabel(profile);
  }

  protected openRuntimeToolProfilePicker(): void {
    this.runtimeToolProfileDraftId.set(this.runtimeLocalToolProfileId());
    this.runtimeToolProfilePickerOpen.set(true);
  }

  protected updateRuntimeToolProfileDraft(event: Event): void {
    this.runtimeToolProfileDraftId.set(
      (event.target as HTMLSelectElement).value,
    );
  }

  protected cancelRuntimeToolProfilePicker(): void {
    this.runtimeToolProfileDraftId.set(this.runtimeLocalToolProfileId());
    this.runtimeToolProfilePickerOpen.set(false);
  }

  protected applyRuntimeToolProfileDraft(): void {
    const selectedProfileId = this.runtimeToolProfileDraftId();
    this.runtimeLocalToolProfileId.set(selectedProfileId);
    this.runtimeToolsDirty.set(true);
    this.runtimeToolProfilePickerOpen.set(false);
    if (selectedProfileId === '') {
      this.runtimeCustomToolsOpen.set(true);
    } else {
      this.runtimeCustomToolsOpen.set(false);
    }
  }

  protected toggleRuntimeCustomTools(): void {
    this.runtimeCustomToolsOpen.update((open) => !open);
  }

  protected toolsetCatalog(): readonly AdminToolsetDescriptor[] {
    return this.admin.toolsetCatalog();
  }

  protected toolCatalogTools(): readonly AdminToolDescriptor[] {
    return this.admin.toolCatalogTools();
  }

  protected toolsetLabel(toolset: AdminToolsetDescriptor): string {
    return toolsetLabel(toolset);
  }

  protected toolLabel(tool: AdminToolDescriptor): string {
    return toolLabel(tool);
  }

  protected isRuntimeToolsetSelected(toolsetId: string): boolean {
    return this.runtimeToolsetSelections().includes(toolsetId);
  }

  protected toggleRuntimeToolset(toolsetId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.runtimeToolsDirty.set(true);
    this.runtimeToolsetSelections.update((selections) => {
      const without = selections.filter((id) => id !== toolsetId);
      return checked ? [...without, toolsetId] : without;
    });
  }

  protected isRuntimeToolSelected(toolName: string): boolean {
    return this.runtimeToolSelections().includes(toolName);
  }

  protected toggleRuntimeTool(toolName: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.runtimeToolsDirty.set(true);
    this.runtimeToolSelections.update((selections) => {
      const without = selections.filter((name) => name !== toolName);
      return checked ? [...without, toolName] : without;
    });
  }

  /** Configured MCP servers from the backend catalog (#3647). */
  protected mcpServers(): readonly AdminMcpServer[] {
    return this.admin.mcpServers();
  }

  protected mcpServerLabel(server: AdminMcpServer): string {
    return mcpServerLabel(server);
  }

  protected isRuntimeMcpServerSelected(serverId: string): boolean {
    return this.runtimeMcpSelections().some(
      (selection) => selection.serverId === serverId,
    );
  }

  protected toggleRuntimeMcpServer(serverId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.runtimeMcpDirty.set(true);
    this.runtimeMcpSelections.update((selections) => {
      const without = selections.filter(
        (selection) => selection.serverId !== serverId,
      );
      return checked ? [...without, { serverId, toolProfileKey: '' }] : without;
    });
  }

  protected runtimeMcpToolProfileKeyFor(serverId: string): string {
    return (
      this.runtimeMcpSelections().find(
        (selection) => selection.serverId === serverId,
      )?.toolProfileKey ?? ''
    );
  }

  protected updateRuntimeMcpToolProfileKey(
    serverId: string,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.runtimeMcpDirty.set(true);
    this.runtimeMcpSelections.update((selections) =>
      selections.map((selection) =>
        selection.serverId === serverId
          ? { ...selection, toolProfileKey: value }
          : selection,
      ),
    );
  }

  // ---- context strategy policy controls (#3849) --------------------------

  /** Selectable strategies from the catalog (#3849); empty if route absent. */
  protected contextStrategies(): readonly ContextStrategyDescriptor[] {
    return this.admin.contextStrategies();
  }

  /** Percent control bounds from the catalog (#3849). */
  protected contextPercentRange(): { min: number; max: number } {
    return this.admin.contextPercentRange();
  }

  protected updateContextStrategy(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.runtimeContextDirty.set(true);
    this.contextPolicyForm.update((form) => ({ ...form, strategyId: value }));
  }

  protected updateContextDebugVisibility(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'off' || value === 'status' || value === 'verbose') {
      this.runtimeContextDirty.set(true);
      this.contextPolicyForm.update((form) => ({
        ...form,
        debugVisibility: value,
      }));
    }
  }

  protected toggleContextField(
    field:
      | 'enabled'
      | 'autoCompactionEnabled'
      | 'includeDebugEventsInModelContext',
    event: Event,
  ): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.runtimeContextDirty.set(true);
    this.contextPolicyForm.update((form) => ({ ...form, [field]: checked }));
  }

  protected updateContextPercent(
    field:
      | 'compactAtPercent'
      | 'targetPercentAfterCompaction'
      | 'maxContextPercentForWake',
    event: Event,
  ): void {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const { min, max } = this.contextPercentRange();
    const clamped = Math.min(max, Math.max(min, Math.round(raw)));
    this.runtimeContextDirty.set(true);
    this.contextPolicyForm.update((form) => ({ ...form, [field]: clamped }));
  }

  /** Build the runtime-config request body for plan/apply (#3742). */
  protected buildRuntimeConfigRequest(
    record: AdminProfileRegistryRecord,
  ): ProfileRegistryRuntimeConfigRequest {
    const request: {
      expectedRevision: number;
      externalMessageDeliveryPolicy: ExternalMessageDeliveryPolicy;
      modelConfigId?: string;
      localToolProfileId?: string | null;
      toolPolicy?: {
        requestedToolsets: readonly string[];
        requestedTools: readonly string[];
      };
      mcpBindings?: readonly CreateProfileMcpBinding[];
      contextPolicy?: ContextStrategyPolicy;
    } = {
      expectedRevision: record.revision ?? 0,
      externalMessageDeliveryPolicy:
        this.runtimeExternalMessageDeliveryPolicy(),
    };

    const modelConfigId = this.runtimeModelConfigId().trim();
    if (modelConfigId !== '') request.modelConfigId = modelConfigId;

    // Tools are an explicit operation. Ordinary load/plan/apply omits them so
    // opening this screen can never look like (or cause) a silent clear.
    if (this.runtimeToolsDirty()) {
      const localToolProfileId = this.runtimeLocalToolProfileId().trim();
      if (localToolProfileId !== '') {
        request.localToolProfileId = localToolProfileId;
      } else {
        request.localToolProfileId = null;
        request.toolPolicy = {
          requestedToolsets: this.runtimeToolsetSelections().filter(
            (id) => id.trim() !== '',
          ),
          requestedTools: this.runtimeToolSelections().filter(
            (name) => name.trim() !== '',
          ),
        };
      }
    }

    // MCP: only sent when touched; preserves advanced fields for retained
    // servers by merging the draft over the seeded binding. An empty
    // toolProfileKey clears it rather than keeping the seeded value.
    if (this.runtimeMcpDirty()) {
      request.mcpBindings = this.runtimeMcpSelections()
        .filter((selection) => selection.serverId.trim() !== '')
        .map((selection) => {
          const seeded = this.seededMcpBindings.find(
            (binding) => binding.serverId === selection.serverId,
          );
          const merged: {
            -readonly [K in keyof CreateProfileMcpBinding]: CreateProfileMcpBinding[K];
          } = seeded ? { ...seeded } : { serverId: selection.serverId };
          const key = selection.toolProfileKey.trim();
          if (key === '') {
            delete merged.toolProfileKey;
          } else {
            merged.toolProfileKey = key;
          }
          return merged;
        });
    }

    // Context policy: only sent when touched, preserving the seed's opaque
    // strategyConfig. Invalid values surface as plan diagnostics (e.g.
    // contextPolicy.strategyId) rather than applying.
    if (this.runtimeContextDirty()) {
      const form = this.contextPolicyForm();
      request.contextPolicy = {
        ...form,
        strategyConfig: this.seededStrategyConfig,
      };
    }

    return request;
  }

  protected planRuntimeConfig(record: AdminProfileRegistryRecord): void {
    void this.admin.planRegistryRuntimeConfig(
      record.profileId,
      this.buildRuntimeConfigRequest(record),
    );
  }

  protected applyRuntimeConfig(record: AdminProfileRegistryRecord): void {
    void this.admin.applyRegistryRuntimeConfig(
      record.profileId,
      this.buildRuntimeConfigRequest(record),
    );
  }

  protected updateDeleteConfirmation(event: Event): void {
    this.deleteConfirmation.set((event.target as HTMLInputElement).value);
  }

  protected openDeleteConfirmationBox(): void {
    this.deleteConfirmation.set('');
    this.deleteConfirmOpen.set(true);
  }

  private closeDeleteConfirmationBox(): void {
    this.deleteConfirmation.set('');
    this.deleteConfirmOpen.set(false);
  }

  protected cancelDelete(): void {
    this.closeDeleteConfirmationBox();
  }

  protected async deleteProfile(
    record: AdminProfileRegistryRecord,
  ): Promise<void> {
    if (!this.canDeleteProfile() || !this.deleteConfirmed()) return;
    await this.admin.deleteProfile(record.profileId, {
      reason: PROFILE_DELETE_REASON,
      confirmProfileId: this.deleteConfirmation(),
    });
    const result = this.profileDeleteResult();
    if (result?.outcome.status === 'completed') {
      this.closeDeleteConfirmationBox();
      this.chat.clearProfileSelection(record.profileId);
      await this.chat.refreshSessions().catch(() => undefined);
    }
  }

  private capabilityStatusFor(
    capabilityIds: readonly string[],
  ): CapabilityStatus {
    const states = capabilityIds.map((id) =>
      this.admin.controlCapabilityState(id),
    );
    if (states.every((state) => state === 'available')) return 'available';
    if (states.some((state) => state === 'unknown')) return 'checking';
    if (states.some((state) => state === 'available')) return 'partial';
    return 'missing';
  }

  protected deleteOutcomeDetails(
    response: AdminControlResponse<ProfileDeleteResult>,
  ): readonly string[] {
    const details: string[] = [];
    const affected = response.outcome.affectedIds;
    if (affected !== undefined) {
      for (const [key, value] of Object.entries(affected)) {
        details.push(`${key} ${value}`);
      }
    }
    const result = response.outcome.result;
    if (result === undefined) return details;
    if (result.confirmProfileId !== undefined) {
      details.push(`confirmed ${result.confirmProfileId}`);
    }
    if (result.profileDirectoryDeleted !== undefined) {
      details.push(
        `profile directory deleted ${result.profileDirectoryDeleted}`,
      );
    }
    if (result.runtimeConfigReloaded !== undefined) {
      details.push(`runtime config reloaded ${result.runtimeConfigReloaded}`);
    }
    const storage = result.storagePurge;
    if (storage !== undefined) {
      details.push(
        `profile registry deleted ${storage.profileRegistryDeleted}`,
      );
      details.push(`rows deleted ${storage.rowsDeleted}`);
      details.push(...labeledList('sessions', storage.sessionIds));
      details.push(...labeledList('agents', storage.agentIds));
      for (const count of storage.tableCounts) {
        details.push(`${count.table} rows ${count.rowsDeleted}`);
      }
    }
    return details;
  }

  protected deleteResultJson(
    response: AdminControlResponse<ProfileDeleteResult>,
  ): string {
    const result = response.outcome.result;
    if (result === undefined) return '';
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  // ---- MCP binding resolution for this profile (#3649) -------------------

  protected mcpBindings(): readonly AdminMcpBinding[] {
    return this.admin
      .mcpBindings()
      .filter((binding) => binding.profileId === this.profileId());
  }

  protected materializedMcpBindings(
    record: AdminProfileRegistryRecord,
  ): readonly AdminProfileMaterializedMcpBinding[] {
    return record.materializedMcpBindings ?? [];
  }

  protected mcpSurfaceState(
    binding: AdminProfileMaterializedMcpBinding,
  ): string {
    const surface = this.admin
      .mcpSurfaces()
      ?.items.find((candidate) => candidate.bindingId === binding.bindingId);
    return String(
      surface?.status ?? binding.connectionState ?? binding.status ?? 'unknown',
    );
  }

  protected executableToolState(
    binding: AdminProfileMaterializedMcpBinding,
  ): string {
    const surface = this.admin
      .mcpSurfaces()
      ?.items.find((candidate) => candidate.bindingId === binding.bindingId);
    if (surface?.status === 'active') return 'callable';
    if (surface === undefined) return 'not discovered';
    return 'unavailable';
  }

  protected materializedRevisionState(
    record: AdminProfileRegistryRecord,
    binding: AdminProfileMaterializedMcpBinding,
  ): string {
    if (binding.appliedProfileRevision === undefined) return 'unknown';
    return binding.appliedProfileRevision === record.revision
      ? 'current'
      : `stale (applied ${binding.appliedProfileRevision}, current ${record.revision ?? '-'})`;
  }

  protected isMcpBindingFallback(binding: AdminMcpBinding): boolean {
    return binding.endpointServerId !== binding.resolvedServerId;
  }

  protected isMcpBindingDegraded(binding: AdminMcpBinding): boolean {
    return (
      binding.degradedReason !== undefined ||
      binding.status.toLowerCase() !== 'active'
    );
  }
}

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

function labeledList(label: string, values?: readonly string[]): string[] {
  return values === undefined || values.length === 0
    ? []
    : [`${label} ${values.join(', ')}`];
}

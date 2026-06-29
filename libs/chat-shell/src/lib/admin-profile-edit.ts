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
import { AdminStore } from '@rusty-view/chat-store';
import type {
  AdminLocalToolProfile,
  AdminMcpBinding,
  AdminMcpServer,
  AdminProfileRegistryRecord,
  AdminToolDescriptor,
  AdminToolsetDescriptor,
  CreateProfileMcpBinding,
  ProfileBundleExportEntry,
  ProfileRegistryFieldUpdateRequest,
  ProfileRegistryLifecycleRequest,
  ProfileRegistryLifecycleStatus,
  ProfileRegistryPromptRequest,
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
  /** Which sub-form is active in the edit window: registry fields by default. */
  protected readonly section = signal<
    'fields' | 'lifecycle' | 'prompts' | 'runtime'
  >('fields');

  // ---- runtime-config edit (provider / tools / MCP, #3742) ----------------

  /** Selected provider alias; '' keeps the profile's current provider/model. */
  protected readonly runtimeProviderAlias = signal<string>('');
  /** Selected reusable local tool profile id; '' = use inline toolsets/tools. */
  protected readonly runtimeLocalToolProfileId = signal<string>('');
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
    this.runtimeProviderAlias.set(record.providerAlias ?? '');
    this.runtimeLocalToolProfileId.set(record.localToolProfileId ?? '');
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
  }

  /** Configured model provider aliases for the provider dropdown (#3534). */
  protected providerAliases(): readonly string[] {
    return this.admin.providerAliases().map((provider) => provider.alias);
  }

  protected updateRuntimeProviderAlias(event: Event): void {
    this.runtimeProviderAlias.set((event.target as HTMLSelectElement).value);
  }

  /** Reusable local tool profiles for the dropdown (#3689). */
  protected localToolProfiles(): readonly AdminLocalToolProfile[] {
    return this.admin.localToolProfiles();
  }

  protected localToolProfileLabel(profile: AdminLocalToolProfile): string {
    return localToolProfileLabel(profile);
  }

  protected updateRuntimeLocalToolProfile(event: Event): void {
    this.runtimeLocalToolProfileId.set(
      (event.target as HTMLSelectElement).value,
    );
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

  protected updateRuntimeMcpToolProfileKey(serverId: string, event: Event): void {
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

  /** Build the runtime-config request body for plan/apply (#3742). */
  protected buildRuntimeConfigRequest(
    record: AdminProfileRegistryRecord,
  ): ProfileRegistryRuntimeConfigRequest {
    const request: {
      expectedRevision: number;
      providerAlias?: string;
      localToolProfileId?: string | null;
      toolPolicy?: { requestedToolsets: readonly string[]; requestedTools: readonly string[] };
      mcpBindings?: readonly CreateProfileMcpBinding[];
    } = { expectedRevision: record.revision ?? 0 };

    // Provider: only set an alias (never auto-clear to avoid wiping inline
    // model config). Empty selection leaves the current provider untouched.
    const alias = this.runtimeProviderAlias().trim();
    if (alias !== '') request.providerAlias = alias;

    // Tools: a selected local tool profile wins; otherwise send inline tool
    // policy with localToolProfileId: null so Crew uses the inline selection.
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

  // ---- MCP binding resolution for this profile (#3649) -------------------

  protected mcpBindings(): readonly AdminMcpBinding[] {
    return this.admin
      .mcpBindings()
      .filter((binding) => binding.profileId === this.profileId());
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

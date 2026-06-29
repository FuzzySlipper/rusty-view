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
  AdminMcpBinding,
  AdminProfileRegistryRecord,
  ProfileBundleExportEntry,
  ProfileRegistryFieldUpdateRequest,
  ProfileRegistryLifecycleRequest,
  ProfileRegistryLifecycleStatus,
  ProfileRegistryPromptRequest,
  ProfileRegistryWritePlan,
} from '@rusty-view/transport';

import {
  groupRuntimeRefs,
  type RuntimeRefGroup,
} from './admin-profile-runtime-refs';

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
  protected readonly section = signal<'fields' | 'lifecycle' | 'prompts'>(
    'fields',
  );

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

  protected showSection(section: 'fields' | 'lifecycle' | 'prompts'): void {
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

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
  AdminLocalToolProfile,
  AdminMcpServer,
  AdminToolDescriptor,
  AdminToolsetDescriptor,
  CreateAdminProfileRequest,
  CreateProfileMcpBinding,
  CreateProfileToolPolicy,
  ProfileRegistryDerivedRuntimeRef,
} from '@rusty-view/transport';

import {
  groupRuntimeRefs,
  type RuntimeRefGroup,
} from './admin-profile-runtime-refs';

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
  /**
   * Legacy free-form MCP tool profile string. Superseded by `mcpBindings`
   * selected from the backend MCP catalog (#3648); retained only as an
   * advanced compatibility field.
   */
  readonly mcpToolProfile: string;
}

/**
 * Draft selection of an MCP server binding in the create-profile form (#3648).
 * `serverId` comes from the backend MCP catalog; `toolProfileKey` is an
 * optional per-server override left blank by default so the backend applies
 * its default for the binding.
 */
interface McpBindingDraft {
  readonly serverId: string;
  readonly toolProfileKey: string;
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

/**
 * Create Profile window (#3690). Extracted from the former monolithic profiles
 * panel so the default profiles view stays a lean list; this window owns the
 * full create flow (core fields, MCP server selection #3647/#3648, built-in
 * tool policy #3686, advanced session/impl/legacy fields, and the create
 * review/preview). Reads and writes the shared {@link AdminStore}; emits
 * {@link created} on success and {@link cancelled} when dismissed.
 */
@Component({
  selector: 'rv-admin-profile-create',
  templateUrl: './admin-profile-create.html',
  styleUrls: ['./admin-profile-shared.css', './admin-profile-create.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProfileCreateComponent {
  protected readonly admin = inject(AdminStore);
  private readonly chatStore = inject(ChatStore);

  /** Emitted after a profile is successfully created. */
  readonly created = output<void>();
  /** Emitted when the operator dismisses the create window without creating. */
  readonly cancelled = output<void>();

  protected readonly form = signal<ProfileFormState>(INITIAL_FORM);
  /**
   * Whether the advanced create fields (explicit session/implementation ids and
   * the legacy MCP tool profile) are revealed. Hidden by default so the create
   * flow only asks for user-meaningful fields (#3632); omitted advanced fields
   * let Crew generate session/implementation ids.
   */
  protected readonly advancedOpen = signal(false);
  /** Selected MCP server bindings for the create-profile request (#3648). */
  protected readonly mcpSelections = signal<readonly McpBindingDraft[]>([]);
  /**
   * Selected reusable local tool profile id (#3689). Preferred default path:
   * sent as the top-level `localToolProfileId`. '' means none selected.
   */
  protected readonly selectedToolProfileId = signal<string>('');
  /**
   * Whether the advanced "custom built-in tools" disclosure is open (#3689).
   * When open, the operator can pick raw toolsets/tools inline (#3686) instead
   * of a reusable local tool profile.
   */
  protected readonly customToolsOpen = signal(false);
  /**
   * Selected built-in (non-MCP) toolset ids for the create-profile request
   * (#3686). Sent as `toolPolicy.requestedToolsets`. Independent of MCP
   * selection; empty by default so creation works with no built-in tools.
   */
  protected readonly toolsetSelections = signal<readonly string[]>([]);
  /** Selected built-in individual tool names (`toolPolicy.requestedTools`, #3686). */
  protected readonly toolSelections = signal<readonly string[]>([]);

  protected readonly createDisabled = computed(
    () => this.admin.saving() || this.form().profileId.trim() === '',
  );

  /**
   * Derived runtime graph actions from the most recent create-profile call
   * (task #3407 planner output). Surfaced as a before/after preview of the
   * runtime graph that was created.
   */
  protected readonly createdActionGroups = computed<readonly RuntimeRefGroup[]>(
    () => {
      const actions =
        this.admin.createResult()?.outcome?.result?.derivedRuntimeActions ?? [];
      const refs: ProfileRegistryDerivedRuntimeRef[] = actions.map(
        (action) => ({
          refKind: action.refKind,
          refId: action.refId,
          status: 'planned',
          metadataJson: action.metadataJson ?? null,
        }),
      );
      return groupRuntimeRefs(refs);
    },
  );

  protected cancel(): void {
    this.cancelled.emit();
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
    if (
      value === '' ||
      value === 'full' ||
      value === 'worker' ||
      value === 'delegated'
    ) {
      this.form.update((current) => ({ ...current, kind: value }));
    }
  }

  protected toggleAdvanced(): void {
    this.advancedOpen.update((open) => !open);
  }

  /** Configured MCP servers from the backend catalog (#3647). */
  protected mcpServers(): readonly AdminMcpServer[] {
    return this.admin.mcpServers();
  }

  /** Whether an MCP server is currently selected for the new profile. */
  protected isMcpServerSelected(serverId: string): boolean {
    return this.mcpSelections().some(
      (selection) => selection.serverId === serverId,
    );
  }

  /** Toggle an MCP server binding on/off from a checkbox. */
  protected toggleMcpServer(serverId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.mcpSelections.update((selections) => {
      const without = selections.filter(
        (selection) => selection.serverId !== serverId,
      );
      return checked ? [...without, { serverId, toolProfileKey: '' }] : without;
    });
  }

  /** Current tool profile key override for a selected MCP server (#3648). */
  protected mcpToolProfileKeyFor(serverId: string): string {
    return (
      this.mcpSelections().find((selection) => selection.serverId === serverId)
        ?.toolProfileKey ?? ''
    );
  }

  /** Update the optional tool profile key for a selected MCP server. */
  protected updateMcpToolProfileKey(serverId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.mcpSelections.update((selections) =>
      selections.map((selection) =>
        selection.serverId === serverId
          ? { ...selection, toolProfileKey: value }
          : selection,
      ),
    );
  }

  /**
   * Human-readable label for an MCP server option (#3647). Surfaces server id,
   * optional label, transport, and source so operators can distinguish servers.
   */
  protected mcpServerLabel(server: AdminMcpServer): string {
    const name =
      server.label === undefined ? server.id : `${server.id} (${server.label})`;
    return `${name} · ${server.transport} · ${server.source}`;
  }

  /** Reusable local tool profiles from Crew (#3689). */
  protected localToolProfiles(): readonly AdminLocalToolProfile[] {
    return this.admin.localToolProfiles();
  }

  /** Update the selected reusable local tool profile (#3689). */
  protected updateSelectedToolProfile(event: Event): void {
    this.selectedToolProfileId.set((event.target as HTMLSelectElement).value);
  }

  /** Toggle the advanced custom-built-in-tools disclosure (#3689). */
  protected toggleCustomTools(): void {
    this.customToolsOpen.update((open) => !open);
  }

  /** Human-readable label for a local tool profile option (#3689). */
  protected localToolProfileLabel(profile: AdminLocalToolProfile): string {
    const name =
      profile.displayName === undefined
        ? profile.id
        : `${profile.id} (${profile.displayName})`;
    const count =
      profile.requestedToolsets.length + profile.requestedTools.length;
    const flags = [
      profile.enabled ? null : 'disabled',
      profile.system ? 'system' : null,
    ].filter((flag): flag is string => flag !== null);
    const suffix = flags.length === 0 ? '' : ` · ${flags.join(', ')}`;
    return `${name} · ${count} tool(s)${suffix}`;
  }

  /** Built-in (non-MCP) toolsets from Crew's tool catalog (#3686). */
  protected toolsetCatalog(): readonly AdminToolsetDescriptor[] {
    return this.admin.toolsetCatalog();
  }

  /** Built-in (non-MCP) individual tools from Crew's tool catalog (#3686). */
  protected toolCatalogTools(): readonly AdminToolDescriptor[] {
    return this.admin.toolCatalogTools();
  }

  /** Whether a built-in toolset is selected for the new profile (#3686). */
  protected isToolsetSelected(toolsetId: string): boolean {
    return this.toolsetSelections().includes(toolsetId);
  }

  /** Toggle a built-in toolset on/off from a checkbox (#3686). */
  protected toggleToolset(toolsetId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.toolsetSelections.update((selections) => {
      const without = selections.filter((id) => id !== toolsetId);
      return checked ? [...without, toolsetId] : without;
    });
  }

  /** Whether a built-in tool is selected for the new profile (#3686). */
  protected isToolSelected(toolName: string): boolean {
    return this.toolSelections().includes(toolName);
  }

  /** Toggle a built-in tool on/off from a checkbox (#3686). */
  protected toggleTool(toolName: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.toolSelections.update((selections) => {
      const without = selections.filter((name) => name !== toolName);
      return checked ? [...without, toolName] : without;
    });
  }

  /**
   * Human-readable label for a toolset option (#3686). Surfaces the id plus an
   * optional Crew-provided label and tool count so operators don't type ids
   * blindly. Falls back to the id alone when no label/count is provided.
   */
  protected toolsetLabel(toolset: AdminToolsetDescriptor): string {
    const name =
      toolset.label === undefined
        ? toolset.id
        : `${toolset.id} (${toolset.label})`;
    const count = toolset.toolCount ?? toolset.tools?.length;
    return count === undefined ? name : `${name} · ${count} tools`;
  }

  /** Human-readable label for an individual tool option (#3686). */
  protected toolLabel(tool: AdminToolDescriptor): string {
    return tool.label === undefined
      ? tool.name
      : `${tool.name} (${tool.label})`;
  }

  /**
   * Read-only summary of the built-in tool policy that will be submitted
   * (#3686). Shown in the create review so the operator can confirm the
   * selection before submit. Empty when nothing is selected.
   */
  protected readonly selectedToolPolicySummary = computed(() => ({
    localToolProfileId: this.selectedToolProfileId(),
    toolsets: this.toolsetSelections(),
    tools: this.toolSelections(),
  }));

  protected createProfile(): void {
    const request = buildCreateProfileRequest(this.form(), {
      mcpSelections: this.mcpSelections(),
      localToolProfileId: this.selectedToolProfileId(),
      toolsetSelections: this.toolsetSelections(),
      toolSelections: this.toolSelections(),
    });
    void this.admin.createProfile(request).then(() => {
      if (this.admin.error() === null) {
        this.form.set(INITIAL_FORM);
        this.mcpSelections.set([]);
        this.selectedToolProfileId.set('');
        this.toolsetSelections.set([]);
        this.toolSelections.set([]);
        void this.chatStore.refreshSessions();
        this.created.emit();
      }
    });
  }
}

interface ToolSelectionState {
  readonly mcpSelections: readonly McpBindingDraft[];
  readonly localToolProfileId: string;
  readonly toolsetSelections: readonly string[];
  readonly toolSelections: readonly string[];
}

function buildCreateProfileRequest(
  form: ProfileFormState,
  selection: ToolSelectionState,
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
    ...optionalMcpBindings(selection.mcpSelections),
    ...optionalToolSelection(selection),
  };
  return request;
}

/**
 * Build the `mcpBindings` entry from the selected servers (#3648). Omitted
 * entirely when no servers are selected so a profile is created with no MCP
 * tools. Each binding carries its `serverId`; the optional `toolProfileKey` is
 * only included when the operator typed one (prefer `toolProfileKey` over the
 * legacy `mcpToolProfile` spelling).
 */
function optionalMcpBindings(
  selections: readonly McpBindingDraft[],
): { mcpBindings: readonly CreateProfileMcpBinding[] } | Record<string, never> {
  const bindings = selections
    .filter((selection) => selection.serverId.trim() !== '')
    .map((selection) => {
      const toolProfileKey = selection.toolProfileKey.trim();
      return toolProfileKey === ''
        ? { serverId: selection.serverId }
        : { serverId: selection.serverId, toolProfileKey };
    });
  return bindings.length === 0 ? {} : { mcpBindings: bindings };
}

/**
 * Build the built-in tool selection for the create request (#3686/#3689). A
 * selected reusable local tool profile is preferred and wins, sent as the
 * top-level `localToolProfileId` (Crew expects it as a sibling of `toolPolicy`,
 * not nested inside it). Otherwise the advanced inline toolset/tool selections
 * are sent as `toolPolicy.requestedToolsets`/`requestedTools`. Omitted entirely
 * when nothing is selected so a profile is created with no built-in tools. Kept
 * separate from `mcpBindings`.
 */
function optionalToolSelection(
  selection: ToolSelectionState,
):
  | { localToolProfileId: string }
  | { toolPolicy: CreateProfileToolPolicy }
  | Record<string, never> {
  const localToolProfileId = selection.localToolProfileId.trim();
  if (localToolProfileId !== '') {
    return { localToolProfileId };
  }
  const requestedToolsets = selection.toolsetSelections.filter(
    (id) => id.trim() !== '',
  );
  const requestedTools = selection.toolSelections.filter(
    (name) => name.trim() !== '',
  );
  if (requestedToolsets.length === 0 && requestedTools.length === 0) {
    return {};
  }
  return {
    toolPolicy: {
      ...(requestedToolsets.length === 0 ? {} : { requestedToolsets }),
      ...(requestedTools.length === 0 ? {} : { requestedTools }),
    },
  };
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

import type {
  AdminLocalToolProfile,
  AdminMcpServer,
  AdminToolDescriptor,
  AdminToolsetDescriptor,
  CreateProfileMcpBinding,
  CreateProfileToolPolicy,
} from '@rusty-view/transport';

/**
 * Shared building blocks for the provider/tool/MCP selection used by both the
 * Create Profile window (#3690) and the Edit Profile runtime-config section
 * (#3742). Keeping the request-shaping logic in one place ensures both windows
 * speak the same Crew contract (top-level `localToolProfileId` preferred over
 * inline `toolPolicy`; `mcpBindings` carry `serverId` + optional
 * `toolProfileKey`).
 */

/**
 * Draft selection of an MCP server binding. `serverId` comes from the backend
 * MCP catalog; `toolProfileKey` is an optional per-server override left blank by
 * default so the backend applies its default for the binding.
 */
export interface McpBindingDraft {
  readonly serverId: string;
  readonly toolProfileKey: string;
}

/** The mutable tool/MCP selection a window collects before building a request. */
export interface ToolSelectionState {
  readonly mcpSelections: readonly McpBindingDraft[];
  readonly localToolProfileId: string;
  readonly toolsetSelections: readonly string[];
  readonly toolSelections: readonly string[];
}

/**
 * Build the `mcpBindings` array from selected servers (#3648). Each binding
 * carries its `serverId`; the optional `toolProfileKey` is only included when
 * the operator typed one. Returns an empty array when nothing is selected.
 */
export function buildMcpBindings(
  selections: readonly McpBindingDraft[],
): readonly CreateProfileMcpBinding[] {
  return selections
    .filter((selection) => selection.serverId.trim() !== '')
    .map((selection) => {
      const toolProfileKey = selection.toolProfileKey.trim();
      return toolProfileKey === ''
        ? { serverId: selection.serverId }
        : { serverId: selection.serverId, toolProfileKey };
    });
}

/**
 * Build the built-in tool selection fields (#3686/#3689). A selected reusable
 * local tool profile is preferred and wins, sent as the top-level
 * `localToolProfileId` (Crew expects it as a sibling of `toolPolicy`, not nested
 * inside it). Otherwise the advanced inline toolset/tool selections are sent as
 * `toolPolicy.requestedToolsets`/`requestedTools`. Returns an empty object when
 * nothing is selected so the caller can spread it conditionally.
 */
export function toolSelectionFields(
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
 * Human-readable label for an MCP server option (#3647). Surfaces server id,
 * optional label, transport, and source so operators can distinguish servers.
 */
export function mcpServerLabel(server: AdminMcpServer): string {
  const name =
    server.label === undefined ? server.id : `${server.id} (${server.label})`;
  return `${name} · ${server.transport} · ${server.source}`;
}

/** Human-readable label for a reusable local tool profile option (#3689). */
export function localToolProfileLabel(profile: AdminLocalToolProfile): string {
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

/**
 * Human-readable label for a built-in toolset option (#3686). Surfaces the id
 * plus an optional Crew-provided label and tool count.
 */
export function toolsetLabel(toolset: AdminToolsetDescriptor): string {
  const name =
    toolset.label === undefined
      ? toolset.id
      : `${toolset.id} (${toolset.label})`;
  const count = toolset.toolCount ?? toolset.tools?.length;
  return count === undefined ? name : `${name} · ${count} tools`;
}

/** Human-readable label for an individual built-in tool option (#3686). */
export function toolLabel(tool: AdminToolDescriptor): string {
  return tool.label === undefined ? tool.name : `${tool.name} (${tool.label})`;
}

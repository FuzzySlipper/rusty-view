import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { AdminStore } from '@rusty-view/chat-store';
import type {
  AdminLocalToolProfile,
  AdminLocalToolProfileWriteRequest,
  AdminToolDescriptor,
  AdminToolsetDescriptor,
} from '@rusty-view/transport';

interface ToolProfileFormState {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly requestedToolsets: readonly string[];
  readonly requestedTools: readonly string[];
}

const INITIAL_FORM: ToolProfileFormState = {
  id: '',
  displayName: '',
  description: '',
  enabled: true,
  requestedToolsets: [],
  requestedTools: [],
};

/**
 * Local tool profile editor (#3689 / Crew #3688). A dedicated admin window for
 * creating and modifying reusable DB-backed local tool profiles — named
 * selections of built-in (non-MCP) toolsets/tools. Profile creation references
 * these by id rather than picking low-level tools inline. Tool labels come from
 * Crew's built-in catalog; backend validation diagnostics (stale/invalid refs)
 * are surfaced read-only. MCP servers are never part of a local tool profile.
 */
@Component({
  selector: 'rv-admin-tool-profile-editor',
  templateUrl: './admin-tool-profile-editor.html',
  styleUrls: ['./admin-profile-shared.css', './admin-tool-profile-editor.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminToolProfileEditorComponent {
  protected readonly admin = inject(AdminStore);

  /** Emitted when the operator closes the editor. */
  readonly closed = output<void>();

  /** The id being edited, or null when the form creates a new profile. */
  protected readonly editingId = signal<string | null>(null);
  protected readonly form = signal<ToolProfileFormState>(INITIAL_FORM);

  protected close(): void {
    this.admin.clearToolProfileWriteError();
    this.closed.emit();
  }

  protected profiles(): readonly AdminLocalToolProfile[] {
    return this.admin.localToolProfiles();
  }

  protected toolsetCatalog(): readonly AdminToolsetDescriptor[] {
    return this.admin.toolsetCatalog();
  }

  protected toolCatalogTools(): readonly AdminToolDescriptor[] {
    return this.admin.toolCatalogTools();
  }

  /** Whether a profile is immutable (backend-managed or explicitly read-only). */
  protected isReadOnly(profile: AdminLocalToolProfile): boolean {
    return profile.system || profile.readOnly;
  }

  // ---- form lifecycle -----------------------------------------------------

  /** Reset the form to create a brand-new local tool profile. */
  protected startNew(): void {
    this.admin.clearToolProfileWriteError();
    this.editingId.set(null);
    this.form.set(INITIAL_FORM);
  }

  /** Seed the form from an existing profile for editing. */
  protected startEdit(profile: AdminLocalToolProfile): void {
    if (this.isReadOnly(profile)) return;
    this.admin.clearToolProfileWriteError();
    this.editingId.set(profile.id);
    this.form.set({
      id: profile.id,
      displayName: profile.displayName ?? '',
      description: profile.description ?? '',
      enabled: profile.enabled,
      requestedToolsets: profile.requestedToolsets,
      requestedTools: profile.requestedTools,
    });
  }

  protected updateText(
    field: 'id' | 'displayName' | 'description',
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  protected updateEnabled(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.update((current) => ({ ...current, enabled: checked }));
  }

  protected isToolsetSelected(id: string): boolean {
    return this.form().requestedToolsets.includes(id);
  }

  protected toggleToolset(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.update((current) => ({
      ...current,
      requestedToolsets: toggle(current.requestedToolsets, id, checked),
    }));
  }

  protected isToolSelected(name: string): boolean {
    return this.form().requestedTools.includes(name);
  }

  protected toggleTool(name: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.update((current) => ({
      ...current,
      requestedTools: toggle(current.requestedTools, name, checked),
    }));
  }

  protected toolsetLabel(toolset: AdminToolsetDescriptor): string {
    const name =
      toolset.label === undefined
        ? toolset.id
        : `${toolset.id} (${toolset.label})`;
    const count = toolset.toolCount ?? toolset.tools?.length;
    return count === undefined ? name : `${name} · ${count} tools`;
  }

  protected toolLabel(tool: AdminToolDescriptor): string {
    return tool.label === undefined
      ? tool.name
      : `${tool.name} (${tool.label})`;
  }

  protected localToolProfileSummary(profile: AdminLocalToolProfile): string {
    const count =
      profile.requestedToolsets.length + profile.requestedTools.length;
    const flags = [
      profile.enabled ? null : 'disabled',
      profile.system ? 'system' : null,
      profile.readOnly ? 'read-only' : null,
    ].filter((flag): flag is string => flag !== null);
    const suffix = flags.length === 0 ? '' : ` · ${flags.join(', ')}`;
    return `${count} tool(s)${suffix}`;
  }

  /** Whether the form can be saved (needs an id on create). */
  protected saveDisabled(): boolean {
    if (this.admin.saving()) return true;
    return this.editingId() === null && this.form().id.trim() === '';
  }

  // ---- write actions ------------------------------------------------------

  protected save(): void {
    const form = this.form();
    const editingId = this.editingId();
    const base: AdminLocalToolProfileWriteRequest = {
      enabled: form.enabled,
      requestedToolsets: form.requestedToolsets,
      requestedTools: form.requestedTools,
      ...optionalString('displayName', form.displayName),
      ...optionalString('description', form.description),
    };
    const write =
      editingId === null
        ? this.admin.createLocalToolProfile({
            ...base,
            ...optionalString('id', form.id),
          })
        : this.admin.updateLocalToolProfile(editingId, {
            ...base,
            ...this.expectedRevision(editingId),
          });
    void write.then((ok) => {
      if (ok) this.startNew();
    });
  }

  protected deleteProfile(profile: AdminLocalToolProfile): void {
    if (this.isReadOnly(profile)) return;
    void this.admin.deleteLocalToolProfile(profile.id).then((ok) => {
      if (ok && this.editingId() === profile.id) this.startNew();
    });
  }

  private expectedRevision(
    id: string,
  ): { expectedRevision: number } | Record<string, never> {
    const revision = this.profiles().find(
      (profile) => profile.id === id,
    )?.revision;
    return revision === undefined ? {} : { expectedRevision: revision };
  }
}

function toggle(
  values: readonly string[],
  value: string,
  include: boolean,
): readonly string[] {
  const without = values.filter((entry) => entry !== value);
  return include ? [...without, value] : without;
}

function optionalString<TKey extends string>(
  key: TKey,
  value: string,
): Record<TKey, string> | Record<string, never> {
  const trimmed = value.trim();
  return trimmed === '' ? {} : ({ [key]: trimmed } as Record<TKey, string>);
}

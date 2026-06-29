import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import type { AdminProfileRegistryRecord } from '@rusty-view/transport';

import { AdminProfileCreateComponent } from './admin-profile-create';
import { AdminProfileEditComponent } from './admin-profile-edit';
import { AdminToolProfileEditorComponent } from './admin-tool-profile-editor';

interface CapabilityRow {
  readonly label: string;
  readonly capabilityIds: readonly string[];
  readonly availableLabel?: string;
}

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

/**
 * Profiles panel (#3690): a lean list coordinator. The default view lists
 * current profiles with a top-level Create button; creating and editing each
 * open a dedicated window ({@link AdminProfileCreateComponent} /
 * {@link AdminProfileEditComponent}) layered over the list. This keeps the
 * default view uncluttered — list rows show summary info plus an Edit button
 * rather than inline edit forms.
 */
@Component({
  selector: 'rv-admin-profiles-panel',
  imports: [
    AdminProfileCreateComponent,
    AdminProfileEditComponent,
    AdminToolProfileEditorComponent,
  ],
  templateUrl: './admin-profiles-panel.html',
  styleUrls: ['./admin-profile-shared.css', './admin-profiles-panel.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProfilesPanelComponent {
  protected readonly admin = inject(AdminStore);
  private readonly chatStore = inject(ChatStore);

  readonly dismissed = output<void>();

  protected readonly capabilityRows = CAPABILITY_ROWS;

  /** Whether the Create Profile window is open over the list. */
  protected readonly createOpen = signal(false);
  /** The profile id whose Edit window is open, or null for the list view. */
  protected readonly editProfileId = signal<string | null>(null);
  /** Whether the local tool profile editor window is open (#3689). */
  protected readonly toolProfilesOpen = signal(false);

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

  // ---- create window ------------------------------------------------------

  protected openCreate(): void {
    this.editProfileId.set(null);
    this.toolProfilesOpen.set(false);
    this.createOpen.set(true);
  }

  // ---- tool profile editor window (#3689) ---------------------------------

  protected openToolProfiles(): void {
    this.createOpen.set(false);
    this.editProfileId.set(null);
    this.toolProfilesOpen.set(true);
  }

  protected closeToolProfiles(): void {
    this.toolProfilesOpen.set(false);
  }

  protected closeCreate(): void {
    this.createOpen.set(false);
  }

  protected onProfileCreated(): void {
    this.createOpen.set(false);
    void this.admin.refresh();
  }

  // ---- edit window --------------------------------------------------------

  /** Open the edit window for an (editable) registry-backed profile. */
  protected openEdit(record: AdminProfileRegistryRecord): void {
    if (!this.isRegistryEditable(record)) return;
    this.createOpen.set(false);
    this.editProfileId.set(record.profileId);
  }

  protected closeEdit(): void {
    this.editProfileId.set(null);
  }

  // ---- list helpers -------------------------------------------------------

  /** Whether a registry record can be edited (registry-backed only). */
  protected isRegistryEditable(record: AdminProfileRegistryRecord): boolean {
    return record.source === 'registry';
  }

  /** Guidance shown when a file-backed profile can't be edited. */
  protected registryEditBlockReason(
    record: AdminProfileRegistryRecord,
  ): string {
    return record.source === 'registry'
      ? ''
      : 'Import this file-backed profile into the registry before editing registry-owned fields.';
  }

  protected sourceLabel(record: AdminProfileRegistryRecord): string {
    return record.source === 'registry' ? 'DB registry' : 'file fallback';
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

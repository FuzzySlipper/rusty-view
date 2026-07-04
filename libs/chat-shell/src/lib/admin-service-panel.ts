import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { AdminStore } from '@rusty-view/chat-store';

type CapabilityStatus = 'available' | 'partial' | 'checking' | 'missing';

interface ServiceCapabilityRow {
  readonly label: string;
  readonly capabilityIds?: readonly string[];
  readonly staticStatus?: 'explicit';
}

const CONFIG_RELOAD_CAPABILITY_ID = 'admin.control.config.reload';

const APPLY_SEMANTICS_ROWS: readonly ServiceCapabilityRow[] = [
  {
    label: 'service reload',
    capabilityIds: [CONFIG_RELOAD_CAPABILITY_ID],
  },
  {
    label: 'session creation',
    staticStatus: 'explicit',
  },
  {
    label: 'channel joins',
    staticStatus: 'explicit',
  },
  {
    label: 'config save',
    capabilityIds: [
      'admin.control.config.draft.plan',
      'admin.control.config.draft.apply',
    ],
  },
  {
    label: 'brain hot swap',
    capabilityIds: [
      'admin.control.profiles.rebuild_brain.plan',
      'admin.control.profiles.rebuild_brain.apply',
    ],
  },
  {
    label: 'session runtime rebuild',
    capabilityIds: [
      'admin.control.sessions.rebuild_runtime.plan',
      'admin.control.sessions.rebuild_runtime.apply',
    ],
  },
];

@Component({
  selector: 'rv-admin-service-panel',
  templateUrl: './admin-service-panel.html',
  styleUrl: './admin-service-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminServicePanelComponent {
  protected readonly admin = inject(AdminStore);
  protected readonly applySemanticsRows = APPLY_SEMANTICS_ROWS;
  protected readonly reloadCapabilityStatus = computed(() =>
    this.capabilityStatusFor([CONFIG_RELOAD_CAPABILITY_ID]),
  );

  readonly dismissed = output<void>();

  constructor() {
    void this.admin.refresh();
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }

  protected refresh(): void {
    void this.admin.refresh();
  }

  protected reloadDisabled(): boolean {
    return this.admin.saving() || this.reloadCapabilityStatus() !== 'available';
  }

  protected reloadTitle(): string {
    const status = this.reloadCapabilityStatus();
    if (status === 'available') return 'Reload service config';
    if (status === 'checking') return 'Checking config reload capability';
    return `Config reload capability ${status}`;
  }

  protected reload(): void {
    if (this.reloadDisabled()) return;
    void this.admin.reloadConfig();
  }

  protected capabilityStatus(
    row: ServiceCapabilityRow,
  ): CapabilityStatus | 'explicit' {
    if (row.staticStatus !== undefined) return row.staticStatus;
    return this.capabilityStatusFor(row.capabilityIds ?? []);
  }

  private capabilityStatusFor(
    capabilityIds: readonly string[],
  ): CapabilityStatus {
    const states = capabilityIds.map((id) =>
      this.admin.controlCapabilityState(id),
    );
    if (states.length === 0) return 'missing';
    if (states.every((state) => state === 'available')) return 'available';
    if (states.some((state) => state === 'unknown')) return 'checking';
    if (states.some((state) => state === 'available')) return 'partial';
    return 'missing';
  }
}

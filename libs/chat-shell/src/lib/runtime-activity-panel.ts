import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { JsonInspectorComponent } from '@rusty-view/chat-components';
import {
  AdminStore,
  ChatStore,
  projectRuntimeActivityRows,
  runtimeActivityFindingLabel,
  runtimeActivityKindLabel,
  runtimeActivityOwnerLabel,
  type RuntimeActivityRow,
} from '@rusty-view/chat-store';

import { SERVICE_PANEL_ID } from './shell-extension-tokens';
import { TopMenuController } from './top-menu-controller';

const ACTIVITY_POLL_INTERVAL_MS = 5_000;

@Component({
  selector: 'rv-runtime-activity-panel',
  imports: [JsonInspectorComponent, NgTemplateOutlet],
  templateUrl: './runtime-activity-panel.html',
  styleUrl: './runtime-activity-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuntimeActivityPanelComponent {
  protected readonly admin = inject(AdminStore);
  private readonly chat = inject(ChatStore);
  private readonly topMenu = inject(TopMenuController);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly requestedProjection = signal<'service' | 'durable'>(
    'service',
  );
  protected readonly navigationError = signal<string | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly detailTitle = signal<string | null>(null);
  protected readonly detailValue = signal<unknown>(null);

  protected readonly activeRows = computed<readonly RuntimeActivityRow[]>(
    () => {
      const census = this.admin.activityCensus();
      return census === null
        ? []
        : projectRuntimeActivityRows(census.active, census.findings);
    },
  );
  protected readonly abnormalRows = computed<readonly RuntimeActivityRow[]>(
    () => {
      const census = this.admin.activityCensus();
      return census === null
        ? []
        : projectRuntimeActivityRows(census.recentlyAbnormal, census.findings);
    },
  );

  constructor() {
    void this.refresh();
    const poll = globalThis.setInterval(() => {
      if (!this.admin.activityLoading()) void this.refresh();
    }, ACTIVITY_POLL_INTERVAL_MS);
    this.destroyRef.onDestroy(() => globalThis.clearInterval(poll));
  }

  protected async refresh(): Promise<void> {
    await this.admin.refreshActivities(this.requestedProjection());
  }

  protected selectProjection(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.requestedProjection.set(value === 'durable' ? 'durable' : 'service');
    void this.refresh();
  }

  protected freshnessLabel(): string {
    if (this.admin.activityCensus() === null) {
      return this.admin.activityLoading() ? 'Loading' : 'Unavailable';
    }
    if (this.admin.activitySnapshotStale()) return 'Stale snapshot';
    if (this.admin.activityLoading()) return 'Refreshing';
    return 'Fresh';
  }

  protected freshnessTone(): 'fresh' | 'loading' | 'stale' | 'unavailable' {
    if (this.admin.activityCensus() === null) {
      return this.admin.activityLoading() ? 'loading' : 'unavailable';
    }
    if (this.admin.activitySnapshotStale()) return 'stale';
    if (this.admin.activityLoading()) return 'loading';
    return 'fresh';
  }

  protected kindLabel(kind: string): string {
    return runtimeActivityKindLabel(kind);
  }

  protected ownerLabel(owner: string): string {
    return runtimeActivityOwnerLabel(owner);
  }

  protected findingLabel(code: string): string {
    return runtimeActivityFindingLabel(code);
  }

  protected durationLabel(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '-';
    if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
    const seconds = Math.floor(milliseconds / 1_000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  protected timestampLabel(timestamp: string | null | undefined): string {
    if (timestamp === undefined || timestamp === null) return 'never';
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime())
      ? timestamp
      : parsed.toLocaleTimeString();
  }

  protected detailSummary(row: RuntimeActivityRow): string {
    const activity = row.view.activity;
    if (activity.kind === 'provider_request') {
      return (
        [activity.providerAlias, activity.model]
          .filter((value): value is string => Boolean(value))
          .join(' / ') || 'provider request'
      );
    }
    if (activity.kind === 'tool_call') {
      return activity.toolName ?? activity.summary ?? 'tool call';
    }
    if (activity.kind === 'subprocess') {
      return activity.processId === undefined || activity.processId === null
        ? (activity.summary ?? 'process')
        : `pid ${activity.processId}${activity.summary ? ` · ${activity.summary}` : ''}`;
    }
    return activity.summary ?? activity.activityId;
  }

  protected rowReasonCodes(row: RuntimeActivityRow): readonly string[] {
    const codes = new Set(
      row.findings.map((finding) => finding.code as string),
    );
    const reasonCode = row.view.activity.reasonCode;
    if (reasonCode !== undefined && reasonCode !== null) codes.add(reasonCode);
    if (row.missingParent) codes.add('missing_parent');
    return [...codes];
  }

  protected canLoadDetail(row: RuntimeActivityRow): boolean {
    const activity = row.view.activity;
    return (
      activity.debugDetailId !== undefined &&
      activity.debugDetailId !== null &&
      activity.sessionId !== undefined &&
      activity.sessionId !== null &&
      (activity.kind === 'provider_request' || activity.kind === 'tool_call')
    );
  }

  protected async loadDetail(row: RuntimeActivityRow): Promise<void> {
    if (!this.canLoadDetail(row)) return;
    const activity = row.view.activity;
    const sessionId = activity.sessionId as string;
    const detailId = activity.debugDetailId as string;
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.detailValue.set(null);
    this.detailTitle.set(`${this.kindLabel(activity.kind)} · ${detailId}`);
    try {
      this.detailValue.set(
        activity.kind === 'provider_request'
          ? await this.chat.loadProviderRequestDebugDetail(sessionId, detailId)
          : await this.chat.loadToolCallDebugDetail(sessionId, detailId),
      );
    } catch (error) {
      this.detailError.set(errorMessage(error));
    } finally {
      this.detailLoading.set(false);
    }
  }

  protected async openSession(sessionId: string): Promise<void> {
    this.navigationError.set(null);
    try {
      await this.chat.selectSession(sessionId);
      this.topMenu.closePanel();
    } catch (error) {
      this.navigationError.set(errorMessage(error));
    }
  }

  protected openStopControls(): void {
    this.topMenu.openPanel(SERVICE_PANEL_ID);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

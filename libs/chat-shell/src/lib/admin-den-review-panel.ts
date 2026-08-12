import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { DenReviewOperatorStore } from '@rusty-view/chat-store';
import type { ReviewOperatorPipelineItem } from '@rusty-view/protocol';

@Component({
  selector: 'rv-admin-den-review-panel',
  templateUrl: './admin-den-review-panel.html',
  styleUrl: './admin-den-review-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDenReviewPanelComponent {
  protected readonly den = inject(DenReviewOperatorStore);
  protected readonly authorityId = signal('');
  protected readonly endpointRef = signal('');
  protected readonly auditIdentity = signal('');
  protected readonly pendingPrompt = signal<ReviewOperatorPipelineItem | null>(
    null,
  );
  protected readonly pendingPromptContext = signal<{
    projectId: string;
    deploymentRole: 'production' | 'debug';
  } | null>(null);

  constructor() {
    void this.den.refresh().then(() => this.resetConfigDraft());
  }

  protected setText(
    target: EventTarget | null,
    update: (value: string) => void,
  ): void {
    if (target instanceof HTMLInputElement) update(target.value);
  }

  protected refresh(): void {
    void this.den.refresh().then(() => this.resetConfigDraft());
  }

  protected changeProject(target: EventTarget | null): void {
    this.setText(target, (value) => this.den.setProjectId(value));
  }

  protected changeAuthorityId(target: EventTarget | null): void {
    this.setText(target, (value) => this.authorityId.set(value));
  }

  protected changeEndpointRef(target: EventTarget | null): void {
    this.setText(target, (value) => this.endpointRef.set(value));
  }

  protected changeAuditIdentity(target: EventTarget | null): void {
    this.setText(target, (value) => this.auditIdentity.set(value));
  }

  protected changeFilter(
    target: EventTarget | null,
    field: 'task' | 'state' | 'reviewer',
  ): void {
    this.setText(target, (value) => this.den.setFilters({ [field]: value }));
  }

  protected changeMinimumAge(target: EventTarget | null): void {
    this.setText(target, (value) =>
      this.den.setFilters({ minimumAgeMinutes: Number(value) }),
    );
  }

  protected changeFailuresOnly(target: EventTarget | null): void {
    if (target instanceof HTMLInputElement) {
      this.den.setFilters({ failuresOnly: target.checked });
    }
  }

  protected saveConfig(): void {
    const role = this.den.config()?.deploymentRole;
    if (role === undefined) return;
    void this.den.saveConfig({
      expectedConfigRevision: this.den.config()?.configRevision ?? '',
      authorityId: this.authorityId(),
      endpointRef: this.endpointRef(),
      auditIdentity: this.auditIdentity(),
      expectedDeploymentRole: role,
    });
  }

  protected confirmPrompt(item: ReviewOperatorPipelineItem): void {
    const deploymentRole = this.den.config()?.deploymentRole;
    if (deploymentRole === undefined) return;
    this.pendingPromptContext.set({
      projectId: item.projectId,
      deploymentRole,
    });
    this.pendingPrompt.set(item);
  }

  protected cancelPrompt(): void {
    const item = this.pendingPrompt();
    const context = this.pendingPromptContext();
    if (item !== null && context !== null)
      this.den.abandonPromptReviewer(item.taskId, context);
    this.pendingPrompt.set(null);
    this.pendingPromptContext.set(null);
  }

  protected sendPrompt(): void {
    const item = this.pendingPrompt();
    const context = this.pendingPromptContext();
    if (item === null || context === null) return;
    void this.den.promptReviewer(item.taskId, context).then((sent) => {
      if (sent) {
        this.pendingPrompt.set(null);
        this.pendingPromptContext.set(null);
      }
    });
  }

  protected page(offset: number | undefined): void {
    if (offset !== undefined) void this.den.refresh(offset);
  }

  protected previousOffset(offset: number, limit: number): number {
    return Math.max(0, offset - limit);
  }

  protected shortSha(item: ReviewOperatorPipelineItem): string {
    return item.submission?.commitSha?.slice(0, 12) ?? '-';
  }

  protected reviewerRouteReason(): string {
    const route = this.den.config()?.reviewerRoute;
    if (route === undefined) return 'Reviewer route has not been loaded';
    if (!route.routable)
      return route.reasonCode ?? 'Reviewer route is not routable';
    return `Will route to ${route.resolvedTarget?.displayLabel ?? route.resolvedTarget?.agentId ?? '@reviewer'} / ${route.resolvedTarget?.sessionId ?? 'unknown session'}`;
  }

  private resetConfigDraft(): void {
    const config = this.den.config();
    if (config === null) return;
    this.authorityId.set(config.authorityId ?? '');
    this.endpointRef.set(config.endpointRef ?? '');
    this.auditIdentity.set(config.auditIdentity ?? '');
  }
}

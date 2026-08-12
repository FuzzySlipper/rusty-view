import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { DenReviewOperatorStore } from '@rusty-view/chat-store';
import type { ReviewOperatorPipelineItem } from '@rusty-view/protocol';

type ReviewStatusTone =
  | 'attention'
  | 'failure'
  | 'neutral'
  | 'success'
  | 'waiting';

interface ReviewStatusPresentation {
  readonly label: string;
  readonly nextAction: string;
  readonly tone: ReviewStatusTone;
}

const REVIEW_STAGE_PRESENTATIONS: Readonly<
  Record<string, ReviewStatusPresentation>
> = {
  den_reviewable_not_submitted: {
    label: 'Ready to submit',
    nextAction: 'Submit it for managed review when ready.',
    tone: 'attention',
  },
  managed_submission_accepted: {
    label: 'Preparing review',
    nextAction: 'Waiting for the review handoff.',
    tone: 'waiting',
  },
  github_gate_pending: {
    label: 'Waiting for checks',
    nextAction: 'No action — GitHub checks are running.',
    tone: 'waiting',
  },
  den_gate_pending: {
    label: 'Waiting for checks',
    nextAction: 'No action — the Den gate is still running.',
    tone: 'waiting',
  },
  den_gate_passed: {
    label: 'Checks passed',
    nextAction: 'Waiting for review to continue.',
    tone: 'waiting',
  },
  reviewer_delivery_queued: {
    label: 'Queued for reviewer',
    nextAction: 'Waiting to send the review request.',
    tone: 'waiting',
  },
  reviewer_delivery_retrying: {
    label: 'Reviewer delivery retrying',
    nextAction: 'Check the reviewer route if the next retry also fails.',
    tone: 'attention',
  },
  reviewer_dispatched: {
    label: 'Sent to reviewer',
    nextAction: 'Waiting for the reviewer verdict.',
    tone: 'waiting',
  },
  den_review_round_open: {
    label: 'Review in progress',
    nextAction: 'Waiting for the reviewer verdict.',
    tone: 'waiting',
  },
  den_finalization_pending: {
    label: 'Saving review result',
    nextAction: 'Waiting for Den finalization.',
    tone: 'waiting',
  },
  review_complete_reply_pending: {
    label: 'Review complete',
    nextAction: 'Waiting to notify the requester.',
    tone: 'waiting',
  },
};

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

  protected statusLabel(item: ReviewOperatorPipelineItem): string {
    return reviewStatusPresentation(item).label;
  }

  protected statusNextAction(item: ReviewOperatorPipelineItem): string {
    return reviewStatusPresentation(item).nextAction;
  }

  protected statusTone(item: ReviewOperatorPipelineItem): ReviewStatusTone {
    return reviewStatusPresentation(item).tone;
  }

  protected reviewerDeliveryStatus(item: ReviewOperatorPipelineItem): string {
    const submission = item.submission;
    if (submission === undefined) return 'Not a managed submission';
    const failedAttempts = submission.reviewerDispatchAttempts ?? 0;
    if (failedAttempts > 0) {
      const attemptLabel = `${failedAttempts} failed ${failedAttempts === 1 ? 'attempt' : 'attempts'}`;
      return submission.reviewerDispatchNextRetryAt == null
        ? `${attemptLabel}; no retry scheduled`
        : `${attemptLabel}; retry ${submission.reviewerDispatchNextRetryAt}`;
    }
    if (submission.dispatchDeliveryId !== undefined) return 'Delivered';
    if (submission.phase === 'reviewer_dispatch_pending')
      return 'Waiting to send';
    return 'No delivery failures';
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

function reviewStatusPresentation(
  item: ReviewOperatorPipelineItem,
): ReviewStatusPresentation {
  const submission = item.submission;
  const verdict = submission?.reviewVerdict;
  const terminalReason = submission?.terminalReason;

  if (
    item.stage === 'superseded' ||
    item.stage === 'den_gate_superseded' ||
    submission?.gateStatus === 'superseded'
  ) {
    return {
      label: 'Superseded',
      nextAction: 'No action — use the newer submission.',
      tone: 'neutral',
    };
  }

  if (item.stage === 'review_terminal') {
    if (verdict === 'looks_good') return approvedStatus();
    if (verdict === 'changes_requested') return changesRequestedStatus();
    if (
      terminalReason === 'checks_failed' ||
      submission?.gateStatus === 'failed'
    ) {
      return checksFailedStatus();
    }
    return {
      label: 'Review ended',
      nextAction: 'Inspect diagnostics to determine the outcome.',
      tone: 'attention',
    };
  }

  if (item.stage === 'review_complete_replied') {
    if (verdict === 'looks_good') return approvedStatus();
    if (verdict === 'changes_requested') return changesRequestedStatus();
    return {
      label: 'Review complete',
      nextAction: 'No pipeline action needed.',
      tone: 'success',
    };
  }

  if (item.stage === 'reply_terminal') {
    return {
      label: 'Notification failed',
      nextAction:
        'The review finished; inspect requester delivery diagnostics.',
      tone: 'failure',
    };
  }

  if (item.stage === 'github_gate_failed' || item.stage === 'den_gate_failed') {
    return checksFailedStatus();
  }
  if (
    item.stage === 'github_gate_timed_out' ||
    item.stage === 'den_gate_timed_out'
  ) {
    return {
      label: 'Checks timed out',
      nextAction: 'Inspect the GitHub gate before retrying.',
      tone: 'failure',
    };
  }

  return (
    REVIEW_STAGE_PRESENTATIONS[item.stage] ?? {
      label: 'Needs inspection',
      nextAction: 'Inspect diagnostics for the internal pipeline state.',
      tone: 'attention',
    }
  );
}

function approvedStatus(): ReviewStatusPresentation {
  return {
    label: 'Approved',
    nextAction: 'No review action needed.',
    tone: 'success',
  };
}

function changesRequestedStatus(): ReviewStatusPresentation {
  return {
    label: 'Changes requested',
    nextAction: 'Address the findings, then submit the new commit.',
    tone: 'attention',
  };
}

function checksFailedStatus(): ReviewStatusPresentation {
  return {
    label: 'Checks failed',
    nextAction: 'Fix the failing checks, then submit a new commit.',
    tone: 'failure',
  };
}

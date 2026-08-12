import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  ReviewOperatorConfigReadback,
  ReviewOperatorConfigWrite,
  ReviewOperatorPipelineItem,
  ReviewOperatorPipelinePage,
  ReviewOperatorPromptReceipt,
} from '@rusty-view/protocol';
import { ChatTransport } from '@rusty-view/transport';
import { storeErrorMessage } from './store-error';

export interface ReviewPipelineFilters {
  readonly task: string;
  readonly state: string;
  readonly reviewer: string;
  readonly failuresOnly: boolean;
  readonly minimumAgeMinutes: number;
}

const EMPTY_FILTERS: ReviewPipelineFilters = {
  task: '',
  state: '',
  reviewer: '',
  failuresOnly: false,
  minimumAgeMinutes: 0,
};

@Injectable()
export class DenReviewOperatorStore {
  private readonly transport = inject(ChatTransport);
  private readonly _config = signal<ReviewOperatorConfigReadback | null>(null);
  private readonly _pipeline = signal<ReviewOperatorPipelinePage | null>(null);
  private readonly _projectId = signal('rusty-view');
  private readonly _filters = signal<ReviewPipelineFilters>(EMPTY_FILTERS);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _lastSuccessfulRefresh = signal<string | null>(null);
  private readonly _promptReceipt = signal<ReviewOperatorPromptReceipt | null>(
    null,
  );
  private readonly pendingPromptIdentities = new Map<string, string>();

  readonly config = this._config.asReadonly();
  readonly pipeline = this._pipeline.asReadonly();
  readonly projectId = this._projectId.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();
  readonly lastSuccessfulRefresh = this._lastSuccessfulRefresh.asReadonly();
  readonly promptReceipt = this._promptReceipt.asReadonly();
  readonly filteredItems = computed(() =>
    filterPipelineItems(this._pipeline()?.items ?? [], this._filters()),
  );

  async refresh(offset = 0): Promise<void> {
    if (this._loading()) return;
    this._loading.set(true);
    this._error.set(null);
    try {
      const role = this.transport.getConfig().coordinationRole;
      const config =
        await this.transport.external.readReviewOperatorConfig(role);
      this._config.set(config);
      const pipeline = await this.transport.external.readReviewOperatorPipeline(
        {
          projectId: this._projectId(),
          limit: 100,
          offset,
          expectedDeploymentRole: config.deploymentRole,
        },
      );
      this._pipeline.set(pipeline);
      this._lastSuccessfulRefresh.set(new Date().toISOString());
    } catch (error) {
      this._error.set(storeErrorMessage(error));
    } finally {
      this._loading.set(false);
    }
  }

  async saveConfig(request: ReviewOperatorConfigWrite): Promise<boolean> {
    if (this._saving()) return false;
    this._saving.set(true);
    this._error.set(null);
    try {
      const result =
        await this.transport.external.writeReviewOperatorConfig(request);
      this._config.set(result.config);
      await this.refresh();
      return true;
    } catch (error) {
      this._error.set(storeErrorMessage(error));
      return false;
    } finally {
      this._saving.set(false);
    }
  }

  async promptReviewer(taskId: number): Promise<boolean> {
    const config = this._config();
    if (config === null || this._saving()) return false;
    this._saving.set(true);
    this._error.set(null);
    try {
      const actionKey = `${config.deploymentRole}:${this._projectId()}:${taskId}`;
      const identity =
        this.pendingPromptIdentities.get(actionKey) ??
        `${config.deploymentRole}:${this._projectId()}:${taskId}:${globalThis.crypto.randomUUID()}`;
      this.pendingPromptIdentities.set(actionKey, identity);
      const result = await this.transport.external.promptReviewerForTask(
        taskId,
        {
          ttlMs: 300_000,
          correlationId: `review-operator:${identity}`,
          idempotencyKey: `review-operator:${identity}`,
          expectedDeploymentRole: config.deploymentRole,
        },
      );
      this._promptReceipt.set(result);
      this.pendingPromptIdentities.delete(actionKey);
      return true;
    } catch (error) {
      this._error.set(storeErrorMessage(error));
      return false;
    } finally {
      this._saving.set(false);
    }
  }

  setProjectId(projectId: string): void {
    this._projectId.set(projectId.trim());
  }

  setFilters(filters: Partial<ReviewPipelineFilters>): void {
    this._filters.update((current) => ({ ...current, ...filters }));
  }
}

export function filterPipelineItems(
  items: readonly ReviewOperatorPipelineItem[],
  filters: ReviewPipelineFilters,
  nowMs = Date.now(),
): readonly ReviewOperatorPipelineItem[] {
  const normalizedTask = filters.task.trim().toLowerCase();
  const normalizedState = filters.state.trim().toLowerCase();
  const normalizedReviewer = filters.reviewer.trim().toLowerCase();
  return items.filter((item) => {
    const submission = item.submission;
    const ageSource = submission?.updatedAt ?? item.task?.['updated_at'];
    const ageMinutes =
      typeof ageSource === 'string'
        ? Math.max(0, (nowMs - Date.parse(ageSource)) / 60_000)
        : 0;
    const taskText =
      `${item.taskId} ${String(item.task?.['title'] ?? '')}`.toLowerCase();
    const reviewer = String(submission?.reviewer ?? '').toLowerCase();
    const failureText = [
      item.stage,
      submission?.lastAdapterError,
      submission?.terminalReason,
      submission?.replyReasonCode,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const hasFailure =
      submission?.lastAdapterError !== undefined ||
      submission?.terminalReason !== undefined ||
      /fail|error|terminal|timed_out/.test(failureText);
    return (
      (!normalizedTask || taskText.includes(normalizedTask)) &&
      (!normalizedState ||
        item.stage.toLowerCase().includes(normalizedState)) &&
      (!normalizedReviewer || reviewer.includes(normalizedReviewer)) &&
      (!filters.failuresOnly || hasFailure) &&
      ageMinutes >= filters.minimumAgeMinutes
    );
  });
}

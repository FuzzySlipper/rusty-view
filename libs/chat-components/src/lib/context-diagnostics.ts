import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { SessionContextUsageResult } from '@rusty-view/protocol';
import type { ContextTimelineEntry } from '@rusty-view/chat-domain';

/** A single label/value row in a diagnostics section. */
export interface ContextDiagnosticsRow {
  readonly label: string;
  readonly value: string;
}

/** A diagnostics severity row (degraded reasons / caveats). */
export interface ContextDiagnosticRow {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
}

/** A rendered context status/compaction timeline row. */
export interface ContextTimelineRow {
  readonly id: string;
  readonly kindLabel: string;
  readonly kindClass: string;
  readonly detail: string;
}

/**
 * Presentational context diagnostics panel (tasks #3788/#3846/#3847).
 *
 * Renders the browser-safe model/provider/brain + context-usage snapshot from
 * `GET /v1/chat/sessions/{id}/context`, the session's current context-strategy
 * policy, the latest compaction artifact metadata, and a timeline of the four
 * `context_*` status/compaction events as UI/debug rows (visually distinct from
 * assistant transcript content).
 *
 * Pure presentational: no service injection, no store access. The shell passes
 * the usage snapshot + timeline and handles `refresh`. No values are baked in —
 * strategy ids, thresholds, and provider details all come from the backend.
 */
@Component({
  selector: 'rv-context-diagnostics',
  templateUrl: './context-diagnostics.html',
  styleUrl: './context-diagnostics.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextDiagnosticsComponent {
  readonly usage = input<SessionContextUsageResult | null>(null);
  readonly timeline = input<readonly ContextTimelineEntry[]>([]);
  readonly loading = input<boolean>(false);
  readonly refresh = output<void>();

  protected readonly providerRows = computed<readonly ContextDiagnosticsRow[]>(
    () => {
      const provider = this.usage()?.provider;
      if (provider === undefined) return [];
      return compact([
        row('Alias', provider.alias),
        row('Status', provider.status),
        row('Model', provider.model_id),
        row('Protocol', provider.protocol),
        row('Provider kind', provider.provider_kind),
        row('Base URL host', provider.base_url_host),
        row('Base URL', provider.base_url_redacted),
        row('Context window', formatTokens(provider.context_window_tokens)),
        row('Max output tokens', formatTokens(provider.max_output_tokens)),
        row('Temperature', formatNumber(provider.temperature)),
        row('Reasoning effort', provider.reasoning_effort),
        row('Reasoning format', provider.reasoning_format),
        row(
          'Configured Chat Completions dialect',
          provider.chat_completions_dialect,
        ),
        row('Configured thinking mode', provider.thinking_mode),
        row('Configured reasoning history', provider.reasoning_history),
        row(
          'Configured reasoning budget',
          formatTokens(provider.reasoning_budget_tokens),
        ),
        row(
          'Thinking settings applied',
          formatBoolean(provider.thinking_settings_applied),
        ),
        row(
          'Thinking mode applied',
          formatBoolean(provider.thinking_mode_applied),
        ),
        row(
          'Reasoning history applied',
          formatBoolean(provider.reasoning_history_applied),
        ),
        row(
          'Reasoning budget applied',
          formatBoolean(provider.reasoning_budget_applied),
        ),
      ]);
    },
  );

  protected readonly brainRows = computed<readonly ContextDiagnosticsRow[]>(
    () => {
      const brain = this.usage()?.brain;
      if (brain === undefined) return [];
      return compact([
        row('Backend', brain.backend),
        row('Module', brain.module),
        row('Strategy', brain.strategy),
      ]);
    },
  );

  protected readonly estimateRows = computed<readonly ContextDiagnosticsRow[]>(
    () => {
      const context = this.usage()?.context;
      if (context === undefined) return [];
      return compact([
        row('Estimate quality', context.estimate_quality),
        row('Estimate method', context.estimate_method),
        row('Estimator', context.estimator_id),
        row('Context window', formatTokens(context.context_window_tokens)),
        row('Estimated used', formatTokens(context.estimated_prompt_tokens)),
        row(
          'Estimated remaining',
          formatTokens(context.estimated_remaining_tokens),
        ),
        row('Max response tokens', formatTokens(context.max_output_tokens)),
        row(
          'Reserved response tokens',
          formatTokens(context.reserved_response_tokens),
        ),
        row('Safety margin', formatTokens(context.safety_margin_tokens)),
        row('Usable input tokens', formatTokens(context.usable_input_tokens)),
        row('Sampled events', formatTokens(context.sampled_event_count)),
        row('Sampled messages', formatTokens(context.sampled_message_count)),
      ]);
    },
  );

  /** Fill percentage (used / window), when both are known. */
  protected readonly fillPercent = computed<number | null>(() => {
    const context = this.usage()?.context;
    if (context === undefined) return null;
    const window = context.context_window_tokens;
    const used = context.estimated_prompt_tokens;
    if (window === undefined || used === undefined || window <= 0 || used < 0) {
      return null;
    }
    return Math.min(100, Math.round((used / window) * 100));
  });

  protected readonly strategyRows = computed<readonly ContextDiagnosticsRow[]>(
    () => {
      const strategy = this.usage()?.context_strategy;
      if (strategy === undefined) return [];
      return compact([
        row('Strategy id', strategy.strategy_id),
        row('Enabled', formatBoolean(strategy.enabled)),
        row('Auto-compaction', formatBoolean(strategy.auto_compaction_enabled)),
        row('Compact at', formatPercent(strategy.compact_at_percent)),
        row(
          'Target after compaction',
          formatPercent(strategy.target_percent_after_compaction),
        ),
        row(
          'Max context for wake',
          formatPercent(strategy.max_context_percent_for_wake),
        ),
        row('Debug visibility', strategy.debug_visibility),
        row(
          'Debug events in model context',
          formatBoolean(strategy.include_debug_events_in_model_context),
        ),
      ]);
    },
  );

  protected readonly artifactRows = computed<readonly ContextDiagnosticsRow[]>(
    () => {
      const artifact = this.usage()?.latest_compaction_artifact;
      if (artifact === undefined) return [];
      return compact([
        row('Artifact id', artifact.artifact_id),
        row('Strategy id', artifact.strategy_id),
        row('Branch id', artifact.branch_id),
        row(
          'Enters future context',
          formatBoolean(artifact.enters_future_context),
        ),
        row('Context policy', artifact.context_policy),
        row('Created', artifact.created_at),
        row('Updated', artifact.updated_at),
      ]);
    },
  );

  protected readonly diagnostics = computed<readonly ContextDiagnosticRow[]>(
    () => this.usage()?.diagnostics ?? [],
  );

  protected readonly degraded = computed<boolean>(
    () => this.usage()?.degraded === true,
  );

  protected readonly timelineRows = computed<readonly ContextTimelineRow[]>(
    () =>
      // Newest first so the most recent status is at the top.
      [...this.timeline()].reverse().map((entry) => ({
        id: entry.id,
        kindLabel: TIMELINE_KIND_LABELS[entry.kind],
        kindClass: `rv-context-timeline__kind--${entry.kind}`,
        detail: timelineDetail(entry),
      })),
  );

  protected onRefresh(): void {
    this.refresh.emit();
  }
}

const TIMELINE_KIND_LABELS: Record<ContextTimelineEntry['kind'], string> = {
  status: 'status',
  compaction_started: 'compaction started',
  compaction_completed: 'compaction completed',
  compaction_failed: 'compaction failed',
};

function timelineDetail(entry: ContextTimelineEntry): string {
  const parts: string[] = [];
  if (entry.strategyId !== '') parts.push(entry.strategyId);
  if (entry.fillPercent !== undefined) parts.push(`${entry.fillPercent}% full`);
  if (entry.estimateQuality !== undefined) parts.push(entry.estimateQuality);
  if (entry.compactAtPercent !== undefined) {
    parts.push(`compact@${entry.compactAtPercent}%`);
  }
  if (entry.targetPercentAfterCompaction !== undefined) {
    parts.push(`target ${entry.targetPercentAfterCompaction}%`);
  }
  if (entry.reasonCode !== undefined) parts.push(entry.reasonCode);
  return parts.join(' · ');
}

function row(label: string, value: string | undefined): ContextDiagnosticsRow {
  return { label, value: value ?? '—' };
}

/** Keep only rows that carry a real value (drops the `—` placeholders). */
function compact(
  rows: readonly ContextDiagnosticsRow[],
): readonly ContextDiagnosticsRow[] {
  return rows.filter((entry) => entry.value !== '—');
}

function formatTokens(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toLocaleString();
}

function formatNumber(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function formatPercent(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}%`;
}

function formatBoolean(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'yes' : 'no';
}

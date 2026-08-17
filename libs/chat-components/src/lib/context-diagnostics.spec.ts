import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type {
  LogicalTurnDiagnostic,
  SessionContextUsageResult,
} from '@rusty-view/protocol';
import type { ContextTimelineEntry } from '@rusty-view/chat-domain';

import { ContextDiagnosticsComponent } from './context-diagnostics';

function usageFixture(
  overrides: Partial<SessionContextUsageResult> = {},
): SessionContextUsageResult {
  return {
    session_id: 'sess_1',
    agent_id: 'agent_1',
    profile_id: 'prof_1',
    provider: {
      alias: 'main',
      model_config_id: 'config-gpt-x',
      endpoint_id: 'endpoint-openai',
      provider_alias: 'legacy-main',
      status: 'active',
      model_id: 'gpt-x',
      chat_completions_dialect: 'qwen',
      thinking_mode: 'enabled',
      reasoning_history: 'preserve_all',
      reasoning_budget_tokens: 8192,
      thinking_settings_applied: true,
      thinking_mode_applied: true,
      reasoning_history_applied: true,
      reasoning_budget_applied: true,
    },
    brain: { backend: 'openai' },
    context_strategy: {
      strategy_id: 'sliding-window',
      enabled: true,
      auto_compaction_enabled: true,
      compact_at_percent: 80,
      target_percent_after_compaction: 40,
      max_context_percent_for_wake: 90,
      debug_visibility: 'status',
      include_debug_events_in_model_context: false,
    },
    tools: { tool_count: 2, mcp_binding_count: 1, mcp_active_count: 1 },
    context: {
      estimate_quality: 'approximate',
      estimate_method: 'sampled',
      estimator_id: 'tok-1',
      context_window_tokens: 1000,
      estimated_prompt_tokens: 250,
      estimated_remaining_tokens: 750,
      max_output_tokens: 400,
      sampled_event_count: 5,
      sampled_message_count: 3,
    },
    degraded: false,
    diagnostics: [],
    ...overrides,
  };
}

function timelineEntry(
  overrides: Partial<ContextTimelineEntry> = {},
): ContextTimelineEntry {
  return {
    id: 'c1',
    kind: 'status',
    sessionId: 'sess_1',
    wakeId: undefined,
    strategyId: 'sliding-window',
    estimateQuality: 'approximate',
    fillPercent: 25,
    compactAtPercent: 80,
    targetPercentAfterCompaction: 40,
    artifactId: undefined,
    reasonCode: undefined,
    createdAt: '2026-06-30T10:00:00Z',
    ...overrides,
  };
}

async function createComponent() {
  await TestBed.configureTestingModule({
    imports: [ContextDiagnosticsComponent],
  }).compileComponents();
  return TestBed.createComponent(ContextDiagnosticsComponent);
}

describe('ContextDiagnosticsComponent', () => {
  it('shows an empty state when no usage is present', async () => {
    const fixture = await createComponent();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'No context diagnostics available',
    );
  });

  it('renders provider, strategy, and estimate fields from the backend', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('usage', usageFixture());
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('gpt-x');
    expect(text).toContain('config-gpt-x');
    expect(text).toContain('endpoint-openai');
    expect(text).toContain('Legacy provider_alias (compatibility)');
    expect(text).toContain('legacy-main');
    expect(text).toContain('sliding-window');
    expect(text).toContain('approximate');
    // Compaction thresholds come straight from the backend, not constants.
    expect(text).toContain('80%');
    expect(text).toContain('40%');
  });

  it('labels a legacy-only provider alias as compatibility identity', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput(
      'usage',
      usageFixture({
        provider: {
          alias: 'legacy-only',
          status: 'active',
          model_id: 'legacy-model',
        },
      }),
    );
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).not.toContain('Model configuration');
    expect(text).toContain('Legacy provider_alias (compatibility)');
    expect(text).toContain('legacy-only');
  });

  it('distinguishes configured reasoning controls from applied states', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('usage', usageFixture());
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Configured Chat Completions dialect');
    expect(text).toContain('qwen');
    expect(text).toContain('Configured thinking mode');
    expect(text).toContain('enabled');
    expect(text).toContain('Configured reasoning history');
    expect(text).toContain('preserve_all');
    expect(text).toContain('Configured reasoning budget');
    expect(text).toContain('8,192');
    expect(text).toContain('Thinking settings applied');
    expect(text).toContain('Thinking mode applied');
    expect(text).toContain('Reasoning history applied');
    expect(text).toContain('Reasoning budget applied');
  });

  it('renders explicit not-applied states instead of dropping false values', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput(
      'usage',
      usageFixture({
        provider: {
          alias: 'standard',
          status: 'active',
          protocol: 'chat_completions',
          chat_completions_dialect: 'standard',
          thinking_mode: 'provider_default',
          reasoning_history: 'provider_default',
          thinking_settings_applied: false,
          thinking_mode_applied: false,
          reasoning_history_applied: false,
          reasoning_budget_applied: false,
        },
      }),
    );
    fixture.detectChanges();

    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.rv-context__row',
      ),
    ).map((row) => row.textContent ?? '');
    expect(
      rows.find((row) => row.includes('Thinking settings applied')),
    ).toContain('no');
    expect(rows.find((row) => row.includes('Thinking mode applied'))).toContain(
      'no',
    );
    expect(
      rows.find((row) => row.includes('Reasoning history applied')),
    ).toContain('no');
    expect(
      rows.find((row) => row.includes('Reasoning budget applied')),
    ).toContain('no');
  });

  it('computes a fill percentage from used/window tokens', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('usage', usageFixture());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('25% full');
  });

  it('prefers the native admission fill percentage used for compaction', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput(
      'usage',
      usageFixture({
        native_snapshot: {
          schemaVersion: 1,
          provider: {},
          promptProjection: {},
          reservedOutput: {},
          admission: { fillPercent: 57 },
          providerUsage: {},
          durableTranscript: {},
          providerState: {},
          compaction: {},
          diagnostics: [],
        },
      }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('57% full');
    expect(fixture.nativeElement.textContent).not.toContain('25% full');
  });

  it('renders the degraded badge and diagnostics when degraded', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput(
      'usage',
      usageFixture({
        degraded: true,
        diagnostics: [
          { severity: 'warning', code: 'estimate_stale', message: 'Stale' },
        ],
      }),
    );
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('degraded');
    expect(text).toContain('estimate_stale');
  });

  it('renders context status events as timeline rows, newest first', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('timeline', [
      timelineEntry({ id: 'c1', fillPercent: 10 }),
      timelineEntry({
        id: 'c2',
        kind: 'compaction_completed',
        fillPercent: 35,
      }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll(
      '.rv-context-timeline__row',
    );
    expect(rows.length).toBe(2);
    // Newest (c2) first.
    expect(rows[0].textContent).toContain('compaction completed');
  });

  it('emits refresh when the refresh button is clicked', async () => {
    const fixture = await createComponent();
    fixture.detectChanges();
    let refreshed = 0;
    fixture.componentInstance.refresh.subscribe(() => (refreshed += 1));

    fixture.nativeElement.querySelector('.rv-context__refresh').click();
    expect(refreshed).toBe(1);
  });

  it('renders logical-turn progress and emits operator controls', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('logicalTurns', [logicalTurnFixture()]);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('paused_for_attention');
    expect(text).toContain('Provider operations');
    expect(text).toContain('6');

    let cancelled = 0;
    let resolution = '';
    fixture.componentInstance.cancelLogicalTurn.subscribe(
      () => (cancelled += 1),
    );
    fixture.componentInstance.resolveLogicalTurn.subscribe(
      (action) => (resolution = action),
    );
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.rv-context__turn-controls button',
      ) as NodeListOf<HTMLButtonElement>,
    );
    buttons[0]?.click();
    buttons[1]?.click();
    expect(cancelled).toBe(1);
    expect(resolution).toBe('retry_unchanged');
  });
});

function logicalTurnFixture(): LogicalTurnDiagnostic {
  return {
    logicalTurnId: 'turn_1',
    sessionId: 'sess_1',
    sourceWakeId: 'wake_1',
    phase: 'attention_required',
    operatorState: 'paused_for_attention',
    currentContinuationId: 'continuation_3',
    continuationCount: 3,
    providerRequestTotal: 6,
    toolRoundTotal: 4,
    progressClassification: 'attention_required',
    progress: {
      semanticRevision: 7,
      committedProviderOperations: 6,
      committedToolOperations: 4,
      committedProjectionCursor: 10,
      assistantContentBytes: 200,
      acceptedActionCount: 4,
      delegatedCompletionCount: 0,
      stateFingerprint: 'sha256:test',
      lastLivenessAt: '2026-07-30T00:00:00Z',
      lastSemanticProgressAt: '2026-07-30T00:00:00Z',
    },
    lastProgressAt: '2026-07-30T00:00:00Z',
    lastLivenessAt: '2026-07-30T00:00:00Z',
    reasonCode: 'provider_outcome_unknown',
    summary: 'Operator attention required.',
    attention: {
      reason: 'provider outcome unknown',
      reasonCode: 'provider_outcome_unknown',
      summary: 'Choose a recovery action.',
      requiredAt: '2026-07-30T00:00:00Z',
      retryUnchangedSafe: true,
      resolutionActions: ['retry_unchanged', 'cancel'],
    },
    revision: 7,
    admittedAt: '2026-07-30T00:00:00Z',
    updatedAt: '2026-07-30T00:00:00Z',
  };
}

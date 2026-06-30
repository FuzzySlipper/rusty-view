import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { SessionContextUsageResult } from '@rusty-view/protocol';
import type { ContextTimelineEntry } from '@rusty-view/chat-domain';

import { ContextDiagnosticsComponent } from './context-diagnostics';

function usageFixture(
  overrides: Partial<SessionContextUsageResult> = {},
): SessionContextUsageResult {
  return {
    session_id: 'sess_1',
    agent_id: 'agent_1',
    profile_id: 'prof_1',
    provider: { alias: 'main', status: 'active', model_id: 'gpt-x' },
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
    expect(text).toContain('sliding-window');
    expect(text).toContain('approximate');
    // Compaction thresholds come straight from the backend, not constants.
    expect(text).toContain('80%');
    expect(text).toContain('40%');
  });

  it('computes a fill percentage from used/window tokens', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('usage', usageFixture());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('25% full');
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
});

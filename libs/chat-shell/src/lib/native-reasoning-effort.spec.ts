import type { SessionContextUsageResult } from '@rusty-view/protocol';
import { describe, expect, it } from 'vitest';

import { formatNativeReasoningEffort } from './native-reasoning-effort';

const provider = (
  overrides: Partial<SessionContextUsageResult['provider']> = {},
): SessionContextUsageResult['provider'] => ({
  alias: 'main',
  status: 'active',
  model_id: 'crew-model',
  ...overrides,
});

describe('formatNativeReasoningEffort', () => {
  it('shows a session override and its provenance', () => {
    expect(
      formatNativeReasoningEffort(
        provider({
          reasoning_effort: 'high',
          reasoning_effort_source: 'session_override',
        }),
      ),
    ).toBe('high · session override');
  });

  it('distinguishes profile and provider defaults', () => {
    expect(
      formatNativeReasoningEffort(
        provider({
          reasoning_effort: 'medium',
          reasoning_effort_source: 'profile',
        }),
      ),
    ).toBe('medium · profile default');
    expect(
      formatNativeReasoningEffort(
        provider({
          reasoning_effort: 'low',
          reasoning_effort_source: 'provider_default',
        }),
      ),
    ).toBe('low · provider default');
  });

  it('makes unsupported or incomplete effort data explicit', () => {
    expect(formatNativeReasoningEffort(provider())).toBe('unavailable');
    expect(
      formatNativeReasoningEffort(
        provider({ reasoning_effort_source: 'provider_default' }),
      ),
    ).toBe('default · provider default');
    expect(formatNativeReasoningEffort(undefined)).toBe('unavailable');
  });
});

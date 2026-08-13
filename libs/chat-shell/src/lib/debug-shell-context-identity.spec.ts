import { describe, expect, it } from 'vitest';

import { nativeContextIdentity } from './debug-shell';

describe('nativeContextIdentity', () => {
  it('keeps normalized model configuration and legacy alias distinct', () => {
    expect(
      nativeContextIdentity({
        alias: 'config-main',
        model_config_id: 'config-main',
        provider_alias: 'legacy-main',
        status: 'active',
      }),
    ).toEqual({
      modelConfigId: 'config-main',
      legacyProviderAlias: 'legacy-main',
    });
  });

  it('labels the required alias fallback as compatibility-only', () => {
    expect(
      nativeContextIdentity({
        alias: 'legacy-only',
        status: 'active',
      }),
    ).toEqual({
      modelConfigId: undefined,
      legacyProviderAlias: 'legacy-only',
    });
  });
});

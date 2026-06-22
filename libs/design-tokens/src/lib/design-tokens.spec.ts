import { COLOR_TOKENS, DESIGN_TOKENS_VERSION } from '../index';

describe('@rusty-view/design-tokens public API', () => {
  it('exports a version marker and color token names', () => {
    expect(DESIGN_TOKENS_VERSION).toBe('0.0.0');
    expect(COLOR_TOKENS.bg).toBe('--rv-color-bg');
  });
});

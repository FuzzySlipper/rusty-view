import { COLOR_TOKENS, DESIGN_TOKENS_VERSION, LAYOUT_TOKENS } from '../index';

describe('@rusty-view/design-tokens public API', () => {
  it('exports a version marker and color token names', () => {
    expect(DESIGN_TOKENS_VERSION).toBe('0.0.0');
    expect(COLOR_TOKENS.bg).toBe('--rv-color-bg');
    expect(LAYOUT_TOKENS.chatWidth).toBe('--rv-chat-width');
    expect(LAYOUT_TOKENS.sidebarWidth).toBe('--rv-sidebar-width');
  });
});

import { CHAT_SHELL_VERSION } from '../index';

describe('@rusty-view/chat-shell public API', () => {
  it('exports a version marker', () => {
    expect(CHAT_SHELL_VERSION).toBe('0.0.0');
  });
});

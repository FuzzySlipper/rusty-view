import { CHAT_COMPONENTS_VERSION } from '../index';

describe('@rusty-view/chat-components public API', () => {
  it('exports a version marker', () => {
    expect(CHAT_COMPONENTS_VERSION).toBe('0.0.0');
  });
});

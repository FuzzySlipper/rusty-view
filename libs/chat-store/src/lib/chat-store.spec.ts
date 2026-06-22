import { CHAT_STORE_VERSION } from '../index';

describe('@rusty-view/chat-store public API', () => {
  it('exports a version marker', () => {
    expect(CHAT_STORE_VERSION).toBe('0.0.0');
  });
});

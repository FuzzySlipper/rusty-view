import { CHAT_DOMAIN_VERSION } from '../index';

describe('@rusty-view/chat-domain public API', () => {
  it('exports a version marker', () => {
    expect(CHAT_DOMAIN_VERSION).toBe('0.0.0');
  });
});

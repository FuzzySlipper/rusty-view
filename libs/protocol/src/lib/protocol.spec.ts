import { PROTOCOL_VERSION } from '../index';

describe('@rusty-view/protocol public API', () => {
  it('exports a version marker', () => {
    expect(PROTOCOL_VERSION).toBe('0.0.0');
  });
});

import { TRANSPORT_VERSION } from '../index';

describe('@rusty-view/transport public API', () => {
  it('exports a version marker', () => {
    expect(TRANSPORT_VERSION).toBe('0.0.0');
  });
});

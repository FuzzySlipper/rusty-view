import { TESTING_FIXTURES_VERSION } from '../index';

describe('@rusty-view/testing-fixtures public API', () => {
  it('exports a version marker', () => {
    expect(TESTING_FIXTURES_VERSION).toBe('0.0.0');
  });
});

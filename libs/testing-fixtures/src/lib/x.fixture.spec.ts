import { xFixture, xFixtures } from './x.fixture';

describe('xFixture', () => {
  it('exports a fixture and a frozen fixture list', () => {
    expect(xFixture).toBeDefined();
    expect(Array.isArray(xFixtures)).toBe(true);
    expect(Object.isFrozen(xFixtures)).toBe(true);
  });
});

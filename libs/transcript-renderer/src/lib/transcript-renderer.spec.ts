import { TRANSCRIPT_RENDERER_VERSION } from '../index';

describe('@rusty-view/transcript-renderer public API', () => {
  it('exports a version marker', () => {
    expect(TRANSCRIPT_RENDERER_VERSION).toBe('0.0.0');
  });
});

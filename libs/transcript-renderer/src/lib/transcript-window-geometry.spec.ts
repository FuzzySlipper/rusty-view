import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSCRIPT_ROW_ESTIMATE_PX,
  projectTranscriptWindowGeometry,
  TRANSCRIPT_WINDOW_ROW_COUNT,
} from './transcript-window-geometry';

describe('transcript window geometry', () => {
  it('bounds residency and projects conservative spacers', () => {
    const geometry = projectTranscriptWindowGeometry(1_000, 500);

    expect(geometry.end - geometry.start).toBe(TRANSCRIPT_WINDOW_ROW_COUNT);
    expect(geometry.topSpacerPx).toBe(
      geometry.start * DEFAULT_TRANSCRIPT_ROW_ESTIMATE_PX,
    );
    expect(geometry.bottomSpacerPx).toBe(
      (1_000 - geometry.end) * DEFAULT_TRANSCRIPT_ROW_ESTIMATE_PX,
    );
  });

  it('clamps the requested window to the logical tail', () => {
    expect(projectTranscriptWindowGeometry(100, 10_000)).toEqual({
      start: 36,
      end: 100,
      topSpacerPx: 36 * DEFAULT_TRANSCRIPT_ROW_ESTIMATE_PX,
      bottomSpacerPx: 0,
    });
  });
});

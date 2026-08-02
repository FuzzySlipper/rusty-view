/** Sole geometry policy for the bounded chronological transcript window. */
export const TRANSCRIPT_WINDOW_ROW_COUNT = 64;
export const DEFAULT_TRANSCRIPT_ROW_ESTIMATE_PX = 120;

export interface TranscriptWindowGeometry {
  readonly start: number;
  readonly end: number;
  readonly topSpacerPx: number;
  readonly bottomSpacerPx: number;
}

/**
 * Project a logical row range into one bounded resident window.
 *
 * Future row-specific estimates belong behind this function so renderer
 * features never grow independent spacer or scroll-offset correction paths.
 */
export function projectTranscriptWindowGeometry(
  rowCount: number,
  requestedStart: number,
): TranscriptWindowGeometry {
  const count = Math.max(0, rowCount);
  const maxStart = Math.max(0, count - TRANSCRIPT_WINDOW_ROW_COUNT);
  const start = Math.max(0, Math.min(maxStart, requestedStart));
  const end = Math.min(count, start + TRANSCRIPT_WINDOW_ROW_COUNT);
  return {
    start,
    end,
    topSpacerPx: start * DEFAULT_TRANSCRIPT_ROW_ESTIMATE_PX,
    bottomSpacerPx: (count - end) * DEFAULT_TRANSCRIPT_ROW_ESTIMATE_PX,
  };
}

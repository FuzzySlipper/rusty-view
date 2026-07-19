import type { ListRange } from '@angular/cdk/collections';

/**
 * Presentation switches known to change transcript row geometry.
 *
 * Actual row height is always measured. This key exists so inputs which can
 * change unrendered rows also invalidate CDK's estimate. Add future
 * presentation features which affect row height here rather than teaching the
 * tail-follow loop about individual renderers.
 */
export interface TranscriptGeometryPresentation {
  readonly autoExpandReasoning: boolean;
  readonly reasoningVisible: boolean;
  readonly toolsVisible: boolean;
  readonly revisionActionsVisible: boolean;
  readonly alternateSlotCount: number;
}

/** One coherent read of the CDK virtual-scroll geometry. */
export interface TranscriptGeometryMeasurement {
  readonly dataLength: number;
  readonly renderedRange: ListRange;
  readonly viewportSize: number;
  readonly scrollOffset: number;
  readonly scrollSize: number;
  /** Authoritative total reported by CDK's spacer element. */
  readonly totalContentSize: number;
  /** Measured start of the rendered-content wrapper in scroll coordinates. */
  readonly renderedContentOffset: number;
  readonly renderedContentSize: number;
}

export interface TranscriptGeometryAssessment {
  readonly tailRangeMaterialized: boolean;
  readonly renderedContentEnd: number;
  readonly tailEndMismatch: number;
  readonly tailEndCoherent: boolean;
  /** Blank pixels between the viewport start and the first rendered tail row. */
  readonly tailViewportCoverageGap: number;
  readonly tailViewportCovered: boolean;
  readonly coherent: boolean;
  readonly correctedRenderedContentOffset: number;
}

export function transcriptGeometryPresentationKey(
  presentation: TranscriptGeometryPresentation,
): string {
  return [
    presentation.autoExpandReasoning,
    presentation.reasoningVisible,
    presentation.toolsVisible,
    presentation.revisionActionsVisible,
    presentation.alternateSlotCount,
  ].join(':');
}

/**
 * Compare the independently positioned wrapper with CDK's total-size spacer.
 *
 * When the rendered range contains the data tail, both must end at the same
 * scroll coordinate. A mismatch is the stale-wrapper failure which creates a
 * large blank region even though CDK's spacer has already corrected its size.
 */
export function assessTranscriptGeometry(
  measurement: TranscriptGeometryMeasurement,
  tolerancePx = 2,
): TranscriptGeometryAssessment {
  const tailRangeMaterialized =
    measurement.dataLength === 0 ||
    measurement.renderedRange.end === measurement.dataLength;
  const renderedContentEnd =
    measurement.renderedContentOffset + measurement.renderedContentSize;
  const tailEndMismatch = renderedContentEnd - measurement.totalContentSize;
  const tailEndCoherent =
    !tailRangeMaterialized || Math.abs(tailEndMismatch) <= tolerancePx;
  const tailViewportCoverageGap =
    tailRangeMaterialized &&
    measurement.renderedRange.start > 0 &&
    measurement.totalContentSize > measurement.viewportSize
      ? Math.max(
          0,
          measurement.renderedContentOffset - measurement.scrollOffset,
        )
      : 0;
  const tailViewportCovered = tailViewportCoverageGap <= tolerancePx;

  return {
    tailRangeMaterialized,
    renderedContentEnd,
    tailEndMismatch,
    tailEndCoherent,
    tailViewportCoverageGap,
    tailViewportCovered,
    coherent: tailEndCoherent && tailViewportCovered,
    correctedRenderedContentOffset: Math.max(
      0,
      measurement.totalContentSize - measurement.renderedContentSize,
    ),
  };
}

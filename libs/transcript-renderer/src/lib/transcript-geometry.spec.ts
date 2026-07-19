import { describe, expect, it } from 'vitest';

import {
  assessTranscriptGeometry,
  transcriptGeometryPresentationKey,
  type TranscriptGeometryMeasurement,
} from './transcript-geometry';

describe('transcript geometry', () => {
  it('repairs the captured stale-wrapper geometry without changing CDK total size', () => {
    const captured: TranscriptGeometryMeasurement = {
      dataLength: 121,
      renderedRange: { start: 101, end: 121 },
      viewportSize: 1_311,
      scrollOffset: 21_365.1,
      scrollSize: 36_281,
      totalContentSize: 20_248.8,
      renderedContentOffset: 31_705,
      renderedContentSize: 4_575.6,
    };

    const result = assessTranscriptGeometry(captured);

    expect(result.tailRangeMaterialized).toBe(true);
    expect(result.coherent).toBe(false);
    expect(result.tailEndCoherent).toBe(false);
    expect(result.renderedContentEnd).toBeCloseTo(36_280.6);
    expect(result.tailEndMismatch).toBeCloseTo(16_031.8);
    expect(result.correctedRenderedContentOffset).toBeCloseTo(15_673.2);
  });

  it('leaves a coherent materialized tail unchanged', () => {
    const result = assessTranscriptGeometry({
      dataLength: 20,
      renderedRange: { start: 8, end: 20 },
      viewportSize: 800,
      scrollOffset: 1_200,
      scrollSize: 2_000,
      totalContentSize: 2_000,
      renderedContentOffset: 1_200,
      renderedContentSize: 800,
    });

    expect(result.coherent).toBe(true);
    expect(result.tailViewportCovered).toBe(true);
    expect(result.tailEndMismatch).toBe(0);
    expect(result.correctedRenderedContentOffset).toBe(1_200);
  });

  it('detects the captured one-row tail when a biased average leaves the viewport blank', () => {
    const captured: TranscriptGeometryMeasurement = {
      dataLength: 121,
      renderedRange: { start: 120, end: 121 },
      viewportSize: 1_311,
      scrollOffset: 21_640,
      scrollSize: 22_951,
      totalContentSize: 22_951,
      renderedContentOffset: 22_778.9,
      renderedContentSize: 172.1,
    };

    const result = assessTranscriptGeometry(captured);

    expect(result.tailEndCoherent).toBe(true);
    expect(result.tailViewportCovered).toBe(false);
    expect(result.tailViewportCoverageGap).toBeCloseTo(1_138.9);
    expect(result.coherent).toBe(false);
  });

  it('centralizes presentation inputs which can invalidate height estimates', () => {
    const collapsed = transcriptGeometryPresentationKey({
      autoExpandReasoning: false,
      reasoningVisible: true,
      toolsVisible: true,
      revisionActionsVisible: true,
      alternateSlotCount: 0,
    });
    const expanded = transcriptGeometryPresentationKey({
      autoExpandReasoning: true,
      reasoningVisible: true,
      toolsVisible: true,
      revisionActionsVisible: true,
      alternateSlotCount: 0,
    });

    expect(expanded).not.toBe(collapsed);
  });
});

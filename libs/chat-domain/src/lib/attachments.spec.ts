import { attachmentKindForMimeType } from '../index';

import { describe, expect, it } from 'vitest';

describe('attachments', () => {
  it('classifies common media mime types', () => {
    expect(attachmentKindForMimeType('image/png')).toBe('image');
    expect(attachmentKindForMimeType('audio/mpeg')).toBe('audio');
    expect(attachmentKindForMimeType('video/mp4')).toBe('video');
    expect(attachmentKindForMimeType('application/pdf')).toBe('file');
    expect(attachmentKindForMimeType(undefined)).toBe('file');
  });
});

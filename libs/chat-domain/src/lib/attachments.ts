import type { AttachmentMediaKind } from './domain-types';

export function attachmentKindForMimeType(
  mimeType: string | undefined,
): AttachmentMediaKind {
  if (mimeType?.startsWith('image/') === true) return 'image';
  if (mimeType?.startsWith('audio/') === true) return 'audio';
  if (mimeType?.startsWith('video/') === true) return 'video';
  return 'file';
}

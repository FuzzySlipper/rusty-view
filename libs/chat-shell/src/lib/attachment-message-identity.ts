export interface AttachmentMessageIdentity {
  readonly fingerprint: string;
  readonly idempotencyKey: string;
}

export function attachmentMessageIdentity(
  previous: AttachmentMessageIdentity | undefined,
  text: string,
  attachmentIds: readonly string[],
  createKey: () => string,
): AttachmentMessageIdentity {
  const fingerprint = JSON.stringify([text, ...attachmentIds]);
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, idempotencyKey: createKey() };
}

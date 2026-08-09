import { attachmentMessageIdentity } from './attachment-message-identity';

describe('attachmentMessageIdentity', () => {
  let sequence = 0;
  const createKey = () => `message-${++sequence}`;

  beforeEach(() => {
    sequence = 0;
  });

  it('preserves one identity for an unchanged retry', () => {
    const first = attachmentMessageIdentity(
      undefined,
      'inspect this',
      ['attachment-1'],
      createKey,
    );
    const retry = attachmentMessageIdentity(
      first,
      'inspect this',
      ['attachment-1'],
      createKey,
    );

    expect(retry).toBe(first);
    expect(retry.idempotencyKey).toBe('message-1');
  });

  it('rotates identity when retry text changes', () => {
    const first = attachmentMessageIdentity(
      undefined,
      'before',
      ['attachment-1'],
      createKey,
    );
    const edited = attachmentMessageIdentity(
      first,
      'after',
      ['attachment-1'],
      createKey,
    );

    expect(edited.idempotencyKey).toBe('message-2');
  });

  it('rotates identity when the ordered attachment set changes', () => {
    const first = attachmentMessageIdentity(
      undefined,
      'inspect this',
      ['attachment-1'],
      createKey,
    );
    const edited = attachmentMessageIdentity(
      first,
      'inspect this',
      ['attachment-1', 'attachment-2'],
      createKey,
    );

    expect(edited.idempotencyKey).toBe('message-2');
  });
});

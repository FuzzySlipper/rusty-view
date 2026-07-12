import { describe, expect, it } from 'vitest';
import { hotkeyBindingFromEvent, matchesHotkey } from './hotkeys';

describe('hotkeys', () => {
  it('uses stable modifier order and canonical key labels', () => {
    expect(
      hotkeyBindingFromEvent({
        altKey: false,
        ctrlKey: true,
        key: 'Tab',
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe('Ctrl+Shift+Tab');
  });

  it('ignores modifier-only and IME events', () => {
    expect(
      hotkeyBindingFromEvent({
        altKey: false,
        ctrlKey: true,
        key: 'Control',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeUndefined();
    expect(
      matchesHotkey(
        {
          altKey: false,
          ctrlKey: true,
          isComposing: true,
          key: 'w',
          metaKey: false,
          shiftKey: false,
        },
        'Ctrl+W',
      ),
    ).toBe(false);
  });
});

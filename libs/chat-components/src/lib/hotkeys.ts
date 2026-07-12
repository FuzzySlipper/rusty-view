/** Canonical, display-friendly keyboard shortcut string. */
export type HotkeyBinding = string;

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

/** Convert a browser key event into the stable binding format used by settings. */
export function hotkeyBindingFromEvent(
  event: Pick<
    KeyboardEvent,
    'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
  >,
): HotkeyBinding | undefined {
  const key = canonicalKey(event.key);
  if (MODIFIER_KEYS.has(key)) return undefined;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

/** True when a keyboard event matches a configured canonical binding. */
export function matchesHotkey(
  event: Pick<
    KeyboardEvent,
    'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey'
  >,
  binding: HotkeyBinding,
): boolean {
  if (event.isComposing) return false;
  return hotkeyBindingFromEvent(event) === binding;
}

function canonicalKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key.length === 0
    ? 'Unknown'
    : `${key[0]?.toUpperCase()}${key.slice(1)}`;
}

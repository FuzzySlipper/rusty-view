import { sessionStatusLabel, sessionStatusTone } from './session-status-label';

describe('session status presentation', () => {
  it('keeps protocol status labels human-readable', () => {
    expect(sessionStatusLabel('waiting_interaction')).toBe(
      'Waiting Interaction',
    );
  });

  it.each([
    ['idle', 'idle'],
    ['active', 'active'],
    ['working', 'active'],
    ['completed', 'completed'],
    ['done', 'completed'],
    ['failed', 'error'],
    ['outcome_unknown', 'error'],
    ['waiting_interaction', 'warning'],
    ['blocked', 'warning'],
    ['interrupted', 'warning'],
    ['archived', 'muted'],
    ['offline', 'muted'],
    ['future_protocol_status', 'muted'],
  ] as const)('maps %s to the %s tone', (status, tone) => {
    expect(sessionStatusTone(status)).toBe(tone);
  });
});

import type { ChatSessionSummary } from '@rusty-view/protocol';

import {
  type BrainProfile,
  projectProfile,
  projectProfiles,
} from './brain-profile';

function makeSession(
  overrides: Partial<ChatSessionSummary>,
): ChatSessionSummary {
  return {
    session_id: 's1',
    agent_id: 'a',
    profile_id: 'p1',
    kind: 'full',
    status: 'idle',
    latest_cursor: '',
    updated_at: '2026-06-22T10:00:00Z',
    ...overrides,
  } as ChatSessionSummary;
}

describe('projectProfile', () => {
  it('picks the active session as the live session', () => {
    const p = projectProfile('p1', [
      makeSession({ session_id: 'old', status: 'archived', updated_at: '2026-01-01T00:00:00Z' }),
      makeSession({ session_id: 'live', status: 'active', updated_at: '2026-06-01T00:00:00Z' }),
      makeSession({ session_id: 'idle', status: 'idle', updated_at: '2026-06-02T00:00:00Z' }),
    ]);
    expect(p.activeSessionId).toBe('live');
    expect(p.status).toBe('active');
    expect(p.sessionCount).toBe(3);
  });

  it('falls back to the most recently updated non-archived session', () => {
    const p = projectProfile('p1', [
      makeSession({ session_id: 'arch1', status: 'archived', updated_at: '2026-06-10T00:00:00Z' }),
      makeSession({ session_id: 'idle-newer', status: 'idle', updated_at: '2026-06-05T00:00:00Z' }),
      makeSession({ session_id: 'idle-older', status: 'idle', updated_at: '2026-06-01T00:00:00Z' }),
    ]);
    expect(p.activeSessionId).toBe('idle-newer');
    expect(p.status).toBe('idle');
  });

  it('uses the most recently updated session when all are archived', () => {
    const p = projectProfile('p1', [
      makeSession({ session_id: 'a1', status: 'archived', updated_at: '2026-01-01T00:00:00Z' }),
      makeSession({ session_id: 'a2', status: 'archived', updated_at: '2026-02-01T00:00:00Z' }),
    ]);
    expect(p.activeSessionId).toBe('a2');
    expect(p.status).toBe('archived');
  });

  it('sorts sessions newest-updated first without mutating the input', () => {
    const input = [
      makeSession({ session_id: 'old', updated_at: '2026-01-01T00:00:00Z' }),
      makeSession({ session_id: 'new', updated_at: '2026-05-01T00:00:00Z' }),
    ];
    const p = projectProfile('p1', input);
    expect(p.sessions.map((s) => s.session_id)).toEqual(['new', 'old']);
    // Input order unchanged.
    expect(input.map((s) => s.session_id)).toEqual(['old', 'new']);
  });

  it('handles an empty session set', () => {
    const p = projectProfile('p1', []);
    expect(p.activeSessionId).toBeNull();
    expect(p.sessionCount).toBe(0);
    expect(p.status).toBe('archived');
  });
});

describe('projectProfiles', () => {
  it('groups sessions by profile id and orders by recent activity', () => {
    const profiles = projectProfiles([
      makeSession({ session_id: 's1', profile_id: 'old-prof', updated_at: '2026-01-01T00:00:00Z' }),
      makeSession({ session_id: 's2', profile_id: 'hot-prof', updated_at: '2026-06-01T00:00:00Z' }),
      makeSession({ session_id: 's3', profile_id: 'hot-prof', status: 'active', updated_at: '2026-06-02T00:00:00Z' }),
    ]);
    expect(profiles.map((p) => p.profileId)).toEqual(['hot-prof', 'old-prof']);
    const hot = profiles.find((p) => p.profileId === 'hot-prof') as BrainProfile;
    expect(hot.activeSessionId).toBe('s3');
    expect(hot.status).toBe('active');
    expect(hot.sessionCount).toBe(2);
  });

  it('returns an empty array for no sessions', () => {
    expect(projectProfiles([])).toEqual([]);
  });
});

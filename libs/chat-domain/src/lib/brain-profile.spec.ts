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
  it('aggregates the canonical execution phase instead of a stale legacy idle', () => {
    const p = projectProfile('p1', [
      makeSession({
        session_id: 'working',
        status: 'idle',
        execution: {
          sessionId: 'working',
          lifecycleStatus: 'live',
          phase: 'waiting',
          source: 'logical_turn',
          updatedAt: '2026-07-30T09:00:00Z',
        },
      }),
    ]);

    expect(p.defaultSessionId).toBe('working');
    expect(p.status).toBe('waiting');
  });

  it('keeps every non-archived session live and picks an active default', () => {
    const p = projectProfile('p1', [
      makeSession({
        session_id: 'old',
        status: 'archived',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      makeSession({
        session_id: 'live',
        status: 'active',
        updated_at: '2026-06-01T00:00:00Z',
      }),
      makeSession({
        session_id: 'idle',
        status: 'idle',
        updated_at: '2026-06-02T00:00:00Z',
      }),
    ]);
    expect(p.liveSessions.map((session) => session.session_id)).toEqual([
      'idle',
      'live',
    ]);
    expect(p.defaultSessionId).toBe('live');
    expect(p.status).toBe('active');
    expect(p.sessionCount).toBe(3);
  });

  it('falls back to the most recently updated non-archived session', () => {
    const p = projectProfile('p1', [
      makeSession({
        session_id: 'arch1',
        status: 'archived',
        updated_at: '2026-06-10T00:00:00Z',
      }),
      makeSession({
        session_id: 'idle-newer',
        status: 'idle',
        updated_at: '2026-06-05T00:00:00Z',
      }),
      makeSession({
        session_id: 'idle-older',
        status: 'idle',
        updated_at: '2026-06-01T00:00:00Z',
      }),
    ]);
    expect(p.liveSessions.map((session) => session.session_id)).toEqual([
      'idle-newer',
      'idle-older',
    ]);
    expect(p.defaultSessionId).toBe('idle-newer');
    expect(p.status).toBe('idle');
  });

  it('uses the most recently updated session when all are archived', () => {
    const p = projectProfile('p1', [
      makeSession({
        session_id: 'a1',
        status: 'archived',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      makeSession({
        session_id: 'a2',
        status: 'archived',
        updated_at: '2026-02-01T00:00:00Z',
      }),
    ]);
    expect(p.liveSessions).toEqual([]);
    expect(p.defaultSessionId).toBeNull();
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
    expect(p.liveSessions).toEqual([]);
    expect(p.defaultSessionId).toBeNull();
    expect(p.sessionCount).toBe(0);
    expect(p.status).toBe('archived');
  });
});

describe('projectProfiles', () => {
  it('groups sessions by profile id and orders by recent activity', () => {
    const profiles = projectProfiles([
      makeSession({
        session_id: 's1',
        profile_id: 'old-prof',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      makeSession({
        session_id: 's2',
        profile_id: 'hot-prof',
        updated_at: '2026-06-01T00:00:00Z',
      }),
      makeSession({
        session_id: 's3',
        profile_id: 'hot-prof',
        status: 'active',
        updated_at: '2026-06-02T00:00:00Z',
      }),
    ]);
    expect(profiles.map((p) => p.profileId)).toEqual(['hot-prof', 'old-prof']);
    const hot = profiles.find(
      (p) => p.profileId === 'hot-prof',
    ) as BrainProfile;
    expect(hot.defaultSessionId).toBe('s3');
    expect(hot.status).toBe('active');
    expect(hot.sessionCount).toBe(2);
  });

  it('returns an empty array for no sessions', () => {
    expect(projectProfiles([])).toEqual([]);
  });

  it('keeps concurrent direct and newer managed sessions as live candidates', () => {
    const profiles = projectProfiles([
      makeSession({
        session_id: 'direct-session',
        agent_id: 'software-engineer',
        profile_id: 'software-engineer',
        status: 'idle',
        updated_at: '2026-07-25T23:42:25Z',
      }),
      makeSession({
        session_id: 'managed-session',
        agent_id: 'external-agent-1',
        profile_id: 'software-engineer',
        status: 'idle',
        updated_at: '2026-07-26T02:12:52Z',
      }),
    ]);

    expect(
      profiles[0]?.liveSessions.map((session) => session.session_id),
    ).toEqual(['managed-session', 'direct-session']);
    expect(profiles[0]?.defaultSessionId).toBe('managed-session');
  });
});

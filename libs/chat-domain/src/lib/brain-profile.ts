import type { ChatSessionSummary } from '@rusty-view/protocol';

import {
  sessionExecutionDisplayStatus,
  sessionExecutionIsWorking,
  type SessionExecutionDisplayStatus,
} from './session-execution-status';

/**
 * Frontend view model for a "brain profile".
 *
 * The backend does not expose a profile-listing endpoint or a Profile wire type
 * — profiles exist only as the `profile_id` string on a {@link ChatSessionSummary}.
 * This type is a *projection* derived from the session list, not a hand-written
 * duplicate of a backend DTO. Per docs/rusty-view.md, projection/view-model
 * types belong in chat-domain (not in components and not in the type-only
 * protocol package). Roleplay-agnostic: a profile is just a brain identity that
 * owns one or more chat sessions.
 */
export interface BrainProfile {
  /** Stable identity (the backend `profile_id`). */
  readonly profileId: string;
  /** Display label — the profile id (downstream may decorate). */
  readonly label: string;
  /** All sessions belonging to this profile, newest-updated first. */
  readonly sessions: readonly ChatSessionSummary[];
  /**
   * Every independently live session belonging to the profile. Backend status
   * is authoritative: active, idle, and blocked sessions are live candidates;
   * archived sessions are not.
   */
  readonly liveSessions: readonly ChatSessionSummary[];
  /**
   * Stable fallback used when selecting a profile without an already-selected
   * live member. Prefer active, then idle, then blocked; ties use recency.
   * This is navigation convenience, not lifecycle authority.
   */
  readonly defaultSessionId: string | null;
  /** Aggregate liveness derived from member session statuses. */
  readonly status: BrainProfileStatus;
  /** Most recent `updated_at` across the profile's sessions (ISO). */
  readonly lastActivityAt: string;
  readonly sessionCount: number;
}

/** Aggregate status of a profile, derived from its sessions. */
export type BrainProfileStatus = SessionExecutionDisplayStatus;

/** Rank used to pick a default session: lower is more immediately active. */
function statusRank(session: ChatSessionSummary): number {
  if (sessionExecutionIsWorking(session)) return 0;
  if (session.status === 'blocked') return 2;
  if (session.status === 'archived') return 3;
  return 1;
}

/**
 * Derive the {@link BrainProfile} view model for a single profile id from its
 * sessions. Pure. Sessions are sorted newest-updated first as a side effect of
 * the returned `sessions` array (input is not mutated).
 */
export function projectProfile(
  profileId: string,
  sessions: readonly ChatSessionSummary[],
): BrainProfile {
  const sorted = [...sessions].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );

  const liveSessions = sorted.filter(
    (session) => session.status !== 'archived',
  );

  // Pick a navigation default from live candidates only. The full
  // `liveSessions` collection remains authoritative for profile navigation.
  let defaultSession: ChatSessionSummary | null = null;
  let defaultRank = Number.POSITIVE_INFINITY;
  for (const session of liveSessions) {
    const rank = statusRank(session);
    if (rank < defaultRank) {
      defaultSession = session;
      defaultRank = rank;
    }
  }

  const workingSession = liveSessions.find(sessionExecutionIsWorking);
  const status: BrainProfileStatus =
    workingSession !== undefined
      ? sessionExecutionDisplayStatus(workingSession)
      : defaultSession !== null
        ? sessionExecutionDisplayStatus(defaultSession)
        : 'archived';

  const lastActivityAt =
    sorted.length === 0 ? '' : (sorted[0]?.updated_at ?? '');

  return {
    profileId,
    label: profileId,
    sessions: sorted,
    liveSessions,
    defaultSessionId:
      defaultSession === null ? null : defaultSession.session_id,
    status,
    lastActivityAt,
    sessionCount: sorted.length,
  };
}

/**
 * Group a flat session list into {@link BrainProfile}s, one per distinct
 * `profile_id`, ordered by most recent activity then profile id. Pure — does
 * not mutate the input.
 */
export function projectProfiles(
  sessions: readonly ChatSessionSummary[],
): readonly BrainProfile[] {
  const byProfile = new Map<string, ChatSessionSummary[]>();
  for (const session of sessions) {
    const list = byProfile.get(session.profile_id);
    if (list === undefined) {
      byProfile.set(session.profile_id, [session]);
    } else {
      list.push(session);
    }
  }

  const profiles: BrainProfile[] = [];
  for (const [profileId, group] of byProfile) {
    profiles.push(projectProfile(profileId, group));
  }

  profiles.sort(
    (a, b) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt) ||
      a.profileId.localeCompare(b.profileId),
  );
  return profiles;
}

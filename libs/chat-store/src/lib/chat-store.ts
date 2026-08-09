import {
  computed,
  inject,
  Injectable,
  InjectionToken,
  type OnDestroy,
  signal,
} from '@angular/core';

import {
  emptyProjection,
  legacySessionStatusForExecution,
  projectConversation,
  projectProfiles,
  sessionExecutionDisplayStatus,
  sessionExecutionIsWorking,
  type BrainProfile,
  type ChatStorageAdapter,
  type ContextTimelineEntry,
  type ConversationBranch,
  type ConversationProjection,
  type ConversationSnapshot,
  type LogicalTurnProjection,
} from '@rusty-view/chat-domain';
import type {
  AgentDirectoryEntry,
  ChatCommandDescriptor,
  ChatEvent,
  ChatSessionStatus,
  ChatSessionSummary,
  CreateCrewChatSessionResult,
  SessionContextUsageResult,
  ToolCallDebugDetail,
  ProviderRequestDebugDetail,
  LogicalTurnDiagnostic,
  LogicalTurnResolutionAction,
  SessionExecutionState,
} from '@rusty-view/protocol';
import { ChatTransport, type ChatConnectionState } from '@rusty-view/transport';
import type { ChatEventStream } from '@rusty-view/transport';

import { DEBUG_ACTOR, type PendingSend } from './pending-operations';
import { storeErrorDetail, storeErrorMessage } from './store-error';
import { WeightedLruCache } from './weighted-lru-cache';

interface CachedNativeTranscript {
  readonly projection: ConversationProjection;
  readonly rawEvents: readonly ChatEvent[];
  readonly sessionStatus: ChatSessionStatus | null;
  readonly contextUsage: SessionContextUsageResult | null;
  readonly logicalTurnDiagnostics: readonly LogicalTurnDiagnostic[];
}

const NATIVE_TRANSCRIPT_CACHE_CAPACITY = 8;
const NATIVE_TRANSCRIPT_CACHE_WEIGHT = 60_000;
const SESSION_EXECUTION_POLL_INTERVAL_MS = 3_000;
const SESSION_LIFECYCLE_FOLLOW_UP_MS = 350;
const SESSION_PAGE_LIMIT = 500;
const MAX_SESSION_PAGES = 100;

/**
 * DI token for the {@link ChatStorageAdapter}. The shell provides a concrete
 * implementation (typically {@link IndexedDbChatStorage}) via this token.
 */
export const CHAT_STORAGE_ADAPTER = new InjectionToken<ChatStorageAdapter>(
  'CHAT_STORAGE_ADAPTER',
);

/**
 * Angular Signals store for chat session state.
 *
 * Owns: active session, message projection (via chat-domain reducer), stream
 * status, connection state, raw event log, command registry, pending sends.
 *
 * Does NOT own: downstream product-specific state.
 *
 * All network communication goes through {@link ChatTransport} — the store
 * makes no direct fetch/SSE calls. All durable storage goes through
 * {@link ChatStorageAdapter} (IndexedDB implementation provided by the shell).
 *
 * Streaming: the store subscribes to transport's SSE stream, feeds protocol
 * events into the chat-domain reducer incrementally, and deduplicates by
 * event_id. Monotonic events use the incremental fast path. If live delivery
 * races paged write catch-up and an older unseen event arrives late, the store
 * rebuilds once from the sequence-sorted raw log so stale deltas cannot regress
 * a completed message back to streaming.
 */
@Injectable()
export class ChatStore implements OnDestroy {
  private readonly transport = inject(ChatTransport);
  private readonly storage = inject(CHAT_STORAGE_ADAPTER);

  // ---- private state signals ----
  private readonly _sessions = signal<ChatSessionSummary[]>([]);
  private readonly _activeSessionId = signal<string | null>(null);
  private readonly _projection =
    signal<ConversationProjection>(emptyProjection());
  private readonly _rawEvents = signal<ChatEvent[]>([]);
  private readonly _connectionState = signal<ChatConnectionState>({
    status: 'idle',
  });
  private readonly _commandRegistry = signal<ChatCommandDescriptor[]>([]);
  /**
   * Latest model/provider/brain + context-usage diagnostics for the active
   * session (`GET /v1/chat/sessions/{id}/context`). Null until loaded or when
   * the backend does not expose the route.
   */
  private readonly _contextUsage = signal<SessionContextUsageResult | null>(
    null,
  );
  private readonly _logicalTurnDiagnostics = signal<
    readonly LogicalTurnDiagnostic[]
  >([]);
  private readonly _logicalTurnControlPending = signal(false);
  private readonly _logicalTurnControlError = signal<string | null>(null);
  private readonly _pendingSends = signal<PendingSend[]>([]);
  private readonly _pendingCommands = signal<PendingSend[]>([]);
  /** Status of the open session, from openSession (authoritative current state). */
  private readonly _activeSessionStatus = signal<ChatSessionStatus | null>(
    null,
  );
  private readonly _sessionLoading = signal(false);
  /** Brain profile the user has selected in the sidebar. Persisted. */
  private readonly _selectedProfileId = signal<string | null>(null);
  /** Coordination directory details used to distinguish same-profile runtimes. */
  private readonly _sessionDirectory = signal<readonly AgentDirectoryEntry[]>(
    [],
  );
  /** True while runtime identity for chat sessions is being resolved. */
  private readonly _sessionDirectoryLoading = signal(false);
  /** Submitted slash commands for Up/Down history navigation. Persisted. */
  private readonly _commandHistory = signal<readonly string[]>([]);
  /** Exact live session to restore after temporarily viewing an archive. */
  private readonly _returnToSessionId = signal<string | null>(null);
  private readonly _crewSessionCreating = signal(false);
  private readonly _crewSessionCreationError = signal<string | null>(null);
  private readonly _crewSessionCreationNotice = signal<string | null>(null);
  private readonly _sessionLifecyclePendingIds = signal<ReadonlySet<string>>(
    new Set(),
  );
  private readonly _sessionLifecycleError = signal<string | null>(null);
  private readonly _workspaceUpdatePendingIds = signal<ReadonlySet<string>>(
    new Set(),
  );
  private readonly _workspaceUpdateError = signal<string | null>(null);
  private readonly _workspaceUpdateNotice = signal<string | null>(null);

  // ---- stream management ----
  private activeStream: ChatEventStream | null = null;
  private readonly seenEventIds = new Set<string>();
  private selectionRevision = 0;
  /** Monotonic authority for same-session context reads. */
  private contextUsageRequestSequence = 0;
  /** Monotonic authority for in-place active-session refreshes. */
  private sessionRefreshSequence = 0;
  private sessionDirectoryRefresh: Promise<void> | undefined;
  private sessionExecutionRefresh: Promise<void> | undefined;
  private readonly sessionExecutionPollTimer: ReturnType<typeof setInterval>;
  private sessionLifecycleRefreshTimer: ReturnType<typeof setTimeout> | null =
    null;
  /** Exact live profile member selected across native and external runtimes. */
  private rememberedLiveSessionId: string | null = null;
  /**
   * Distinguishes operations created in the same millisecond. This sequence is
   * shared by sends and commands so every pending operation in this store has
   * a collision-proof identity even when the clock is fixed or coarse.
   */
  private pendingOperationSequence = 0;
  private readonly transcriptCache = new WeightedLruCache<
    string,
    CachedNativeTranscript
  >(NATIVE_TRANSCRIPT_CACHE_CAPACITY, NATIVE_TRANSCRIPT_CACHE_WEIGHT);

  // ---- public readonly signals ----
  readonly sessions = this._sessions.asReadonly();
  readonly sessionDirectory = this._sessionDirectory.asReadonly();
  readonly sessionDirectoryLoading = this._sessionDirectoryLoading.asReadonly();
  readonly activeSessionId = this._activeSessionId.asReadonly();
  readonly projection = this._projection.asReadonly();
  readonly rawEvents = this._rawEvents.asReadonly();
  readonly connectionState = this._connectionState.asReadonly();
  readonly commands = this._commandRegistry.asReadonly();
  /** Model/provider/brain + context-usage diagnostics for the active session. */
  readonly contextUsage = this._contextUsage.asReadonly();
  readonly logicalTurnDiagnostics = this._logicalTurnDiagnostics.asReadonly();
  readonly logicalTurnControlPending =
    this._logicalTurnControlPending.asReadonly();
  readonly logicalTurnControlError = this._logicalTurnControlError.asReadonly();
  readonly pendingSends = this._pendingSends.asReadonly();
  readonly pendingCommands = this._pendingCommands.asReadonly();
  /** True only while an uncached selected session has no materialized state. */
  readonly sessionLoading = this._sessionLoading.asReadonly();
  readonly crewSessionCreating = this._crewSessionCreating.asReadonly();
  readonly crewSessionCreationError =
    this._crewSessionCreationError.asReadonly();
  readonly crewSessionCreationNotice =
    this._crewSessionCreationNotice.asReadonly();
  readonly sessionLifecyclePendingIds =
    this._sessionLifecyclePendingIds.asReadonly();
  readonly sessionLifecycleError = this._sessionLifecycleError.asReadonly();
  readonly workspaceUpdatePendingIds =
    this._workspaceUpdatePendingIds.asReadonly();
  readonly workspaceUpdateError = this._workspaceUpdateError.asReadonly();
  readonly workspaceUpdateNotice = this._workspaceUpdateNotice.asReadonly();
  /** True when a message or command is currently in flight. */
  readonly isSubmitting = computed(() => {
    const sessionId = this._activeSessionId();
    if (sessionId === null) return false;
    return (
      this._pendingSends().some(
        (send) => send.sessionId === sessionId && send.status === 'sending',
      ) ||
      this._pendingCommands().some(
        (command) =>
          command.sessionId === sessionId && command.status === 'sending',
      )
    );
  });

  // ---- computed signals ----
  readonly messages = computed(() => this.messagesWithAssistantPlaceholder());
  readonly activeSession = computed<ChatSessionSummary | null>(() => {
    const id = this._activeSessionId();
    if (id === null) return null;
    return this._sessions().find((s) => s.session_id === id) ?? null;
  });
  readonly activeSessionExecution = computed(
    () => this.activeSession()?.execution ?? null,
  );
  readonly activeSessionDisplayStatus = computed(() => {
    const session = this.activeSession();
    return session === null ? null : sessionExecutionDisplayStatus(session);
  });
  readonly isStreaming = computed(
    () => this._projection().activeTurn !== undefined,
  );
  /**
   * Whether the agent is genuinely generating a live response right now —
   * `isStreaming` AND the session is server-side `active`. Used to gate the
   * message input. An idle session can carry a stale/replayed `activeTurn` (a
   * turn recorded without a terminal event, which the SSE stream re-replays);
   * gating on session status prevents that from wedging the input as disabled.
   */
  readonly activeLogicalTurn = computed<LogicalTurnProjection | undefined>(() =>
    [...this._projection().logicalTurns]
      .reverse()
      .find((turn) => !isTerminalLogicalTurnState(turn.operatorState)),
  );
  readonly activeLogicalTurnDiagnostic = computed<
    LogicalTurnDiagnostic | undefined
  >(() =>
    [...this._logicalTurnDiagnostics()]
      .reverse()
      .find((turn) => !isTerminalLogicalTurnState(turn.operatorState)),
  );
  readonly isGenerating = computed(() => {
    const logicalTurn = this.activeLogicalTurn();
    const session = this.activeSession();
    return (
      logicalTurn !== undefined ||
      (session !== null && sessionExecutionIsWorking(session)) ||
      (this.isStreaming() && this._activeSessionStatus() === 'active')
    );
  });
  /**
   * Number of characters accumulated in the active turn's streaming text so far.
   * Useful for progress visibility and live-test stall detection. Returns 0 when
   * no active turn exists.
   */
  readonly streamingCharCount = computed(
    () => this._projection().activeTurn?.streamingText.length ?? 0,
  );
  readonly lastCursor = computed(() => this._projection().latestCursor ?? null);

  /**
   * Context strategy / compaction status rows projected from the four `context_*`
   * events (oldest first). Rendered as UI/debug status rows, not assistant
   * messages.
   */
  readonly contextTimeline = computed<readonly ContextTimelineEntry[]>(
    () => this._projection().contextTimeline,
  );
  /** Most recent context status/compaction row, for at-a-glance display. */
  readonly contextStatus = computed<ContextTimelineEntry | null>(
    () => this._projection().contextStatus ?? null,
  );
  readonly branches = computed<readonly ConversationBranch[]>(
    () => this._projection().branches,
  );
  readonly snapshots = computed<readonly ConversationSnapshot[]>(
    () => this._projection().snapshots,
  );
  readonly activeBranchId = computed<string | undefined>(() => {
    const messages = this._projection().messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const branchId = messages[i]?.tree?.branchId;
      if (branchId !== undefined) return branchId;
    }
    return this._projection().branches.length === 1
      ? this._projection().branches[0]?.id
      : undefined;
  });

  /** Backend origin resolved for this store's transport. Used by live UI evidence. */
  backendBaseUrl(): string {
    return this.transport.getConfig().baseUrl;
  }

  // ---- profile / historical-session view state ----
  /**
   * Sessions eligible for Crew-facing navigation.
   *
   * Archiving a native Codex thread archives its Crew binding but deliberately
   * preserves the companion chat-session record for restore/history. Once the
   * coordination directory confirms that archived binding, keep the preserved
   * live-looking chat summary out of Agents and the Crew Sessions panel. Codex
   * management remains the authority for browsing and restoring that history.
   */
  private readonly navigationSessions = computed<readonly ChatSessionSummary[]>(
    () => {
      const directoryBySessionId = new Map(
        this._sessionDirectory().map((entry) => [entry.sessionId, entry]),
      );
      return this._sessions().filter((session) => {
        const directory = directoryBySessionId.get(session.session_id);
        return !(
          directory?.runtimeKind === 'codex_app_server' &&
          directory.bindingStatus === 'archived'
        );
      });
    },
  );
  /** Profiles derived from the session list, ordered by recent activity. */
  readonly profiles = computed<readonly BrainProfile[]>(() =>
    projectProfiles(this.navigationSessions()),
  );
  readonly selectedProfileId = this._selectedProfileId.asReadonly();
  /** Submitted slash commands, newest-first (for Up/Down navigation). */
  readonly commandHistory = this._commandHistory.asReadonly();
  /** The selected profile's fallback live session (not lifecycle authority). */
  readonly defaultSessionIdForSelectedProfile = computed<string | null>(() => {
    const id = this._selectedProfileId();
    if (id === null) return null;
    const profile = this.profiles().find((p) => p.profileId === id);
    return profile?.defaultSessionId ?? null;
  });
  /**
   * Historical state comes from the exact selected session's backend status,
   * never from whether another same-profile session won a recency comparison.
   */
  readonly viewingHistoricalSessionId = computed<string | null>(() => {
    const session = this.activeSession();
    return session?.status === 'archived' ? session.session_id : null;
  });
  readonly isViewingHistorical = computed(
    () => this.viewingHistoricalSessionId() !== null,
  );
  /** Sessions for the selected profile (historical list), newest first. */
  readonly selectedProfileSessions = computed<readonly ChatSessionSummary[]>(
    () => {
      const id = this._selectedProfileId();
      if (id === null) return [];
      return this.profiles().find((p) => p.profileId === id)?.sessions ?? [];
    },
  );
  /** All sessions across profiles, newest first (for the Sessions menu). */
  readonly allSessions = computed<readonly ChatSessionSummary[]>(() =>
    [...this.navigationSessions()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    ),
  );

  constructor() {
    this.sessionExecutionPollTimer = globalThis.setInterval(() => {
      void this.refreshSessionExecutionSnapshots().catch(() => undefined);
    }, SESSION_EXECUTION_POLL_INTERVAL_MS);
  }

  // ---- session operations ----

  /** Fetch the session list from the backend and update state + cache. */
  async refreshSessions(): Promise<void> {
    const [currentSessions, archivedSessions] = await Promise.all([
      this.listAllSessions(),
      this.listAllSessions('archived'),
    ]);
    const currentById = new Map(
      this._sessions().map((session) => [session.session_id, session]),
    );
    const sessionsById = new Map<string, ChatSessionSummary>();
    for (const session of [...currentSessions, ...archivedSessions]) {
      const current = currentById.get(session.session_id);
      sessionsById.set(
        session.session_id,
        current === undefined
          ? session
          : mergeSessionSummary(current, session, false),
      );
    }
    const sessions = [...sessionsById.values()];
    this._sessions.set(sessions);
    void this.refreshSessionDirectory();
    for (const session of sessions) {
      void this.storage.putSession(session).catch(() => undefined);
    }

    // First-load UI-state restore (idempotent: only acts before first selection).
    if (this._selectedProfileId() === null) {
      await this.restoreUiState();
    }
  }

  /**
   * Refresh both immediately and once after a short lifecycle-settle window.
   *
   * Archive writes are durable before this returns, but coordination and
   * external-binding projections can settle on different ticks. The immediate
   * refresh keeps the UI responsive; the bounded follow-up prevents a stale
   * live row from surviving until a manual reload.
   */
  async reconcileSessionsAfterLifecycleMutation(
    archivedSessionId?: string,
    archivedProfileId?: string | null,
  ): Promise<void> {
    await this.refreshSessions();
    if (
      archivedSessionId !== undefined &&
      this._activeSessionId() === archivedSessionId
    ) {
      await this.reconcileSelectionAfterArchive(
        archivedSessionId,
        archivedProfileId ?? null,
      );
    }
    this.scheduleLifecycleFollowUpRefresh(
      archivedSessionId,
      archivedProfileId ?? null,
    );
  }

  /** Archive one exact native Crew session without changing selection first. */
  async archiveSession(sessionId: string): Promise<boolean> {
    const session = this._sessions().find(
      (candidate) =>
        candidate.session_id === sessionId && candidate.status !== 'archived',
    );
    if (session === undefined) {
      this._sessionLifecycleError.set(
        'The selected Crew session is no longer available.',
      );
      return false;
    }
    if (this._sessionLifecyclePendingIds().has(sessionId)) return false;
    this._sessionLifecyclePendingIds.update(
      (current) => new Set([...current, sessionId]),
    );
    this._sessionLifecycleError.set(null);
    try {
      const result = await this.transport.sendCommand(sessionId, {
        command: '/archive',
      });
      if (!isArchiveCommandName(result.command_name)) {
        throw new Error(
          `Expected archive receipt, received ${result.command_name}.`,
        );
      }
      await this.reconcileSessionsAfterLifecycleMutation(
        sessionId,
        session.profile_id,
      );
      return true;
    } catch (error) {
      this._sessionLifecycleError.set(
        `Archive failed: ${storeErrorMessage(error)}`,
      );
      return false;
    } finally {
      this._sessionLifecyclePendingIds.update((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
  }

  clearSessionLifecycleError(): void {
    this._sessionLifecycleError.set(null);
  }

  /**
   * Reconcile background native-session execution snapshots without disturbing
   * transcript selection or replacing unchanged session-row identities.
   */
  async refreshSessionExecutionSnapshots(): Promise<void> {
    if (this.sessionExecutionRefresh !== undefined) {
      await this.sessionExecutionRefresh;
      return;
    }
    const refresh = this.loadSessionExecutionSnapshots();
    this.sessionExecutionRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (this.sessionExecutionRefresh === refresh) {
        this.sessionExecutionRefresh = undefined;
      }
    }
  }

  private async loadSessionExecutionSnapshots(): Promise<void> {
    const incomingSessions = await this.listAllSessions();
    const incomingById = new Map(
      incomingSessions.map((session) => [session.session_id, session]),
    );
    this._sessions.update((currentSessions) => {
      let changed = false;
      const nextSessions = currentSessions.map((current) => {
        const incoming = incomingById.get(current.session_id);
        if (incoming === undefined) return current;
        incomingById.delete(current.session_id);
        const merged = mergeSessionSummary(current, incoming, false);
        if (merged !== current) changed = true;
        return merged;
      });
      if (incomingById.size > 0) {
        changed = true;
        nextSessions.push(...incomingById.values());
      }
      return changed ? nextSessions : currentSessions;
    });
    this.reconcileActiveSessionStatus();
  }

  private async listAllSessions(
    status?: ChatSessionStatus,
  ): Promise<ChatSessionSummary[]> {
    const sessions: ChatSessionSummary[] = [];
    for (let pageIndex = 0; pageIndex < MAX_SESSION_PAGES; pageIndex += 1) {
      const offset = sessions.length;
      const page = await this.transport.listSessions({
        limit: SESSION_PAGE_LIMIT,
        offset,
        ...(status === undefined ? {} : { status }),
      });
      sessions.push(...page.items);
      if (page.items.length === 0 || sessions.length >= page.total) break;
    }
    return sessions;
  }

  async createCrewSession(
    profileId: string,
    expectedProfileRevision: number,
    workspaceCwd: string,
    idempotencyKey: string,
  ): Promise<CreateCrewChatSessionResult | undefined> {
    if (this._crewSessionCreating()) return undefined;
    this._crewSessionCreating.set(true);
    this._crewSessionCreationError.set(null);
    this._crewSessionCreationNotice.set(null);
    try {
      const result = await this.transport.createCrewSession(
        {
          profile_id: profileId,
          expected_profile_revision: expectedProfileRevision,
          workspace_cwd: workspaceCwd,
        },
        idempotencyKey,
      );
      await this.refreshSessions();
      const sessionId = crewCreationSessionId(result);
      if (sessionId === undefined) {
        this._crewSessionCreationError.set(
          'Crew created the session but did not return its exact session identity. Refresh Agents to locate it.',
        );
        return undefined;
      }
      await this.selectProfileSession(sessionId);
      this._crewSessionCreationNotice.set(
        `Crew brain session ${sessionId} is ready (${result.creation.outcome}).`,
      );
      return result;
    } catch (error) {
      const detail = storeErrorDetail(error);
      const reason = detail.apiError?.reasonCode;
      this._crewSessionCreationError.set(
        reason === 'profile_revision_conflict'
          ? 'The profile changed before creation. Current profile data was reloaded; review it and start again.'
          : `Crew session creation failed: ${detail.message}`,
      );
      await this.refreshSessions().catch(() => undefined);
      return undefined;
    } finally {
      this._crewSessionCreating.set(false);
    }
  }

  clearCrewSessionCreationFeedback(): void {
    this._crewSessionCreationError.set(null);
    this._crewSessionCreationNotice.set(null);
  }

  async switchCrewSessionWorkspace(
    sessionId: string,
    expectedRevision: number,
    cwd: string,
  ): Promise<boolean> {
    const session = this._sessions().find(
      (candidate) => candidate.session_id === sessionId,
    );
    if (session === undefined || session.status === 'archived') {
      this._workspaceUpdateError.set(
        'The selected Crew session is no longer available.',
      );
      return false;
    }
    const directoryExecution = this.sessionDirectoryEntry(sessionId)?.execution;
    if (
      sessionExecutionIsWorking(
        directoryExecution == null
          ? session
          : { ...session, execution: directoryExecution },
      )
    ) {
      this._workspaceUpdateError.set(
        'Finish or interrupt the active turn before changing the working directory.',
      );
      return false;
    }
    if (this._workspaceUpdatePendingIds().has(sessionId)) return false;

    this._workspaceUpdatePendingIds.update(
      (current) => new Set([...current, sessionId]),
    );
    this._workspaceUpdateError.set(null);
    this._workspaceUpdateNotice.set(null);
    try {
      const response = await this.transport.switchSessionWorkspace(sessionId, {
        cwd,
        expectedRevision,
      });
      if (response.outcome.status !== 'completed') {
        await this.refreshSessionDirectory().catch(() => undefined);
        const reason = response.outcome.reasonCode ?? '';
        this._workspaceUpdateError.set(
          /revision|stale|conflict/.test(reason)
            ? 'The working directory changed elsewhere. Current Crew state was reloaded; review it and try again.'
            : /busy|active/.test(reason)
              ? 'Crew rejected the change because this session is busy. Finish or interrupt the active turn and try again.'
              : `Working directory change failed: ${response.outcome.summary}${reason === '' ? '' : ` (${reason})`}`,
        );
        return false;
      }
      await this.refreshSessionDirectory();
      const current = response.outcome.result?.current;
      this._workspaceUpdateNotice.set(
        `Working directory changed to ${current?.cwd ?? cwd}${current === undefined ? '' : ` (revision ${current.revision})`}.`,
      );
      return true;
    } catch (error) {
      const detail = storeErrorDetail(error);
      const reason = detail.apiError?.reasonCode ?? '';
      await this.refreshSessionDirectory().catch(() => undefined);
      this._workspaceUpdateError.set(
        /revision|stale|conflict/.test(reason)
          ? 'The working directory changed elsewhere. Current Crew state was reloaded; review it and try again.'
          : /busy|active/.test(reason)
            ? 'Crew rejected the change because this session is busy. Finish or interrupt the active turn and try again.'
            : `Working directory change failed: ${detail.message}`,
      );
      return false;
    } finally {
      this._workspaceUpdatePendingIds.update((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
  }

  clearWorkspaceUpdateFeedback(): void {
    this._workspaceUpdateError.set(null);
    this._workspaceUpdateNotice.set(null);
  }

  /** Load persisted UI state (selected profile) and apply it if still valid. */
  private async restoreUiState(): Promise<void> {
    const state = await this.storage.getUiState().catch(() => null);
    const persistedProfileId = state?.selectedProfileId;
    if (persistedProfileId !== undefined && persistedProfileId !== '') {
      // Only restore if the profile still exists; otherwise leave unselected.
      const stillExists = this._sessions().some(
        (s) => s.profile_id === persistedProfileId,
      );
      if (stillExists) {
        const persistedSession = this._sessions().find(
          (session) =>
            session.session_id === state?.selectedSessionId &&
            session.profile_id === persistedProfileId &&
            session.status !== 'archived',
        );
        if (persistedSession !== undefined) {
          await this.selectProfileSession(persistedSession.session_id);
        } else {
          await this.selectProfile(persistedProfileId);
        }
      }
    }

    // Restore command history.
    const persistedHistory = state?.commandHistory;
    if (persistedHistory !== undefined && persistedHistory.length > 0) {
      this._commandHistory.set(persistedHistory);
    }
  }

  /** Persist the current selected-profile id and command history (fire and forget). */
  private persistUiState(): void {
    const id = this._selectedProfileId();
    const history = this._commandHistory();
    const selectedSessionId = this.liveSessionIdForPersistence();
    void this.storage
      .setUiState({
        ...(id !== null ? { selectedProfileId: id } : {}),
        ...(selectedSessionId !== null ? { selectedSessionId } : {}),
        ...(history.length > 0 ? { commandHistory: history } : {}),
      })
      .catch(() => undefined);
  }

  private liveSessionIdForPersistence(): string | null {
    const candidate =
      this._returnToSessionId() ??
      this.rememberedLiveSessionId ??
      this._activeSessionId();
    if (candidate === null) return null;
    const selectedProfileId = this._selectedProfileId();
    const session = this._sessions().find(
      (item) => item.session_id === candidate,
    );
    return session !== undefined &&
      session.profile_id === selectedProfileId &&
      session.status !== 'archived'
      ? candidate
      : null;
  }

  /**
   * Best-effort runtime identity details for same-profile session labels.
   * Chat remains usable when coordination is unavailable.
   */
  async refreshSessionDirectory(): Promise<void> {
    if (this.sessionDirectoryRefresh !== undefined) {
      await this.sessionDirectoryRefresh;
      return;
    }

    this._sessionDirectoryLoading.set(true);
    const refresh = this.loadSessionDirectory();
    this.sessionDirectoryRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (this.sessionDirectoryRefresh === refresh) {
        this.sessionDirectoryRefresh = undefined;
        this._sessionDirectoryLoading.set(false);
      }
    }
  }

  /** Wait for an in-flight runtime-directory read before choosing a send path. */
  async waitForSessionDirectory(): Promise<void> {
    if (this.sessionDirectoryRefresh !== undefined) {
      await this.sessionDirectoryRefresh;
    }
  }

  private async loadSessionDirectory(): Promise<void> {
    try {
      const directory = await this.transport.coordinationAgentDirectory();
      this._sessionDirectory.set(directory.agents);
    } catch {
      // Runtime decoration is optional; session status remains chat authority.
    }
  }

  sessionDirectoryEntry(sessionId: string): AgentDirectoryEntry | undefined {
    return this._sessionDirectory().find(
      (entry) => entry.sessionId === sessionId,
    );
  }

  /**
   * Persist an exact live profile member without opening it through ChatStore.
   * External runtimes use this after their own store has selected the binding.
   */
  rememberProfileSessionSelection(sessionId: string): boolean {
    const session = this._sessions().find(
      (candidate) => candidate.session_id === sessionId,
    );
    if (session === undefined || session.status === 'archived') return false;

    this._selectedProfileId.set(session.profile_id);
    this._returnToSessionId.set(null);
    this.rememberedLiveSessionId = sessionId;
    this.persistUiState();
    return true;
  }

  /** Maximum number of slash commands retained in history. */
  static readonly MAX_COMMAND_HISTORY = 100;

  /**
   * Record a successfully submitted slash command in history for Up/Down
   * navigation. Consecutive duplicates are skipped. Bounded to
   * {@link MAX_COMMAND_HISTORY} entries (newest-first).
   */
  recordCommand(command: string): void {
    const trimmed = command.trim();
    if (trimmed.length === 0) return;
    this._commandHistory.update((prev) => {
      // Skip consecutive duplicate.
      if (prev.length > 0 && prev[0] === trimmed) return prev;
      const next = [trimmed, ...prev];
      return next.slice(0, ChatStore.MAX_COMMAND_HISTORY);
    });
    this.persistUiState();
  }

  /**
   * Select a brain profile. Preserve an already-selected exact live member;
   * otherwise open the profile's deterministic fallback session.
   */
  async selectProfile(profileId: string): Promise<void> {
    const currentSession = this.activeSession();
    const preservedSessionId =
      currentSession?.profile_id === profileId &&
      currentSession.status !== 'archived'
        ? currentSession.session_id
        : null;
    this._selectedProfileId.set(profileId);
    this._returnToSessionId.set(null);

    const targetSessionId =
      preservedSessionId ?? this.defaultSessionIdForSelectedProfile();
    if (targetSessionId !== null) {
      this.rememberProfileSessionSelection(targetSessionId);
      await this.selectSession(targetSessionId);
    } else {
      this.rememberedLiveSessionId = null;
    }
    this.persistUiState();
  }

  /**
   * Select one exact profile member. Only archived backend sessions enter
   * historical/read-only mode; active, idle, and blocked members stay live.
   */
  async selectProfileSession(sessionId: string): Promise<void> {
    const session = this._sessions().find(
      (candidate) => candidate.session_id === sessionId,
    );
    if (session === undefined) {
      await this.selectSession(sessionId);
      return;
    }
    if (session.status === 'archived') {
      await this.viewHistoricalSession(sessionId);
      return;
    }

    this.rememberProfileSessionSelection(sessionId);
    await this.selectSession(sessionId);
    this.persistUiState();
  }

  /**
   * Open a historical (non-active) session for viewing from the Sessions menu,
   * without changing the selected profile. The transcript switches to that
   * session read-only; use {@link returnToActiveSession} to go back.
   */
  async viewHistoricalSession(sessionId: string): Promise<void> {
    const session = this._sessions().find(
      (candidate) => candidate.session_id === sessionId,
    );
    if (session?.status !== 'archived') {
      await this.selectProfileSession(sessionId);
      return;
    }
    const currentSession = this.activeSession();
    if (currentSession !== null && currentSession.status !== 'archived') {
      this._returnToSessionId.set(currentSession.session_id);
    }
    await this.selectSession(sessionId);
    this.persistUiState();
  }

  /** Return from an archive to the exact live session that preceded it. */
  async returnToActiveSession(): Promise<void> {
    const returnSessionId = this._returnToSessionId();
    const returnSession = this._sessions().find(
      (session) =>
        session.session_id === returnSessionId &&
        session.profile_id === this._selectedProfileId() &&
        session.status !== 'archived',
    );
    this._returnToSessionId.set(null);
    const targetSessionId =
      returnSession?.session_id ?? this.defaultSessionIdForSelectedProfile();
    if (targetSessionId !== null) {
      this.rememberProfileSessionSelection(targetSessionId);
      await this.selectSession(targetSessionId);
    }
    this.persistUiState();
  }

  /**
   * Clear the selected profile and transcript state after an external admin
   * action removes that profile/session graph.
   */
  clearProfileSelection(profileId?: string): void {
    if (
      profileId !== undefined &&
      this._selectedProfileId() !== null &&
      this._selectedProfileId() !== profileId
    ) {
      return;
    }
    this.resetProfileNavigation(false);
  }

  /**
   * Reset the active/profile navigation state without deleting durable session
   * history. Archive completion preserves the just-viewed transcript cache so
   * History can reopen it without manufacturing a selected zombie row.
   */
  private resetProfileNavigation(preserveTranscriptCache: boolean): void {
    this.selectionRevision += 1;
    this.contextUsageRequestSequence += 1;
    if (preserveTranscriptCache) {
      this.cacheActiveTranscript();
    }
    this.closeStream();
    if (!preserveTranscriptCache) this.transcriptCache.clear();
    this.seenEventIds.clear();
    this._selectedProfileId.set(null);
    this._returnToSessionId.set(null);
    this.rememberedLiveSessionId = null;
    this._activeSessionId.set(null);
    this._projection.set(emptyProjection());
    this._rawEvents.set([]);
    this._activeSessionStatus.set(null);
    this._contextUsage.set(null);
    this._logicalTurnDiagnostics.set([]);
    this._sessionLoading.set(false);
    this.persistUiState();
  }

  /** Load commands from the backend. */
  async loadCommands(): Promise<void> {
    const registry = await this.transport.listCommands();
    this._commandRegistry.set(registry.commands);
  }

  /**
   * Select and open a session: load cached events, fetch fresh data from the
   * backend, then connect the live SSE stream.
   */
  async selectSession(sessionId: string): Promise<void> {
    const revision = ++this.selectionRevision;
    this.contextUsageRequestSequence += 1;
    this.cacheActiveTranscript();
    this.closeStream();
    this.seenEventIds.clear();
    const cached = this.transcriptCache.get(sessionId);
    this._activeSessionId.set(sessionId);
    if (cached === undefined) {
      this._projection.set(emptyProjection());
      this._rawEvents.set([]);
      this._activeSessionStatus.set(null);
      this._contextUsage.set(null);
      this._logicalTurnDiagnostics.set([]);
      this._sessionLoading.set(true);
    } else {
      for (const event of cached.rawEvents) {
        this.seenEventIds.add(event.event_id);
      }
      this._projection.set(cached.projection);
      this._rawEvents.set([...cached.rawEvents]);
      this._activeSessionStatus.set(cached.sessionStatus);
      this._contextUsage.set(cached.contextUsage);
      this._logicalTurnDiagnostics.set(cached.logicalTurnDiagnostics);
      this._sessionLoading.set(false);
    }

    // Begin the backend read alongside the first cold IndexedDB materialization.
    const opened = this.transport.openSession(sessionId);
    // Storage may finish after a newer selection makes this result irrelevant;
    // attach immediately so an early rejected open never becomes unhandled.
    void opened.catch(() => undefined);
    try {
      if (cached === undefined) {
        const cachedEvents = await this.storage
          .getEvents(sessionId)
          .catch(() => [] as ChatEvent[]);
        if (!this.isCurrentSelection(revision, sessionId)) return;
        if (cachedEvents.length > 0) this.ingestEvents(cachedEvents);
      }

      const result = await opened;
      if (!this.isCurrentSelection(revision, sessionId)) return;
      const reconciledSession = this.reconcileSessionSummary(result.session);
      this._activeSessionStatus.set(reconciledSession.status);

      // Crew's open-session response is deliberately a bounded tail page. A
      // long native Profile turn therefore reports `has_more_before` and may
      // contain only the final few deltas. Rebuild from the synthetic origin
      // cursor before projecting that tail as a complete transcript.
      //
      // Keep the open tail in the batch as a race-safe fallback: if new events
      // landed between openSession and replay, they still enter the projection.
      // ingestEvents deduplicates the overlap by event_id.
      let initialEvents = result.events;
      if (result.has_more_before) {
        const originCursor =
          result.events.find((event) => event.sequence_id === 0)?.event_id ??
          `${sessionId}:0`;
        const replayedEvents = await this.transport.replayAllEvents(sessionId, {
          cursor: originCursor,
          limit: 500,
        });
        if (!this.isCurrentSelection(revision, sessionId)) return;
        initialEvents = [...result.events, ...replayedEvents];
      }
      this.ingestEvents(initialEvents);

      // Reconcile a stale active turn. Replayed events are historical; if a turn
      // record is incomplete (deltas/tools with no terminal `assistant_turn_finished`),
      // the projection leaves `activeTurn` set, which wedges the UI as "streaming"
      // (disabled input) on an idle session. Only an `active` session can have a
      // genuinely live turn — for any other status, drop the stale turn. A truly
      // live turn is re-established by the SSE stream's deltas below.
      if (result.session.status !== 'active') this.clearStaleActiveTurn();
      this.cacheActiveTranscript();

      await this.startStream(sessionId, revision);

      // Best-effort context diagnostics must not hold the transcript paint.
      void this.loadContextUsage(revision, sessionId);
      void this.loadLogicalTurns(revision, sessionId);
    } finally {
      if (this.isCurrentSelection(revision, sessionId)) {
        this._sessionLoading.set(false);
      }
    }
  }

  /**
   * Refresh the selected session without tearing down its projection or live
   * stream. Re-selecting the same session used to recreate the resident DOM
   * window and let the browser apply scroll anchoring to a transient layout;
   * an in-place read keeps idle refreshes geometry-neutral.
   */
  async refreshActiveSession(): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) return;
    const revision = this.selectionRevision;
    const request = ++this.sessionRefreshSequence;
    const opened = await this.transport.openSession(sessionId);
    if (
      request !== this.sessionRefreshSequence ||
      !this.isCurrentSelection(revision, sessionId)
    ) {
      return;
    }

    const reconciledSession = this.reconcileSessionSummary(opened.session);
    this._activeSessionStatus.set(reconciledSession.status);
    let initialEvents = opened.events;
    if (opened.has_more_before) {
      const originCursor =
        opened.events.find((event) => event.sequence_id === 0)?.event_id ??
        `${sessionId}:0`;
      const replayedEvents = await this.transport.replayAllEvents(sessionId, {
        cursor: originCursor,
        limit: 500,
      });
      if (
        request !== this.sessionRefreshSequence ||
        !this.isCurrentSelection(revision, sessionId)
      ) {
        return;
      }
      initialEvents = [...opened.events, ...replayedEvents];
    }
    this.ingestEvents(initialEvents);
    if (opened.session.status !== 'active') this.clearStaleActiveTurn();
    this.cacheActiveTranscript();
    void this.loadContextUsage(revision, sessionId);
    void this.loadLogicalTurns(revision, sessionId);
  }

  /**
   * Fetch model/provider/brain + context-usage diagnostics for the active
   * session and store them. Best-effort: failures (e.g. a backend without the
   * route) leave {@link contextUsage} null rather than throwing.
   */
  async loadContextUsage(
    revision = this.selectionRevision,
    sessionId = this._activeSessionId(),
  ): Promise<void> {
    if (sessionId === null) return;
    const requestSequence = ++this.contextUsageRequestSequence;
    try {
      const usage = await this.transport.sessionContext(sessionId);
      // Guard against a late response after the user switched sessions.
      if (
        requestSequence === this.contextUsageRequestSequence &&
        this.isCurrentSelection(revision, sessionId)
      ) {
        this._contextUsage.set(usage);
        this.cacheActiveTranscript();
      }
    } catch {
      // Diagnostics are optional; keep the current (or null) value.
    }
  }

  async loadLogicalTurns(
    revision = this.selectionRevision,
    sessionId = this._activeSessionId(),
  ): Promise<void> {
    if (sessionId === null) return;
    try {
      const page = await this.transport.listLogicalTurns(sessionId);
      if (this.isCurrentSelection(revision, sessionId)) {
        this._logicalTurnDiagnostics.set(
          reconcileLogicalTurnDiagnostics(
            this._logicalTurnDiagnostics(),
            page.items,
            this._projection().logicalTurns,
          ),
        );
        this.cacheActiveTranscript();
      }
    } catch {
      // Diagnostics remain optional for older/degraded backends.
    }
  }

  async cancelActiveLogicalTurn(): Promise<void> {
    const sessionId = this._activeSessionId();
    const turn = this.activeLogicalTurnDiagnostic();
    if (sessionId === null || turn === undefined) return;
    this._logicalTurnControlPending.set(true);
    this._logicalTurnControlError.set(null);
    try {
      await this.transport.cancelLogicalTurn(
        sessionId,
        turn.logicalTurnId,
        {
          expectedRevision: turn.revision,
          reasonCode: 'operator_cancelled',
          summary: 'Cancelled by operator from Rusty View.',
        },
        `view-cancel-${turn.logicalTurnId}-${turn.revision}`,
      );
      await this.loadLogicalTurns(this.selectionRevision, sessionId);
    } catch (error) {
      this._logicalTurnControlError.set(storeErrorMessage(error));
      await this.loadLogicalTurns(this.selectionRevision, sessionId);
    } finally {
      this._logicalTurnControlPending.set(false);
    }
  }

  async resolveActiveLogicalTurn(
    action: LogicalTurnResolutionAction,
  ): Promise<void> {
    const sessionId = this._activeSessionId();
    const turn = this.activeLogicalTurnDiagnostic();
    if (sessionId === null || turn === undefined) return;
    this._logicalTurnControlPending.set(true);
    this._logicalTurnControlError.set(null);
    try {
      await this.transport.resolveLogicalTurn(sessionId, turn.logicalTurnId, {
        expectedRevision: turn.revision,
        action,
      });
      await this.loadLogicalTurns(this.selectionRevision, sessionId);
    } catch (error) {
      this._logicalTurnControlError.set(storeErrorMessage(error));
      await this.loadLogicalTurns(this.selectionRevision, sessionId);
    } finally {
      this._logicalTurnControlPending.set(false);
    }
  }

  loadToolCallDebugDetail(
    sessionId: string,
    debugDetailId: string,
  ): Promise<ToolCallDebugDetail> {
    return this.transport.toolCallDebugDetail(sessionId, debugDetailId);
  }

  loadProviderRequestDebugDetail(
    sessionId: string,
    debugDetailId: string,
  ): Promise<ProviderRequestDebugDetail> {
    return this.transport.providerRequestDebugDetail(sessionId, debugDetailId);
  }

  async selectActiveMessageVariant(
    slotId: string,
    activeVariantId: string | undefined,
  ): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) {
      throw new Error('No active session — call selectSession first.');
    }
    await this.transport.selectActiveMessageVariant(sessionId, slotId, {
      ...(activeVariantId !== undefined
        ? { active_variant_id: activeVariantId }
        : {}),
      expected: { type: 'any' },
    });
    await this.selectSession(sessionId);
  }

  async deleteMessageVariant(slotId: string, variantId: string): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) {
      throw new Error('No active session — call selectSession first.');
    }
    await this.transport.deleteMessageVariant(sessionId, slotId, variantId);
    await this.selectSession(sessionId);
  }

  async selectActiveConversationBranch(branchId: string): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) {
      throw new Error('No active session — call selectSession first.');
    }
    await this.transport.selectActiveConversationBranch(sessionId, {
      active_branch_id: branchId,
      expected: { type: 'any' },
    });
    await this.selectSession(sessionId);
  }

  /** Drop a stale `activeTurn` left by an incomplete (terminal-less) turn record. */
  private clearStaleActiveTurn(): void {
    this._projection.update((prev) =>
      prev.activeTurn === undefined ? prev : { ...prev, activeTurn: undefined },
    );
    this.cacheActiveTranscript();
  }

  /**
   * Render a transient assistant row while a send is being accepted, or while a
   * real assistant turn has started but has not produced a visible block yet.
   * This is UI-only state: the raw event log remains backend truth.
   */
  private messagesWithAssistantPlaceholder(): readonly ChatStoreMessage[] {
    const projection = this._projection();
    const messages = projection.messages as readonly ChatStoreMessage[];
    const activeTurn = projection.activeTurn;

    if (activeTurn !== undefined) {
      const messageId =
        activeTurn.messageId ??
        `assistant-turn-${projection.latestCursor ?? this._activeSessionId()}`;
      if (messages.some((message) => message.id === messageId)) {
        return messages;
      }
      return [
        ...messages,
        createAssistantPlaceholderMessage({
          id: messageId,
          sessionId: this._activeSessionId(),
          createdAt: activeTurn.startedAt,
        }),
      ];
    }

    const pendingSend = this._pendingSends().find(
      (send) =>
        send.sessionId === this._activeSessionId() && send.status === 'sending',
    );
    if (pendingSend === undefined) {
      return messages;
    }

    return [
      ...messages,
      createAssistantPlaceholderMessage({
        id: `pending-assistant-${pendingSend.id}`,
        sessionId: this._activeSessionId(),
        createdAt: pendingCreatedAt(pendingSend.id),
      }),
    ];
  }

  /** Send a user message to the active session. */
  async sendMessage(text: string): Promise<void> {
    await this.sendMessageInternal(text, []);
  }

  /**
   * Send one user message linked to already-uploaded composer attachments.
   * Returns whether the write and catch-up completed so the shell can retain
   * staged files after a recoverable send failure.
   */
  sendMessageWithAttachments(
    text: string,
    attachmentIds: readonly string[],
  ): Promise<boolean> {
    return this.sendMessageInternal(text, attachmentIds);
  }

  private async sendMessageInternal(
    text: string,
    attachmentIds: readonly string[],
  ): Promise<boolean> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) {
      throw new Error('No active session — call selectSession first.');
    }
    const revision = this.selectionRevision;

    const pendingId = this.nextPendingOperationId('pending');
    const pending: PendingSend = {
      id: pendingId,
      sessionId,
      text,
      status: 'sending',
      error: undefined,
    };
    this._pendingSends.update((sends) => [...sends, pending]);

    try {
      const cursorBeforeSend = this.lastCursor();
      await this.transport.sendMessage(sessionId, {
        actor: DEBUG_ACTOR,
        body: text,
        ...(attachmentIds.length > 0
          ? { attachment_ids: [...attachmentIds] }
          : {}),
      });
      await this.catchUpAfterWrite(sessionId, cursorBeforeSend, revision);
      this._pendingSends.update((sends) =>
        sends.filter(
          (send) => send.id !== pendingId || send.sessionId !== sessionId,
        ),
      );
      return true;
    } catch (error) {
      this._pendingSends.update((sends) =>
        sends.map((send) =>
          send.id === pendingId && send.sessionId === sessionId
            ? { ...send, status: 'error', error: storeErrorDetail(error) }
            : send,
        ),
      );
      return false;
    }
  }

  /**
   * Request/response writes can commit events before the live SSE consumer sees
   * them. Replay from the pre-write cursor so the transcript updates even if the
   * stream callback is delayed or misses the small write/subscribe window.
   *
   * Replay is paginated: a single assistant turn can span many pages, so this
   * follows `has_more` via {@link ChatTransport.replayAllEvents} until the backend
   * reports no more. Ingesting only the first page could stop the transcript
   * mid-turn — e.g. the terminal `assistant_turn_finished` lands on a later page —
   * leaving the input wedged as "streaming" until a manual refresh (task #3865).
   */
  private async catchUpAfterWrite(
    sessionId: string,
    cursorBeforeWrite: string | null,
    revision: number,
  ): Promise<void> {
    const events = await this.transport.replayAllEvents(sessionId, {
      ...(cursorBeforeWrite !== null ? { cursor: cursorBeforeWrite } : {}),
    });
    if (this.isCurrentSelection(revision, sessionId)) {
      this.ingestEvents(events);
    }
  }

  /**
   * Unified submit: routes to {@link runCommand} if text starts with `/`,
   * otherwise to {@link sendMessage}. Used by the main chat composer so
   * users can type either messages or slash commands in one input.
   */
  async submit(text: string): Promise<void> {
    if (text.startsWith('/')) {
      await this.runCommand(text);
    } else {
      await this.sendMessage(text);
    }
  }

  /**
   * Execute a slash/debug command. If the command returns a new session
   * (e.g. /new), automatically switch to it. Tracks pending state so the
   * composer can disable during execution and surface failures.
   */
  async runCommand(command: string): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) {
      throw new Error('No active session — call selectSession first.');
    }
    // Preserve lifecycle identity before the command mutates backend
    // projections. The first bounded History page is not guaranteed to contain
    // the just-archived session after refresh.
    const commandSessionProfileId =
      this._sessions().find((session) => session.session_id === sessionId)
        ?.profile_id ?? null;

    const pendingId = this.nextPendingOperationId('cmd');
    const pending: PendingSend = {
      id: pendingId,
      sessionId,
      text: command,
      status: 'sending',
      error: undefined,
    };
    this._pendingCommands.update((cmds) => [...cmds, pending]);

    try {
      const result = await this.transport.sendCommand(sessionId, { command });
      this._pendingCommands.update((cmds) =>
        cmds.filter(
          (pendingCommand) =>
            pendingCommand.id !== pendingId ||
            pendingCommand.sessionId !== sessionId,
        ),
      );

      // Record in command history for Up/Down navigation.
      this.recordCommand(command);

      // /new returns a new_session_id — switch to it.
      if (result.new_session_id !== undefined) {
        await this.refreshSessions();
        await this.selectSession(result.new_session_id);
      } else {
        // Lifecycle commands such as /archive mutate list membership. Refresh
        // after every durable command so Agents and History agree immediately.
        await this.refreshSessions();
        if (isArchiveCommandName(result.command_name)) {
          await this.reconcileSelectionAfterArchive(
            sessionId,
            commandSessionProfileId,
          );
        }
        if (normalizeCommandName(result.command_name) === 'effort') {
          await this.loadContextUsage();
        }
      }
    } catch (error) {
      this._pendingCommands.update((cmds) =>
        cmds.map((pendingCommand) =>
          pendingCommand.id === pendingId &&
          pendingCommand.sessionId === sessionId
            ? {
                ...pendingCommand,
                status: 'error',
                error: storeErrorDetail(error),
              }
            : pendingCommand,
        ),
      );
    }
  }

  /**
   * Move normal navigation away from a durably archived Crew session.
   *
   * Prefer a live member of the same profile, then the first deterministic
   * profile fallback from the already ordered profile projection. If no live
   * session remains, clear navigation intentionally while keeping the archived
   * transcript available through History.
   */
  private async reconcileSelectionAfterArchive(
    archivedSessionId: string,
    commandSessionProfileId: string | null,
  ): Promise<void> {
    const archivedSession = this._sessions().find(
      (session) => session.session_id === archivedSessionId,
    );
    const archivedProfileId =
      commandSessionProfileId ?? archivedSession?.profile_id ?? null;
    const sameProfileFallback =
      archivedProfileId === null
        ? null
        : (this.profiles().find(
            (profile) => profile.profileId === archivedProfileId,
          )?.defaultSessionId ?? null);
    const anyLiveFallback =
      this.profiles().find((profile) => profile.defaultSessionId !== null)
        ?.defaultSessionId ?? null;
    const targetSessionId = sameProfileFallback ?? anyLiveFallback;

    if (targetSessionId !== null) {
      await this.selectProfileSession(targetSessionId);
      return;
    }
    this.resetProfileNavigation(true);
  }

  private scheduleLifecycleFollowUpRefresh(
    archivedSessionId: string | undefined,
    archivedProfileId: string | null,
  ): void {
    if (this.sessionLifecycleRefreshTimer !== null) {
      globalThis.clearTimeout(this.sessionLifecycleRefreshTimer);
    }
    this.sessionLifecycleRefreshTimer = globalThis.setTimeout(() => {
      this.sessionLifecycleRefreshTimer = null;
      void (async () => {
        await this.refreshSessions();
        if (
          archivedSessionId !== undefined &&
          this._activeSessionId() === archivedSessionId
        ) {
          await this.reconcileSelectionAfterArchive(
            archivedSessionId,
            archivedProfileId,
          );
        }
      })().catch(() => undefined);
    }, SESSION_LIFECYCLE_FOLLOW_UP_MS);
  }

  private nextPendingOperationId(kind: 'pending' | 'cmd'): string {
    const sequence = this.pendingOperationSequence;
    this.pendingOperationSequence += 1;
    return `${kind}_${Date.now()}_${sequence}`;
  }

  /** Close and reopen the SSE stream (manual reconnect). */
  async reconnect(): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) return;
    this.closeStream();
    await this.startStream(sessionId, this.selectionRevision);
    await this.loadContextUsage();
  }

  // ---- event ingestion (called by stream consumer + tests) ----

  /**
   * Ingest protocol events: deduplicate by event_id, append to raw log,
   * reduce into projection incrementally, and persist to storage.
   *
   * Called by the SSE stream consumer. Also used by selectSession for replay
   * events. This is an internal boundary — presentational components never
   * call this.
   */
  ingestEvents(events: readonly ChatEvent[]): void {
    const batchEventIds = new Set<string>();
    const newEvents = events.filter((event) => {
      if (
        this.seenEventIds.has(event.event_id) ||
        batchEventIds.has(event.event_id)
      ) {
        return false;
      }
      batchEventIds.add(event.event_id);
      return true;
    });
    if (newEvents.length === 0) return;

    const orderedNewEvents = [...newEvents].sort(compareChatEventSequence);
    const previousEvents = this._rawEvents();
    const latestSequence = previousEvents.at(-1)?.sequence_id;
    const arrivedOutOfOrder =
      latestSequence !== undefined &&
      orderedNewEvents.some((event) => event.sequence_id < latestSequence);
    const nextRawEvents = arrivedOutOfOrder
      ? [...previousEvents, ...orderedNewEvents].sort(compareChatEventSequence)
      : [...previousEvents, ...orderedNewEvents];
    const nextProjection = arrivedOutOfOrder
      ? projectConversation(nextRawEvents)
      : projectConversation(orderedNewEvents, this._projection());

    // Commit dedupe and signal state only after projection succeeds. A malformed
    // event remains retryable instead of being permanently hidden as "seen".
    for (const event of orderedNewEvents) {
      this.seenEventIds.add(event.event_id);
    }
    this._rawEvents.set(nextRawEvents);
    this._projection.set(nextProjection);
    if (
      orderedNewEvents.some(
        (event) => event.kind === 'session_execution_changed',
      )
    ) {
      this.reconcileSessionExecutionEvents(nextRawEvents);
    }
    this._logicalTurnDiagnostics.set(
      reconcileLogicalTurnDiagnostics(
        this._logicalTurnDiagnostics(),
        [],
        nextProjection.logicalTurns,
      ),
    );
    this.cacheActiveTranscript();

    if (
      orderedNewEvents.some((event) => event.kind.startsWith('logical_turn_'))
    ) {
      void this.loadLogicalTurns();
    }
    if (
      orderedNewEvents.some(
        (event) =>
          event.kind === 'command_completed' &&
          commandNameFromEvent(event) === 'effort',
      )
    ) {
      void this.loadContextUsage();
    }

    // Persist (fire and forget — storage failures are non-fatal).
    const sessionId = this._activeSessionId();
    if (sessionId !== null) {
      void this.storage
        .putEvents(sessionId, orderedNewEvents)
        .catch(() => undefined);
    }
  }

  // ---- SSE stream lifecycle ----

  private async startStream(
    sessionId: string,
    revision: number,
  ): Promise<void> {
    if (!this.isCurrentSelection(revision, sessionId)) return;
    const cursor = this.lastCursor();
    const stream = this.transport.streamEvents(sessionId, {
      ...(cursor !== null ? { initialCursor: cursor } : {}),
    });
    this.activeStream = stream;

    stream.onStateChange((state) => {
      if (
        this.activeStream === stream &&
        this.isCurrentSelection(revision, sessionId)
      ) {
        this._connectionState.set(state);
      }
    });

    // Consume events in the background.
    void this.consumeStream(stream, sessionId, revision);
  }

  private async consumeStream(
    stream: ChatEventStream,
    sessionId: string,
    revision: number,
  ): Promise<void> {
    try {
      for await (const event of stream.events()) {
        if (
          this.activeStream !== stream ||
          !this.isCurrentSelection(revision, sessionId)
        ) {
          break;
        }
        // Per-event isolation: a reducer/storage failure on one event must not
        // tear down the live consumer loop (that would freeze the transcript
        // while the connection still shows green — task #3848). Ingest each
        // event independently so the stream keeps flowing.
        try {
          this.ingestEvents([event]);
        } catch {
          // Swallow: one bad event is dropped, the live stream continues.
        }
      }
    } catch {
      // Stream errors are surfaced via onStateChange; nothing more to do.
    }
  }

  private closeStream(): void {
    if (this.activeStream !== null) {
      this.activeStream.close();
      this.activeStream = null;
      this._connectionState.set({ status: 'idle' });
    }
  }

  private reconcileSessionSummary(
    incoming: ChatSessionSummary,
  ): ChatSessionSummary {
    let reconciled = incoming;
    this._sessions.update((sessions) => {
      const currentIndex = sessions.findIndex(
        (session) => session.session_id === incoming.session_id,
      );
      if (currentIndex < 0) {
        return [...sessions, incoming];
      }
      const current = sessions[currentIndex] as ChatSessionSummary;
      reconciled = mergeSessionSummary(current, incoming, true);
      if (reconciled === current) return sessions;
      const next = [...sessions];
      next[currentIndex] = reconciled;
      return next;
    });
    return reconciled;
  }

  private reconcileSessionExecutionEvents(events: readonly ChatEvent[]): void {
    const execution = [...events]
      .reverse()
      .map(sessionExecutionFromEvent)
      .find((candidate) => candidate !== undefined);
    if (execution === undefined) return;
    const current = this._sessions().find(
      (session) => session.session_id === execution.sessionId,
    );
    if (current === undefined) return;
    this.reconcileSessionSummary({
      ...current,
      status: legacySessionStatusForExecution(execution),
      execution,
      updated_at:
        execution.updatedAt > current.updated_at
          ? execution.updatedAt
          : current.updated_at,
    });
    this.reconcileActiveSessionStatus();
  }

  private reconcileActiveSessionStatus(): void {
    const session = this.activeSession();
    this._activeSessionStatus.set(session?.status ?? null);
  }

  private cacheActiveTranscript(): void {
    const sessionId = this._activeSessionId();
    if (sessionId === null) return;
    const rawEvents = this._rawEvents();
    const projection = this._projection();
    this.transcriptCache.set(
      sessionId,
      {
        projection,
        rawEvents,
        sessionStatus: this._activeSessionStatus(),
        contextUsage: this._contextUsage(),
        logicalTurnDiagnostics: this._logicalTurnDiagnostics(),
      },
      rawEvents.length + projection.messages.length * 8,
    );
  }

  private isCurrentSelection(revision: number, sessionId: string): boolean {
    return (
      revision === this.selectionRevision &&
      this._activeSessionId() === sessionId
    );
  }

  /** Clean up resources when the store is destroyed. */
  ngOnDestroy(): void {
    globalThis.clearInterval(this.sessionExecutionPollTimer);
    if (this.sessionLifecycleRefreshTimer !== null) {
      globalThis.clearTimeout(this.sessionLifecycleRefreshTimer);
    }
    this.closeStream();
  }
}

function sessionExecutionFromEvent(
  event: ChatEvent,
): SessionExecutionState | undefined {
  if (
    event.kind !== 'session_execution_changed' ||
    typeof event.payload !== 'object' ||
    event.payload === null ||
    !('execution' in event.payload)
  ) {
    return undefined;
  }
  const execution = event.payload.execution as
    | SessionExecutionState
    | undefined;
  if (
    execution === undefined ||
    execution.sessionId !== event.session_id ||
    typeof execution.updatedAt !== 'string'
  ) {
    return undefined;
  }
  return execution;
}

function mergeSessionSummary(
  current: ChatSessionSummary,
  incoming: ChatSessionSummary,
  preferIncomingWhenExecutionTimestampsMatch: boolean,
): ChatSessionSummary {
  const currentExecution = current.execution;
  const incomingExecution = incoming.execution;
  const incomingExecutionIsStale =
    currentExecution !== undefined &&
    incomingExecution !== undefined &&
    (incomingExecution.updatedAt < currentExecution.updatedAt ||
      (incomingExecution.updatedAt === currentExecution.updatedAt &&
        !preferIncomingWhenExecutionTimestampsMatch));
  const candidate = incomingExecutionIsStale
    ? {
        ...incoming,
        // Execution freshness and lifecycle membership are independent.
        // Preserve the fresher execution snapshot, but never let its derived
        // live status overwrite an authoritative archived-list projection.
        status:
          incoming.status === 'archived' ? incoming.status : current.status,
        execution: currentExecution,
      }
    : incoming;
  return sessionSummariesEqual(current, candidate) ? current : candidate;
}

function sessionSummariesEqual(
  left: ChatSessionSummary,
  right: ChatSessionSummary,
): boolean {
  return (
    left.session_id === right.session_id &&
    left.agent_id === right.agent_id &&
    left.profile_id === right.profile_id &&
    left.kind === right.kind &&
    left.status === right.status &&
    left.title === right.title &&
    left.latest_cursor === right.latest_cursor &&
    left.created_at === right.created_at &&
    left.updated_at === right.updated_at &&
    left.message_count === right.message_count &&
    left.tool_event_count === right.tool_event_count &&
    sessionExecutionsEqual(left.execution, right.execution) &&
    JSON.stringify(left.effective_defaults) ===
      JSON.stringify(right.effective_defaults)
  );
}

function sessionExecutionsEqual(
  left: SessionExecutionState | undefined,
  right: SessionExecutionState | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.sessionId === right.sessionId &&
    left.lifecycleStatus === right.lifecycleStatus &&
    left.phase === right.phase &&
    left.source === right.source &&
    left.wakeId === right.wakeId &&
    left.logicalTurnId === right.logicalTurnId &&
    left.lastOutcome === right.lastOutcome &&
    left.reasonCode === right.reasonCode &&
    left.summary === right.summary &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt
  );
}

function isTerminalLogicalTurnState(state: string): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'failed';
}

function reconcileLogicalTurnDiagnostics(
  current: readonly LogicalTurnDiagnostic[],
  authoritativeActive: readonly LogicalTurnDiagnostic[],
  lifecycle: readonly LogicalTurnProjection[],
): readonly LogicalTurnDiagnostic[] {
  const byId = new Map(current.map((turn) => [turn.logicalTurnId, turn]));
  for (const turn of authoritativeActive) byId.set(turn.logicalTurnId, turn);
  for (const turn of lifecycle) {
    const existing = byId.get(turn.id);
    byId.set(turn.id, {
      logicalTurnId: turn.id,
      sessionId: turn.sessionId,
      sourceWakeId: existing?.sourceWakeId ?? turn.wakeId,
      phase: turn.phase,
      operatorState: turn.operatorState,
      currentContinuationId: turn.currentContinuationId,
      ...(turn.executionEpochId === undefined
        ? {}
        : { activeExecutionEpochId: turn.executionEpochId }),
      continuationCount: turn.continuationCount,
      providerRequestTotal: turn.progress.committedProviderOperations,
      toolRoundTotal: turn.progress.committedToolOperations,
      progressClassification: turn.progressClassification,
      progress: turn.progress,
      lastProgressAt: turn.progress.lastSemanticProgressAt,
      lastLivenessAt: turn.progress.lastLivenessAt,
      reasonCode: turn.reasonCode,
      summary: turn.summary,
      ...(turn.operatorState === 'paused_for_attention' &&
      existing?.attention !== undefined
        ? { attention: existing.attention }
        : {}),
      revision: turn.revision,
      admittedAt: existing?.admittedAt ?? turn.updatedAt,
      updatedAt: turn.updatedAt,
      ...(isTerminalLogicalTurnState(turn.operatorState)
        ? { terminalAt: turn.updatedAt }
        : {}),
    });
  }
  return [...byId.values()].sort((left, right) =>
    left.updatedAt.localeCompare(right.updatedAt),
  );
}

function crewCreationSessionId(
  result: CreateCrewChatSessionResult,
): string | undefined {
  const session = result.creation.session;
  const snakeCase = session['session_id'];
  if (typeof snakeCase === 'string' && snakeCase.trim() !== '')
    return snakeCase;
  const camelCase = session['sessionId'];
  return typeof camelCase === 'string' && camelCase.trim() !== ''
    ? camelCase
    : undefined;
}

function isArchiveCommandName(commandName: string): boolean {
  return commandName.replace(/^\/+/, '') === 'archive';
}

function normalizeCommandName(commandName: string): string {
  return commandName.trim().replace(/^\/+/, '').split(/\s+/, 1)[0] ?? '';
}

function commandNameFromEvent(event: ChatEvent): string | undefined {
  if (typeof event.payload !== 'object' || event.payload === null) {
    return undefined;
  }
  const commandName = (event.payload as Record<string, unknown>)[
    'command_name'
  ];
  return typeof commandName === 'string'
    ? normalizeCommandName(commandName)
    : undefined;
}

function compareChatEventSequence(left: ChatEvent, right: ChatEvent): number {
  return (
    left.sequence_id - right.sequence_id ||
    left.event_id.localeCompare(right.event_id)
  );
}

/** Type alias for message list (avoids importing domain Message type name conflicts). */
type ChatStoreMessage = ConversationProjection['messages'][number];

function createAssistantPlaceholderMessage(input: {
  readonly id: string;
  readonly sessionId: string | null;
  readonly createdAt: string;
}): ChatStoreMessage {
  return {
    id: input.id,
    sessionId: input.sessionId ?? 'pending-session',
    author: { role: 'assistant', displayName: undefined },
    createdAt: input.createdAt,
    status: 'streaming',
    blocks: [],
  };
}

function pendingCreatedAt(pendingId: string): string {
  const timestamp = Number(/^pending_(\d+)/.exec(pendingId)?.[1]);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

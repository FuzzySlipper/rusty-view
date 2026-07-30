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
  projectConversation,
  projectProfiles,
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

  // ---- stream management ----
  private activeStream: ChatEventStream | null = null;
  private readonly seenEventIds = new Set<string>();
  private selectionRevision = 0;
  private sessionDirectoryRefresh: Promise<void> | undefined;
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
    return (
      logicalTurn !== undefined ||
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
  /** Profiles derived from the session list, ordered by recent activity. */
  readonly profiles = computed<readonly BrainProfile[]>(() =>
    projectProfiles(this._sessions()),
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
    [...this._sessions()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    ),
  );

  // ---- session operations ----

  /** Fetch the session list from the backend and update state + cache. */
  async refreshSessions(): Promise<void> {
    const [currentPage, archivedPage] = await Promise.all([
      this.transport.listSessions(),
      this.transport.listSessions({ status: 'archived' }),
    ]);
    const sessionsById = new Map<string, ChatSessionSummary>();
    for (const session of [...currentPage.items, ...archivedPage.items]) {
      sessionsById.set(session.session_id, session);
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

  async createCrewSession(
    profileId: string,
    expectedProfileRevision: number,
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
      this._activeSessionStatus.set(result.session.status);

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
   * Fetch model/provider/brain + context-usage diagnostics for the active
   * session and store them. Best-effort: failures (e.g. a backend without the
   * route) leave {@link contextUsage} null rather than throwing.
   */
  async loadContextUsage(
    revision = this.selectionRevision,
    sessionId = this._activeSessionId(),
  ): Promise<void> {
    if (sessionId === null) return;
    try {
      const usage = await this.transport.sessionContext(sessionId);
      // Guard against a late response after the user switched sessions.
      if (this.isCurrentSelection(revision, sessionId)) {
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
      });
      await this.catchUpAfterWrite(sessionId, cursorBeforeSend, revision);
      this._pendingSends.update((sends) =>
        sends.filter(
          (send) => send.id !== pendingId || send.sessionId !== sessionId,
        ),
      );
    } catch (error) {
      this._pendingSends.update((sends) =>
        sends.map((send) =>
          send.id === pendingId && send.sessionId === sessionId
            ? { ...send, status: 'error', error: storeErrorDetail(error) }
            : send,
        ),
      );
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
    this.closeStream();
  }
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

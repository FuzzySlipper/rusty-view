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
  type ConversationProjection,
} from '@rusty-view/chat-domain';
import type {
  ChatCommandDescriptor,
  ChatEvent,
  ChatSessionStatus,
  ChatSessionSummary,
  SessionContextUsageResult,
} from '@rusty-view/protocol';
import { ChatTransport, type ChatConnectionState } from '@rusty-view/transport';
import type { ChatEventStream } from '@rusty-view/transport';

import { DEBUG_ACTOR, type PendingSend } from './pending-operations';
import { storeErrorDetail } from './store-error';

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
 * event_id. The projection is updated incrementally (only new events are
 * reduced, not the full event log) so streaming deltas don't trigger a full
 * rebuild.
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
  private readonly _pendingSends = signal<PendingSend[]>([]);
  private readonly _pendingCommands = signal<PendingSend[]>([]);
  /** Status of the open session, from openSession (authoritative current state). */
  private readonly _activeSessionStatus = signal<ChatSessionStatus | null>(
    null,
  );
  /** Brain profile the user has selected in the sidebar. Persisted. */
  private readonly _selectedProfileId = signal<string | null>(null);
  /** Submitted slash commands for Up/Down history navigation. Persisted. */
  private readonly _commandHistory = signal<readonly string[]>([]);
  /**
   * Non-null when the user is viewing a historical (non-active) session from
   * the Sessions menu. The selected profile stays intact; the transcript shows
   * the historical session read-only-ish until the user returns to active.
   */
  private readonly _viewingHistoricalSessionId = signal<string | null>(null);

  // ---- stream management ----
  private activeStream: ChatEventStream | null = null;
  private readonly seenEventIds = new Set<string>();

  // ---- public readonly signals ----
  readonly sessions = this._sessions.asReadonly();
  readonly activeSessionId = this._activeSessionId.asReadonly();
  readonly projection = this._projection.asReadonly();
  readonly rawEvents = this._rawEvents.asReadonly();
  readonly connectionState = this._connectionState.asReadonly();
  readonly commands = this._commandRegistry.asReadonly();
  /** Model/provider/brain + context-usage diagnostics for the active session. */
  readonly contextUsage = this._contextUsage.asReadonly();
  readonly pendingSends = this._pendingSends.asReadonly();
  readonly pendingCommands = this._pendingCommands.asReadonly();
  /** True when a message or command is currently in flight. */
  readonly isSubmitting = computed(
    () => this._pendingSends().length > 0 || this._pendingCommands().length > 0,
  );

  // ---- computed signals ----
  readonly messages = computed(
    () => this._projection().messages as readonly ChatStoreMessage[],
  );
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
  readonly isGenerating = computed(
    () => this.isStreaming() && this._activeSessionStatus() === 'active',
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

  // ---- profile / historical-session view state ----
  /** Brain profiles derived from the session list, ordered by recent activity. */
  readonly profiles = computed<readonly BrainProfile[]>(() =>
    projectProfiles(this._sessions()),
  );
  readonly selectedProfileId = this._selectedProfileId.asReadonly();
  /** Submitted slash commands, newest-first (for Up/Down navigation). */
  readonly commandHistory = this._commandHistory.asReadonly();
  /** The selected profile's current live session id (null if no profile/none). */
  readonly activeSessionIdForSelectedProfile = computed<string | null>(() => {
    const id = this._selectedProfileId();
    if (id === null) return null;
    const profile = this.profiles().find((p) => p.profileId === id);
    return profile?.activeSessionId ?? null;
  });
  readonly viewingHistoricalSessionId =
    this._viewingHistoricalSessionId.asReadonly();
  /** True when the transcript is showing a historical session, not the live one. */
  readonly isViewingHistorical = computed(
    () => this._viewingHistoricalSessionId() !== null,
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
    const page = await this.transport.listSessions();
    this._sessions.set(page.items);
    for (const session of page.items) {
      void this.storage.putSession(session).catch(() => undefined);
    }

    // First-load UI-state restore (idempotent: only acts before first selection).
    if (this._selectedProfileId() === null) {
      await this.restoreUiState();
    }
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
        await this.selectProfile(persistedProfileId);
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
    void this.storage
      .setUiState({
        ...(id !== null ? { selectedProfileId: id } : {}),
        ...(history.length > 0 ? { commandHistory: history } : {}),
      })
      .catch(() => undefined);
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
   * Select a brain profile and open its current active session. If the profile
   * has no live session, the sidebar selection is still recorded but no session
   * is opened.
   */
  async selectProfile(profileId: string): Promise<void> {
    this._selectedProfileId.set(profileId);
    this._viewingHistoricalSessionId.set(null);
    this.persistUiState();

    const activeSessionId = this.activeSessionIdForSelectedProfile();
    if (activeSessionId !== null) {
      await this.selectSession(activeSessionId);
    }
  }

  /**
   * Open a historical (non-active) session for viewing from the Sessions menu,
   * without changing the selected profile. The transcript switches to that
   * session read-only; use {@link returnToActiveSession} to go back.
   */
  async viewHistoricalSession(sessionId: string): Promise<void> {
    this._viewingHistoricalSessionId.set(sessionId);
    await this.selectSession(sessionId);
  }

  /** Return the transcript to the selected profile's current active session. */
  async returnToActiveSession(): Promise<void> {
    this._viewingHistoricalSessionId.set(null);
    const activeSessionId = this.activeSessionIdForSelectedProfile();
    if (activeSessionId !== null) {
      await this.selectSession(activeSessionId);
    }
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
    this.closeStream();
    this.seenEventIds.clear();
    this._activeSessionId.set(sessionId);
    this._projection.set(emptyProjection());
    this._rawEvents.set([]);
    this._activeSessionStatus.set(null);
    this._contextUsage.set(null);

    // 1. Load cached events from IndexedDB (survives refresh).
    const cachedEvents = await this.storage
      .getEvents(sessionId)
      .catch(() => [] as ChatEvent[]);
    if (cachedEvents.length > 0) {
      this.ingestEvents(cachedEvents);
    }

    // 2. Open fresh from backend.
    const result = await this.transport.openSession(sessionId);
    this._activeSessionStatus.set(result.session.status);
    this.ingestEvents(result.events);
    void this.storage
      .putEvents(sessionId, result.events)
      .catch(() => undefined);

    // Reconcile a stale active turn. Replayed events are historical; if a turn
    // record is incomplete (deltas/tools with no terminal `assistant_turn_finished`),
    // the projection leaves `activeTurn` set, which wedges the UI as "streaming"
    // (disabled input) on an idle session. Only an `active` session can have a
    // genuinely live turn — for any other status, drop the stale turn. A truly
    // live turn is re-established by the SSE stream's deltas below.
    if (result.session.status !== 'active') {
      this.clearStaleActiveTurn();
    }

    // 3. Start the live SSE stream.
    await this.startStream(sessionId);

    // 4. Best-effort context-usage diagnostics. Non-fatal: older backends may
    // not expose the route, and the transcript must not depend on it.
    void this.loadContextUsage();
  }

  /**
   * Fetch model/provider/brain + context-usage diagnostics for the active
   * session and store them. Best-effort: failures (e.g. a backend without the
   * route) leave {@link contextUsage} null rather than throwing.
   */
  async loadContextUsage(): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) return;
    try {
      const usage = await this.transport.sessionContext(sessionId);
      // Guard against a late response after the user switched sessions.
      if (this._activeSessionId() === sessionId) {
        this._contextUsage.set(usage);
      }
    } catch {
      // Diagnostics are optional; keep the current (or null) value.
    }
  }

  /** Drop a stale `activeTurn` left by an incomplete (terminal-less) turn record. */
  private clearStaleActiveTurn(): void {
    this._projection.update((prev) =>
      prev.activeTurn === undefined ? prev : { ...prev, activeTurn: undefined },
    );
  }

  /** Send a user message to the active session. */
  async sendMessage(text: string): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) {
      throw new Error('No active session — call selectSession first.');
    }

    const pendingId = `pending_${Date.now()}`;
    const pending: PendingSend = {
      id: pendingId,
      text,
      status: 'sending',
      error: undefined,
    };
    this._pendingSends.update((sends) => [...sends, pending]);

    try {
      const cursorBeforeSend = this.lastCursor();
      const result = await this.transport.sendMessage(sessionId, {
        actor: DEBUG_ACTOR,
        body: text,
      });
      await this.catchUpAfterWrite(
        sessionId,
        cursorBeforeSend,
        result.latest_cursor,
      );
      this._pendingSends.update((sends) =>
        sends.filter((s) => s.id !== pendingId),
      );
    } catch (error) {
      this._pendingSends.update((sends) =>
        sends.map((s) =>
          s.id === pendingId
            ? { ...s, status: 'error', error: storeErrorDetail(error) }
            : s,
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
    latestCursor: string,
  ): Promise<void> {
    if (cursorBeforeWrite === latestCursor) return;
    const events = await this.transport.replayAllEvents(sessionId, {
      ...(cursorBeforeWrite !== null ? { cursor: cursorBeforeWrite } : {}),
    });
    this.ingestEvents(events);
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

    const pendingId = `cmd_${Date.now()}`;
    const pending: PendingSend = {
      id: pendingId,
      text: command,
      status: 'sending',
      error: undefined,
    };
    this._pendingCommands.update((cmds) => [...cmds, pending]);

    try {
      const result = await this.transport.sendCommand(sessionId, { command });
      this._pendingCommands.update((cmds) =>
        cmds.filter((c) => c.id !== pendingId),
      );

      // Record in command history for Up/Down navigation.
      this.recordCommand(command);

      // /new returns a new_session_id — switch to it.
      if (result.new_session_id !== undefined) {
        await this.refreshSessions();
        await this.selectSession(result.new_session_id);
      }
    } catch (error) {
      this._pendingCommands.update((cmds) =>
        cmds.map((c) =>
          c.id === pendingId
            ? { ...c, status: 'error', error: storeErrorDetail(error) }
            : c,
        ),
      );
    }
  }

  /** Close and reopen the SSE stream (manual reconnect). */
  async reconnect(): Promise<void> {
    const sessionId = this._activeSessionId();
    if (sessionId === null) return;
    this.closeStream();
    await this.startStream(sessionId);
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
    const newEvents = events.filter((e) => !this.seenEventIds.has(e.event_id));
    if (newEvents.length === 0) return;

    for (const event of newEvents) {
      this.seenEventIds.add(event.event_id);
    }

    this._rawEvents.update((prev) => [...prev, ...newEvents]);
    this._projection.update((prev) => projectConversation(newEvents, prev));

    // Persist (fire and forget — storage failures are non-fatal).
    const sessionId = this._activeSessionId();
    if (sessionId !== null) {
      void this.storage.putEvents(sessionId, newEvents).catch(() => undefined);
    }
  }

  // ---- SSE stream lifecycle ----

  private async startStream(sessionId: string): Promise<void> {
    const cursor = this.lastCursor();
    this.activeStream = this.transport.streamEvents(sessionId, {
      ...(cursor !== null ? { initialCursor: cursor } : {}),
    });

    this.activeStream.onStateChange((state) => {
      this._connectionState.set(state);
    });

    // Consume events in the background.
    void this.consumeStream();
  }

  private async consumeStream(): Promise<void> {
    const stream = this.activeStream;
    if (stream === null) return;

    try {
      for await (const event of stream.events()) {
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

  /** Clean up resources when the store is destroyed. */
  ngOnDestroy(): void {
    this.closeStream();
  }
}

/** Type alias for message list (avoids importing domain Message type name conflicts). */
type ChatStoreMessage = ConversationProjection['messages'][number];

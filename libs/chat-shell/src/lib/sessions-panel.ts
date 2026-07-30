import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import { sessionExecutionDisplayStatus } from '@rusty-view/chat-domain';
import type { ChatSessionSummary } from '@rusty-view/protocol';

import { SESSIONS_PANEL_ID } from './shell-extension-tokens';
import { TopMenuController } from './top-menu-controller';
import { effectiveWakeTimeoutLabel } from './wake-timeout-display';
import {
  sessionStatusLabel,
  sessionStatusTone,
  type SessionStatusTone,
} from './session-status-label';

const SESSION_PAUSE_CAPABILITY_ID = 'admin.control.sessions.runtime.pause';
const SESSION_RESUME_CAPABILITY_ID = 'admin.control.sessions.runtime.resume';

/**
 * Sessions panel — opened from the top-menu Sessions entry.
 *
 * Container component — injects {@link ChatStore} and renders a flat list of
 * all sessions (newest first) across all profiles. Selecting an archived
 * session enters historical mode; every other exact session stays writable
 * according to its own backend state.
 *
 * Includes an optional filter-by-profile chip row so the user can narrow to
 * one brain's history. Empty state is shown when no sessions match.
 */
@Component({
  selector: 'rv-sessions-panel',
  imports: [DatePipe],
  templateUrl: './sessions-panel.html',
  styleUrl: './sessions-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsPanelComponent {
  protected readonly store = inject(ChatStore);
  protected readonly admin = inject(AdminStore);
  private readonly topMenu = inject(TopMenuController);

  readonly dismissed = output<void>();

  protected readonly filterProfileId = signal<string | null>(null);
  protected readonly archivedHistory = signal(false);
  protected readonly localControlError = signal<string | null>(null);

  protected readonly sessions = computed(() => {
    const all = this.store.allSessions();
    const filter = this.filterProfileId();
    const lifecycleFiltered = all.filter(
      (session) => (session.status === 'archived') === this.archivedHistory(),
    );
    const filtered =
      filter === null
        ? lifecycleFiltered
        : lifecycleFiltered.filter((s) => s.profile_id === filter);
    const target = this.targetSessionId();
    if (target === null) return filtered;
    return filtered.sort(
      (left, right) =>
        Number(right.session_id === target) -
        Number(left.session_id === target),
    );
  });
  protected readonly targetSessionId = computed(() =>
    this.topMenu.openPanelId() === SESSIONS_PANEL_ID
      ? this.topMenu.panelTargetId()
      : null,
  );
  protected readonly targetSessionIsListed = computed(() => {
    const target = this.targetSessionId();
    return (
      target !== null &&
      this.store.allSessions().some((session) => session.session_id === target)
    );
  });

  protected readonly profileIds = computed(() => {
    const ids = new Set<string>();
    for (const s of this.store.allSessions()) {
      ids.add(s.profile_id);
    }
    return [...ids].sort();
  });

  protected readonly hasSessions = computed(() => this.sessions().length > 0);
  protected readonly sessionPauseCapabilityState = computed(() =>
    this.admin.controlCapabilityState(SESSION_PAUSE_CAPABILITY_ID),
  );
  protected readonly sessionResumeCapabilityState = computed(() =>
    this.admin.controlCapabilityState(SESSION_RESUME_CAPABILITY_ID),
  );

  constructor() {
    void this.admin.refresh();
  }

  protected setFilter(profileId: string | null): void {
    this.filterProfileId.set(profileId);
  }

  protected setArchivedHistory(archived: boolean): void {
    this.archivedHistory.set(archived);
  }

  protected onSelectSession(sessionId: string): void {
    void this.store.selectProfileSession(sessionId);
    this.dismissed.emit();
  }

  protected pauseSessionRuntime(sessionId: string): void {
    this.localControlError.set(null);
    const reason = globalThis.prompt(
      'Reason for emergency runtime pause. This suppresses new wakes/delivery claims; it does not interrupt an in-flight LLM/tool call.',
      '',
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      this.localControlError.set('Runtime pause requires a short reason.');
      return;
    }
    void this.admin
      .pauseRuntime('session', sessionId, {
        reason: trimmed,
        reasonCode: 'runtime_pause_operator',
      })
      .then(() => {
        void this.store.refreshSessions();
      });
  }

  protected resumeSessionRuntime(sessionId: string): void {
    this.localControlError.set(null);
    void this.admin
      .resumeRuntime('session', sessionId, {
        reason: 'runtime resumed from rusty-view sessions panel',
        reasonCode: 'runtime_resume_operator',
      })
      .then(() => {
        void this.store.refreshSessions();
      });
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }

  protected wakeTimeoutLabel(session: ChatSessionSummary): string {
    return effectiveWakeTimeoutLabel(
      session,
      this.admin.runtimeSession(session.session_id),
    );
  }

  protected sessionState(session: ChatSessionSummary): string {
    return sessionExecutionDisplayStatus(session);
  }

  protected sessionStateLabel(session: ChatSessionSummary): string {
    return sessionStatusLabel(this.sessionState(session));
  }

  protected sessionStateTone(session: ChatSessionSummary): SessionStatusTone {
    return sessionStatusTone(this.sessionState(session));
  }
}

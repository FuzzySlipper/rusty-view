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

const SESSION_PAUSE_CAPABILITY_ID = 'admin.control.sessions.runtime.pause';
const SESSION_RESUME_CAPABILITY_ID = 'admin.control.sessions.runtime.resume';

/**
 * Sessions panel — opened from the top-menu Sessions entry.
 *
 * Container component — injects {@link ChatStore} and renders a flat list of
 * all sessions (newest first) across all profiles. Clicking a non-active
 * session enters "viewing historical" mode. If the user opens the currently
 * active session, the effect is a no-op beyond leaving historical mode.
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

  readonly dismissed = output<void>();

  protected readonly filterProfileId = signal<string | null>(null);
  protected readonly localControlError = signal<string | null>(null);

  protected readonly sessions = computed(() => {
    const all = this.store.allSessions();
    const filter = this.filterProfileId();
    if (filter === null) return all;
    return all.filter((s) => s.profile_id === filter);
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

  protected onSelectSession(sessionId: string): void {
    void this.store.viewHistoricalSession(sessionId);
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
}

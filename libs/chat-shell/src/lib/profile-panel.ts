import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import type { BrainProfile } from '@rusty-view/chat-domain';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import type { ChatSessionSummary } from '@rusty-view/protocol';

import { sessionStatusLabel } from './session-status-label';
import { profileWakeTimeoutLabel } from './wake-timeout-display';

/**
 * Brain profile sidebar panel — the primary navigation surface for
 * rusty-view.
 *
 * Container component — injects {@link ChatStore} to read the derived
 * {@code BrainProfile[]} list and trigger profile selection. Each profile
 * exposes every non-archived session with runtime kind, workdir, and exact
 * session identity so reused profiles remain unambiguous.
 *
 * Empty, loading, and error states are surfaced so the shell can render
 * informative placeholders when there are no profiles yet or the session list
 * hasn't loaded.
 */
@Component({
  selector: 'rv-profile-panel',
  templateUrl: './profile-panel.html',
  styleUrl: './profile-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePanelComponent {
  readonly profileSelected = output<void>();
  protected readonly store = inject(ChatStore);
  protected readonly admin = inject(AdminStore);

  protected readonly profiles = computed(() => this.store.profiles());
  protected readonly selectedProfileId = computed(() =>
    this.store.selectedProfileId(),
  );
  protected readonly hasProfiles = computed(() => this.profiles().length > 0);

  constructor() {
    void this.admin.refresh();
  }

  protected onSelectProfile(profileId: string): void {
    void this.store.selectProfile(profileId);
    this.profileSelected.emit();
  }

  protected onSelectSession(sessionId: string): void {
    void this.store.selectProfileSession(sessionId);
    this.profileSelected.emit();
  }

  protected onRefresh(): void {
    void this.store.refreshSessions();
  }

  protected wakeTimeoutLabel(profile: BrainProfile): string | undefined {
    return profileWakeTimeoutLabel(profile.sessions, (sessionId) =>
      this.admin.runtimeSession(sessionId),
    );
  }

  protected profileStatusLabel(status: string): string {
    return sessionStatusLabel(status);
  }

  protected sessionRuntimeKind(session: ChatSessionSummary): string {
    return (
      this.store.sessionDirectoryEntry(session.session_id)?.runtimeKind ??
      'chat_session'
    );
  }

  protected sessionRuntimeLabel(session: ChatSessionSummary): string {
    switch (this.sessionRuntimeKind(session)) {
      case 'direct_brain':
        return 'Crew brain';
      case 'codex_app_server':
        return 'Codex app-server';
      default:
        return 'Chat session';
    }
  }

  protected sessionWorkdir(session: ChatSessionSummary): string | null {
    const directoryWorkdir = this.store.sessionDirectoryEntry(
      session.session_id,
    )?.workdir;
    if (directoryWorkdir !== undefined && directoryWorkdir !== null) {
      return directoryWorkdir;
    }
    const resourceLimits = session.effective_defaults?.['resourceLimits'];
    if (
      typeof resourceLimits === 'object' &&
      resourceLimits !== null &&
      'workdir' in resourceLimits &&
      typeof resourceLimits.workdir === 'string'
    ) {
      return resourceLimits.workdir;
    }
    return null;
  }
}

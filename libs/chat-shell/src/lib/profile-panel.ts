import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { BrainProfile } from '@rusty-view/chat-domain';
import {
  AdminStore,
  ChatStore,
  type ExternalAgentSession,
} from '@rusty-view/chat-store';
import type { ChatSessionSummary } from '@rusty-view/protocol';

import { sessionStatusLabel } from './session-status-label';
import { profileWakeTimeoutLabel } from './wake-timeout-display';

const PINNED_PROFILES_STORAGE_KEY = 'rusty-view:pinned-profiles:v1';

/**
 * Brain profile sidebar panel — the primary navigation surface for
 * rusty-view.
 *
 * Container component — injects {@link ChatStore} to read the derived
 * {@code BrainProfile[]} list and emits an exact session identity for the shell
 * to route through the appropriate Crew-brain or external-agent store. Each
 * profile exposes every non-archived session with runtime kind, workdir, and
 * exact session identity so reused profiles remain unambiguous.
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
  readonly externalSessions = input<readonly ExternalAgentSession[]>([]);
  readonly selectedSessionId = input<string | null>(null);
  readonly profileSelected = output<string>();
  protected readonly store = inject(ChatStore);
  protected readonly admin = inject(AdminStore);
  private readonly pinnedProfileIds = signal(loadPinnedProfileIds());

  protected readonly profiles = computed(() => {
    const profiles = this.store.profiles();
    const pinned = this.pinnedProfileIds();
    return [
      ...profiles.filter((profile) => pinned.has(profile.profileId)),
      ...profiles.filter((profile) => !pinned.has(profile.profileId)),
    ];
  });
  protected readonly selectedProfileId = computed(() => {
    const selectedSessionId = this.selectedSessionId();
    return (
      this.profiles().find((profile) =>
        profile.liveSessions.some(
          (session) => session.session_id === selectedSessionId,
        ),
      )?.profileId ?? this.store.selectedProfileId()
    );
  });
  protected readonly hasProfiles = computed(() => this.profiles().length > 0);

  constructor() {
    void this.admin.refresh();
  }

  protected onSelectProfile(profileId: string): void {
    const profile = this.profiles().find(
      (candidate) => candidate.profileId === profileId,
    );
    if (profile === undefined) return;
    const selectedSessionId = this.selectedSessionId();
    const target =
      profile.liveSessions.find(
        (session) => session.session_id === selectedSessionId,
      ) ??
      profile.liveSessions.find(
        (session) => session.session_id === profile.defaultSessionId,
      ) ??
      profile.liveSessions[0];
    if (target !== undefined) this.profileSelected.emit(target.session_id);
  }

  protected onSelectSession(sessionId: string): void {
    this.profileSelected.emit(sessionId);
  }

  protected isProfilePinned(profileId: string): boolean {
    return this.pinnedProfileIds().has(profileId);
  }

  protected toggleProfilePin(profileId: string): void {
    const next = new Set(this.pinnedProfileIds());
    if (next.has(profileId)) {
      next.delete(profileId);
    } else {
      next.add(profileId);
    }
    this.pinnedProfileIds.set(next);
    persistPinnedProfileIds(next);
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

  protected sessionState(session: ChatSessionSummary): string {
    const external = this.externalSession(session);
    return external?.phase ?? external?.thread.status ?? session.status;
  }

  protected sessionStateLabel(session: ChatSessionSummary): string {
    return sessionStatusLabel(this.sessionState(session));
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

  private externalSession(
    session: ChatSessionSummary,
  ): ExternalAgentSession | undefined {
    const directory = this.store.sessionDirectoryEntry(session.session_id);
    if (directory?.runtimeKind !== 'codex_app_server') return undefined;
    const exact =
      directory.bindingId === undefined || directory.bindingId === null
        ? undefined
        : this.externalSessions().find(
            (candidate) => candidate.binding?.bindingId === directory.bindingId,
          );
    return (
      exact ??
      this.externalSessions().find(
        (candidate) => candidate.binding?.sessionId === session.session_id,
      )
    );
  }
}

function loadPinnedProfileIds(): ReadonlySet<string> {
  try {
    const serialized = localStorage.getItem(PINNED_PROFILES_STORAGE_KEY);
    if (serialized === null) return new Set();
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (profileId): profileId is string =>
          typeof profileId === 'string' && profileId.trim() !== '',
      ),
    );
  } catch {
    return new Set();
  }
}

function persistPinnedProfileIds(profileIds: ReadonlySet<string>): void {
  try {
    localStorage.setItem(
      PINNED_PROFILES_STORAGE_KEY,
      JSON.stringify([...profileIds]),
    );
  } catch {
    // Persistence is best-effort in embedded or privacy-restricted browsers.
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import type { BrainProfile } from '@rusty-view/chat-domain';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';

import { profileWakeTimeoutLabel } from './wake-timeout-display';

/**
 * Brain profile sidebar panel — the primary navigation surface for
 * rusty-view.
 *
 * Container component — injects {@link ChatStore} to read the derived
 * {@code BrainProfile[]} list and trigger profile selection. Each row shows
 * the profile id, aggregate status, session count, and an active-session
 * indicator. Clicking a profile opens its current live session.
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
  protected readonly statusLabel = computed(() => {
    if (this.profiles().length === 0 && this.store.sessions().length === 0) {
      return 'empty';
    }
    return 'ready';
  });

  constructor() {
    void this.admin.refresh();
  }

  protected onSelectProfile(profileId: string): void {
    void this.store.selectProfile(profileId);
    this.profileSelected.emit();
  }

  protected onRefresh(): void {
    void this.store.refreshSessions();
  }

  protected wakeTimeoutLabel(profile: BrainProfile): string {
    return profileWakeTimeoutLabel(profile.sessions, (sessionId) =>
      this.admin.runtimeSession(sessionId),
    );
  }
}

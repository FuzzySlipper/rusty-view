import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ChatStore } from '@rusty-view/chat-store';

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

  readonly dismissed = output<void>();

  protected readonly filterProfileId = signal<string | null>(null);

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

  protected readonly hasSessions = computed(
    () => this.sessions().length > 0,
  );

  protected setFilter(profileId: string | null): void {
    this.filterProfileId.set(profileId);
  }

  protected onSelectSession(sessionId: string): void {
    void this.store.viewHistoricalSession(sessionId);
    this.dismissed.emit();
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }
}

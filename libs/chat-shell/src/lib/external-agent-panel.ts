import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ExternalAgentStore,
  type ExternalAgentSession,
} from '@rusty-view/chat-store';

@Component({
  selector: 'rv-external-agent-panel',
  templateUrl: './external-agent-panel.html',
  styleUrl: './external-agent-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalAgentPanelComponent {
  protected readonly store = inject(ExternalAgentStore);
  protected readonly query = signal('');
  protected readonly sessions = computed(() => {
    const query = this.query().trim().toLowerCase();
    return query === ''
      ? this.store.sessions()
      : this.store.sessions().filter((session) =>
          [
            session.thread.name,
            session.thread.preview,
            session.thread.cwd,
            session.binding?.taskRef?.task_id,
          ].some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(query),
          ),
        );
  });

  constructor() {
    void this.store.refresh();
  }

  protected select(session: ExternalAgentSession): void {
    void this.store.selectSession(session);
  }

  protected updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}

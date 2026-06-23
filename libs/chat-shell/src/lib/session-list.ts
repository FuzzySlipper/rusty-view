import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
} from '@angular/core';
import { ChatStore } from '@rusty-view/chat-store';

/**
 * Session list sidebar. Container component — injects ChatStore to read
 * sessions and trigger session selection. Dense, workbench-style list.
 */
@Component({
  selector: 'rv-session-list',
  templateUrl: './session-list.html',
  styleUrl: './session-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionListComponent {
  protected readonly store = inject(ChatStore);

  readonly selectSession = output<string>();

  protected onSelect(sessionId: string): void {
    this.selectSession.emit(sessionId);
  }
}

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

/**
 * Root component of the debug-chat reference app.
 *
 * This is a deliberately minimal shell placeholder produced by the workspace
 * scaffolding task (#3179). The real debug layout — session list, transcript
 * region, inspector panels, and command composer — is assembled from
 * @rusty-view/chat-shell in later tasks (#3185–#3186).
 */
@Component({
  selector: 'rv-root',
  imports: [RouterModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly title = 'rusty-view · debug-chat';
}

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DebugShellComponent } from '@rusty-view/chat-shell';

/**
 * Root component of the debug-chat reference app. Renders the debug shell
 * which assembles the session list, transcript, message input, command
 * composer, and event inspector.
 */
@Component({
  selector: 'rv-root',
  imports: [DebugShellComponent],
  template: '<rv-debug-shell />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}

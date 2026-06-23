/**
 * @rusty-view/chat-shell
 *
 * Debug app layout and container components: session list, transcript region,
 * event inspector, command composer, and the debug shell that assembles them.
 * The shell is the composition layer — it injects ChatStore and wires
 * transport events into the store + presentational components.
 *
 * Implemented in Den tasks #3185 (components + shell) and #3186 (debug MVP).
 */

export { DebugShellComponent } from './lib/debug-shell';
export { SessionListComponent } from './lib/session-list';
export { EventInspectorComponent } from './lib/event-inspector';
export { CommandComposerComponent } from './lib/command-composer';

export const CHAT_SHELL_VERSION = '0.0.0' as const;

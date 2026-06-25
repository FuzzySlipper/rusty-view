# Rusty View Plugin API

`rusty-view` is both a reusable agent oversight/debug UI and the upstream chat
substrate for downstream apps such as `rusty-roleplay`. The plugin API keeps
that split clean: `rusty-view` owns generic chat mechanics, while consumers
register their own presentation and actions.

## Boundary

Core packages may expose hooks for:

- content block renderers
- slash commands and autocomplete enum providers
- auto-execute hooks
- message toolbar actions
- sidebar panels
- settings panels
- top-menu entries
- user-data actions with side-effect and confirmation metadata

Core packages must not introduce downstream domain concepts such as characters,
personas, lorebooks, expression sprites, roleplay groups, prompt-manager
semantics, or roleplay regex scripts.

## Registration

Plugins are plain typed objects provided through Angular DI:

```ts
import { provideChatPlugins, type ChatPlugin } from '@rusty-view/chat-shell';

export const agentWorkbenchPlugin: ChatPlugin = {
  id: 'agent-workbench',
  label: 'Agent Workbench',
  sidebarPanels: [
    { id: 'runs', title: 'Runs', component: RunsPanelComponent },
  ],
  slashCommands: [
    {
      name: 'inspect',
      description: 'Inspect the current agent session',
      sideEffect: 'read',
      async run() {
        return { type: 'silent' };
      },
    },
  ],
};

export const appConfig = {
  providers: [provideChatPlugins(agentWorkbenchPlugin)],
};
```

`provideChatPlugins()` flattens contribution arrays into the public `CHAT_*`
tokens, including the existing top-menu and Options-panel tokens.

## Agent Data Actions

Agent-facing helpers, such as a mechanic/OOC session, should use generic data
actions rather than bypassing UI state directly. A data action declares what it
can read or change and whether the UI should ask the user first:

```ts
const confirmation = {
  required: true,
  title: 'Apply setting change?',
  message: 'This changes a user-side preference.',
} satisfies ChatPluginConfirmationPolicy;

const toggleSettingAction = {
  id: 'settings.toggle',
  label: 'Toggle setting',
  description: 'Change a user-side preference',
  scope: 'settings',
  sideEffect: 'write',
  confirmation,
  async run(context) {
    const ok = await context.confirm(confirmation);
    return ok
      ? { status: 'completed', summary: 'Changed setting' }
      : { status: 'cancelled', summary: 'User cancelled' };
  },
} satisfies ChatPluginDataAction;
```

This is intentionally generic. `rusty-view` does not know why a downstream app
has a setting, only that a registered action can inspect or mutate it under a
declared side-effect policy.

## Current Status

Task #3338 defines and exports the contracts. Some contribution points already
have rendered surfaces (`CHAT_TOP_MENU_ITEMS`, `CHAT_OPTIONS_TABS`), while
others are API commitments for upcoming substrate tasks:

- content renderer dispatch
- richer slash command parsing/runtime
- sidebar-panel rendering
- message toolbar rendering
- data-action execution and confirmation UX

Downstream apps may compile against the contracts now, but visible UI support
arrives as the corresponding substrate tasks land.

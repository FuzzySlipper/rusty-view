# Rusty View Plugin API

`rusty-view` is both a reusable agent oversight/debug UI and a generic chat
substrate for downstream apps. The plugin API keeps that split clean:
`rusty-view` owns generic chat mechanics, while consumers register their own
presentation and actions.

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

Core packages must not introduce downstream domain concepts such as product
profiles, app-specific prompt managers, bespoke transcript decorations, or
consumer-owned workflow semantics.

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

## Shell Menu Composition

Downstream shells can hide selected built-in top-menu affordances while keeping
the default Rusty View menu unchanged. They can also contribute tabs to the
built-in Debug panel. For example, a shell with its own Sessions surface can
hide the generic Sessions and Service buttons, then expose the standard service
controls inside Debug:

```ts
import {
  AdminServicePanelComponent,
  CHAT_DEBUG_TABS,
  CHAT_TOP_MENU_CONFIGURATION,
  SERVICE_PANEL_ID,
  SESSIONS_PANEL_ID,
} from '@rusty-view/chat-shell';

export const appConfig = {
  providers: [
    {
      provide: CHAT_TOP_MENU_CONFIGURATION,
      useValue: {
        hiddenBuiltInItemIds: [SESSIONS_PANEL_ID, SERVICE_PANEL_ID],
      },
    },
    {
      provide: CHAT_DEBUG_TABS,
      multi: true,
      useValue: [
        {
          id: 'service-controls',
          label: 'Service',
          order: 40,
          component: AdminServicePanelComponent,
        },
      ],
    },
  ],
};
```

Hiding a built-in entry removes only its top-menu button. Its stable ID remains
reserved, downstream panels cannot replace it, and `TopMenuController` can
still open the built-in panel. The built-in Debug tab IDs `providers`, `tools`,
and `storage` are likewise reserved.

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

## Slash Commands

Plugins can register generic slash commands. Core owns the parser/runtime;
downstream apps own the commands themselves.

```ts
const inspectCommand = {
  name: 'inspect',
  aliases: ['i'],
  description: 'Inspect the current session',
  palettes: ['chat-input', 'global'],
  sideEffect: 'read',
  arguments: [
    {
      name: 'target',
      type: 'enum',
      enumProviderId: 'inspect-targets',
    },
  ],
  namedArguments: {
    verbose: { name: 'verbose', type: 'boolean', optional: true },
  },
  async run(args, named, context) {
    const [target] = args;
    return {
      type: 'value',
      value: { target, verbose: named.verbose, sessionId: context.sessionId },
    };
  },
} satisfies ChatPluginSlashCommand;
```

Supported argument types are `string`, `number`, `boolean`, `enum`, `json`,
and `file`. Positional values are coerced according to `arguments`; named values
are parsed from `--name value`, `--name=value`, `--flag`, and `--no-flag` forms
according to `namedArguments`.

The runtime exports:

- `parseSlashCommand(input)`
- `coerceSlashCommandArguments(command, parsed)`
- `executeSlashCommand(input, commands, context)`
- `completeSlashCommand(input, commands, enumProviders, context)`
- `commandsForPalette(commands, palette)`
- `pluginCommandDescriptor(command)`

`executeSlashCommand()` catches validation/runtime failures and returns
`{ type: 'error' }`; rejected confirmations and `AbortError`s return
`{ type: 'abort' }`. The debug shell records successful plugin commands in the
same command history used for backend slash commands.

Enum providers feed autocomplete without coupling core to downstream value
sources:

```ts
const inspectTargets = {
  id: 'inspect-targets',
  values(query, context) {
    return ['session', 'messages', context.sessionId]
      .filter((value): value is string => value !== undefined)
      .filter((value) => value.startsWith(query));
  },
} satisfies ChatPluginEnumProvider;
```

## Current Status

The plugin contracts are exported from `@rusty-view/chat-shell`, with content
renderer contracts re-exported from `@rusty-view/transcript-renderer`. The
debug shell renders these contribution points today:

- `CHAT_TOP_MENU_ITEMS`
- `CHAT_TOP_MENU_PANELS`
- `CHAT_TOP_MENU_CONFIGURATION`
- `CHAT_DEBUG_TABS`
- `CHAT_OPTIONS_TABS`
- `CHAT_CONTENT_RENDERERS`
- `CHAT_SLASH_COMMANDS`

These contribution points are exported contracts, but do not yet have complete
default UI in the reference shell:

- sidebar-panel rendering
- message toolbar rendering
- data-action execution and confirmation UX

Downstream apps may compile against the contracts now, but visible UI support
arrives as the corresponding substrate tasks land.

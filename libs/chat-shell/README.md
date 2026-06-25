# chat-shell

Shell/container components and extension contracts for the Rusty View debug
chat client.

Downstream consumers register generic UI and action contributions with
`provideChatPlugins(...)`. See `docs/07-rusty-view-plugin-api.md` for the
architecture boundary and the public plugin surface.

## Running unit tests

Run `nx test chat-shell` to execute the unit tests.

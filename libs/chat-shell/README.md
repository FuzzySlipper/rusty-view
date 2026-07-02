# chat-shell

Shell/container components and extension contracts for the Rusty View debug
chat client.

Downstream consumers register generic UI and action contributions with
`provideChatPlugins(...)`. See `docs/plugin-api.md` for the
architecture boundary and the public plugin surface.

Content block renderers are dispatched by
`@rusty-view/transcript-renderer`; `chat-shell` re-exports the renderer token
through its plugin API so downstream apps can register all plugin
contributions from one provider call.

## Running unit tests

Run `nx test chat-shell` to execute the unit tests.

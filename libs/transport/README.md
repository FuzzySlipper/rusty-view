# @rusty-view/transport

HTTP/SSE client for the Rusty Crew chat session API. Owns **all** backend
communication — no transport code exists outside this package.

## What it does

- **HTTP endpoints**: session list/open, event replay, send-message, command
  registry/execute.
- **SSE event stream**: fetch-based streaming (not EventSource — see below) with
  cursor resume and bounded exponential backoff reconnection.
- **Auth**: no-auth LAN/dev mode (no token) and bearer-token mode
  (`Authorization: Bearer <token>`). Transport never persists tokens.
- **Forward-compat**: unrecognized event kinds are coerced into `unknown` events
  (carrying the original under `payload.raw`) so the debug UI never crashes on
  future backend event kinds.

## Usage

```ts
import { ChatTransport } from '@rusty-view/transport';

const transport = new ChatTransport({
  baseUrl: 'http://192.168.1.10:9347',
  // bearerToken: 'optional-token', // omit for no-auth LAN mode
});

// HTTP
const page = await transport.listSessions({ limit: 50 });
const session = await transport.openSession('sess_1');
await transport.sendMessage('sess_1', {
  actor: { id: 'user', kind: 'human' },
  body: 'Hello',
});

// SSE (live event stream with auto-reconnect)
const stream = transport.streamEvents('sess_1', { initialCursor: 'cur_42' });
stream.onStateChange((state) => console.log(state.status));

for await (const event of stream.events()) {
  console.log(event.kind, event.event_id);
  if (shouldStop) {
    stream.close();
    break;
  }
}
```

## Why fetch-based SSE (not EventSource)?

`EventSource` cannot set custom request headers. Bearer-token auth requires an
`Authorization` header, so transport uses `fetch` + `ReadableStream` for SSE.
This also gives explicit control over abort, timeout, and reconnection.

## Connection state

Transport exposes a framework-neutral `ChatConnectionState` discriminated union
(`idle | connecting | connected | reconnecting | closed | error`). The Angular
chat-store adapts this to Signals.

## Architecture notes

- Route path literals are compile-time checked against the generated `paths`
  type from `@rusty-view/protocol` (`satisfies ChatPath`), preventing silent
  drift if the OpenAPI contract changes a route.
- The known `ChatEventKind` list is a `Record<ChatEventKind, true>` — if the
  contract adds a kind, regeneration breaks the build until it's added here.
- Query parameter types use snake_case to match the wire format directly.

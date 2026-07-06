# Transcript Speaker Identity

Rusty View keeps speaker identity generic. A speaker may be a human, assistant,
tool, system service, character, or any downstream-defined participant.

## Domain API

`MessageAuthor.speaker` can provide transcript chrome:

```ts
author: {
  role: 'assistant',
  displayName: 'Narrator',
  speaker: {
    label: 'Asha',
    avatarUrl: '/avatars/asha.png',
    initials: 'AS',
    avatarAlt: 'Asha portrait',
  },
}
```

Fields are optional:

- `label` overrides the visible author label.
- `avatarUrl` renders a circular avatar image.
- `initials` renders inside the circular fallback badge when no image exists.
- `avatarAlt` labels the avatar image/fallback for assistive technology.

If no speaker metadata is supplied, the renderer falls back to
`displayName`, then the author role, and derives initials from that label.

## Decorator Override

Downstream packages that cannot change projected message data can provide
`ChatMessageDecorator.decorate(...).speaker`. The decorator value wins over
`message.author.speaker` for display only.

Do not query transcript DOM to insert avatars. Supply speaker metadata through
the domain model or decorator contract so virtualization and scroll anchoring
remain owned by the transcript renderer.

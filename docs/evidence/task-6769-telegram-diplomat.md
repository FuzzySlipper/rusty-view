# Task 6769 Telegram install diplomat UI evidence

## Implemented surface

Rusty View consumes the generated Telegram diplomat admin OpenAPI contract and
keeps the installation adapter separate from profile and workspace settings.
The Service > Telegram panel exposes credential rotation, bot identity and
BotFather guidance, observed chat/topic selection, exact full-session binding,
revision-safe move/relabel/pause/resume/remove controls, and connector, delivery,
loop-budget, cursor, media, and restart diagnostics.

The binding readout presents the install label, bot, Telegram group/topic,
Crew session, agent, profile, and working directory as distinct fields. Moving
or removing a binding invokes only the binding API; it does not archive a
session or mutate a profile or working directory.

## Automated evidence

- Component tests cover distinct identity rendering, exact revisioned move
  payloads, the absence of profile/workspace mutations, and disconnected/empty
  presentation.
- Chromium coverage exercises token rotation, an exact session move, durable
  readback after reopening the panel, desktop diagnostics, and a 390 px mobile
  disconnected/empty state without horizontal overflow.
- [Desktop healthy binding and switch](task-6769-telegram-diplomat/telegram-diplomat-desktop-healthy-switch.png)
- [Desktop operations and diagnostics](task-6769-telegram-diplomat/telegram-diplomat-desktop-operations-diagnostics.png)
- [Mobile disconnected and empty](task-6769-telegram-diplomat/telegram-diplomat-mobile-disconnected-empty.png)
- [Mobile empty diagnostics](task-6769-telegram-diplomat/telegram-diplomat-mobile-empty-diagnostics.png)

## Live boundary

The updated Rusty Crew source was loaded by restarting only
`rusty-crew-debug.service` on port 9348. The generated endpoint returned an
authoritative `disabled` readback with no configured bot, candidates, or
bindings. This proves the deployed empty-state contract and UI integration but
does not constitute real-Telegram delivery certification. A real bot token and
two-install conversation are intentionally left to task 6770 rather than
inventing credentials or changing production state.

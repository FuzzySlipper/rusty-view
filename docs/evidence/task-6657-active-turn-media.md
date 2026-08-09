# Task 6657 active-turn media evidence

## Contract and implementation proof

- Rusty Crew structured-media producer: `de898a1210ea69fb46236558e0102adc98c32cce` (task 6655).
- Rusty Crew thread-scoped replay API: `6593373111cfbc5446bc3fb1c21841459c00a472` (task 6729).
- `npm run ci` passed after protocol generation, including formatting, lint, all typechecks and tests, generated-contract drift, all builds, and the design-token package smoke.
- Focused browser coverage passed for attachment rendering and transcript scroll anchoring.
- `./scripts/deploy-local.sh` deployed the exact build to both production and debug static roots before live certification.

## Live two-browser proof

Playwright scenario: `apps/rusty-view-e2e/src/live/external-live-media.live.spec.ts`

- Marker: `RV_MEDIA_1786276362839`
- Browser arrival while the turn was active: `2026-08-09T11:53:00.807Z`
- Mid-turn correction delivery: `operator:16d24ed1-8c9d-48e8-b4f6-7a8a679c0fcd`
- Native turn: `019fe65e-5405-7502-a207-621abc2be978`
- First checkpoint: sequence `1639`, item `exec-0d75819e-d779-4b88-8a94-bc536ffb0ff9`, attachment `attachment:7b2f83aac4d3a4fc52366979dec4bff9`
- Second checkpoint: sequence `1666`, item `exec-56a3de4a-9f11-46a9-a31b-d482807ac471`, attachment `attachment:d1170b739cae467a71352e742fc7b5bd`

The scenario verified:

1. Two separate `view_image` results appeared as two ordered inline media groups with blob-backed image URLs before terminal completion.
2. The second image opened in the focused viewer and Escape closed it.
3. A corrective operator message was accepted while the turn remained active, and the assistant emitted the requested acknowledgement marker before completion.
4. A hard page reload restored exactly two media groups through thread-scoped event hydration without duplicates.
5. A second isolated browser context loaded the same two images from the LAN origin `http://192.168.1.22:9348`.
6. Teardown deleted the native fixture and authoritative readback showed binding `external-binding-ec3841aed819b345ead6e750` archived.

The final run passed: `1 passed (1.2m)`.

## Defect found during certification

The first refresh probe exposed that a fleet-level event cursor could suppress selected-thread history hydration. Rusty Crew previously supported only runtime-wide replay, so fixing this in View with an unbounded global replay would have regressed long-lived runtime performance. Task 6729 added indexed `native_thread_id` replay instead; View now hydrates every uncached selected session through that bounded API while retaining the fleet cursor for live stream continuation.

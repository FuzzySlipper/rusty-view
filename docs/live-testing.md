# Rusty View Live Conversation Testing

Live conversation testing is the agent-run verification path for issues that
depend on the actual rendered chat UI, real streaming, or real controls.

Use it when work touches:

- transcript rendering or scroll behavior;
- streamed assistant turns;
- reasoning, tool, command, attachment, or debug blocks;
- profile/session selection;
- controls whose value is visible only after real interaction.

## Evidence Rule

For live UI claims, rendered browser output is primary evidence. Screenshots,
visible transcript text, the evidence packet, and Playwright traces are the
proof. Store state, raw events, CSS classes, and deterministic tests are
diagnostic evidence only.

Do not close a UI task because a synthetic test passed if the task concerns real
conversation rendering, long streaming, or an interactive control. Run the real
frontend against a real Rusty Crew backend/profile/LLM and inspect the artifacts.
Do not use an automated judge as the close criterion for rendered chat behavior;
it creates an easy false-positive exit. The agent doing the work must inspect
the actual screenshots/evidence and report what the UI did.

Long-streaming coverage should use a genuinely demanding real prompt against the
`tester` profile. Do not add artificial slow profiles or delay hooks just to
satisfy timing. If a long-streaming scenario completes too quickly, improve the
prompt so it asks for substantive real analysis.

## Commands

The normal e2e suite skips live scenarios. Opt in explicitly:

```bash
pnpm e2e:live
```

For visual debugging:

```bash
pnpm e2e:live:headed
```

Useful environment variables:

```bash
RV_LIVE_BACKEND_URL=http://127.0.0.1:9347
RV_LIVE_PROFILE=tester
RV_LIVE_MIN_STREAMING_MS=15000
```

Run a focused scenario:

```bash
RV_LIVE_RUN=1 pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  --grep "@reasoning" \
  --project=chromium --headed
```

## Artifacts

Each live scenario writes artifacts under Playwright's test output directory in
a `live-artifacts` folder:

- milestone screenshots;
- before/after screenshots for visual-impact checks;
- `trace.zip`;
- `console.json`;
- `page-errors.json`;
- `visible-transcript.txt`;
- `debug-snapshot.json`;
- `evidence-packet.json`;
- `scenario-summary.md`.

Agents must inspect the screenshots before reporting success. For controls,
compare before/after screenshots and confirm the actual rendered region changed.
For streaming, inspect the in-progress screenshot, not only the final response.

`evidence-packet.json` is the compact run record. It contains environment
metadata, selected profile/backend/base URL, screenshot paths, debug snapshot
milestones, turn summaries, visual-impact checks, console/page errors, visible
transcript text, and a streaming timeline. Use it to diagnose whether a failure
is received-but-not-projected, projected-but-not-rendered, or rendered-but-not-
completed.

## Scenario Templates

Behavior-oriented templates live under
`apps/rusty-view-e2e/src/live/*.live.spec.ts`.

- `baseline-multiturn`: normal real multi-turn conversation.
- `long-streaming`: naturally long real LLM answer using project-analysis
  prompts.
- `reasoning-controls`: reasoning block expand/collapse visual impact.
- `activity-and-followup`: tool/command activity attachment and rapid followup.
- `scroll-and-refresh`: scroll interaction during streaming and refresh recovery.

Prefer adding another behavior template over writing a narrow one-off probe for a
single past bug. The prompt may include markers or concrete requested content
when that is needed to verify persistence/refresh, but avoid shaping the runtime
into a fake path that normal usage will not take.

## Scenario Pattern

Live scenarios should:

1. Require `RV_LIVE_RUN=1`.
2. Open the real app and select a real profile.
3. Send prompts through the real message composer.
4. Wait for assistant start/completion through the rendered transcript.
5. Capture screenshots at meaningful milestones.
6. Use visual-impact checks for controls.
7. Capture debug snapshots at meaningful milestones.
8. Leave a short note describing what a human/agent inspected.

Useful timeline milestones to check in the evidence packet:

- user send;
- first assistant state;
- first visible assistant row;
- first visible assistant content;
- streaming observation window;
- assistant completion.

## Completion Evidence Template

When reporting live UI verification, include:

```text
Live scenario:
Command:
Backend/profile:
Artifacts:
Screenshots inspected:
Rendered behavior observed:
Evidence packet:
Timeline notes:
Supporting checks:
Residual risk:
```

If a live scenario could not run, say why directly. Do not substitute a passing
unit test or store-state check for real rendered UI evidence.

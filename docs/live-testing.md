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

The normal e2e suite skips live scenarios. Agents should run live scenarios
through the shared Playwright broker service, following the Den Services usage
doc `den-services/playwright-broker-agent-usage`
(`/home/dev/den-services/playwright-broker/docs/agent-usage.md`). The repo
manifest is `den-playwright.json`; the broker owns the dev-server host/port,
sets `BASE_URL`, records run metadata, and keeps agents from killing unrelated
processes on busy ports.

From `/home/dev/den-services`:

```bash
export DEN_PLAYWRIGHT_BROKER_CONFIG_PATH=/home/dev/den-services/playwright-broker/config/config.example.yaml

go run ./playwright-broker/cmd/den-playwright run rusty-view \
  -repo /home/dev/rusty-view \
  -den-project rusty-view \
  -den-task <task-id> \
  --grep @live-agent \
  --pw-project chromium
```

For visual debugging:

```bash
go run ./playwright-broker/cmd/den-playwright run rusty-view \
  -repo /home/dev/rusty-view \
  -den-project rusty-view \
  -den-task <task-id> \
  --grep @live-agent \
  --pw-project chromium \
  --headed
```

Useful environment variables:

```bash
RV_LIVE_BACKEND_URL=http://127.0.0.1:9347
RV_LIVE_PROFILE=tester
RV_LIVE_PROFILE_PREFIX=rv-live-custom
RV_LIVE_PROFILE_ISOLATION=0
RV_LIVE_MIN_STREAMING_MS=15000
```

`RV_LIVE_PROFILE` names the existing source profile whose provider/tool defaults
should be reused. When `RV_LIVE_RUN=1`, the live fixture isolates by default: it
creates one fresh Rusty Crew profile/session per Playwright test through
`POST /v1/admin/control/profiles`, using a generated `rv-live-*` profile id. Set
`RV_LIVE_PROFILE_PREFIX` only to customize that generated id prefix. Set
`RV_LIVE_PROFILE_ISOLATION=0` only for deliberate debugging against an existing
profile transcript.

The isolated profile derives its provider alias and local tool profile from the
active session for `RV_LIVE_PROFILE`, so `tester` can remain the configured
cheap-provider source without sharing transcript history. Override those
defaults with `RV_LIVE_PROVIDER_ALIAS` and `RV_LIVE_LOCAL_TOOL_PROFILE_ID` only
when a scenario needs a different runtime shape.

Run a focused scenario:

```bash
go run ./playwright-broker/cmd/den-playwright run rusty-view \
  -repo /home/dev/rusty-view \
  -den-project rusty-view \
  -den-task <task-id> \
  --grep "@reasoning" \
  --pw-project chromium
```

The local scripts remain available as a manual fallback when the broker service
is unavailable or the user explicitly asks for a direct run:

```bash
pnpm e2e:live
pnpm e2e:live:headed
```

## Artifacts

Each live scenario writes artifacts under Playwright's test output directory in
a `live-artifacts` folder. Rusty View's Playwright config defaults this output
to `/tmp/rusty-view/playwright-output/<playwright-pid>` so artifact writes do
not trigger Angular/Nx dev-server rebuilds or browser reloads. Override it with
`RV_PLAYWRIGHT_OUTPUT_DIR` only when the chosen path is outside watched
workspace build/source directories. Broker-managed runs also provide
`PLAYWRIGHT_BROKER_ARTIFACT_ROOT`, `PLAYWRIGHT_BROKER_EVIDENCE_PATH`, and a
`run-index.json` that links the test run, server allocation, Den task metadata,
and artifact paths. The broker marks live UI runs as requiring human/agent
inspection; do not treat that marker as a failure.

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
4. Correlate the turn to the user message that was just rendered.
5. Wait for assistant start/completion after that user message, through the
   rendered transcript.
6. Capture screenshots at meaningful milestones.
7. Use visual-impact checks for controls.
8. Capture debug snapshots at meaningful milestones.
9. Leave a short note describing what a human/agent inspected.

The live fixture anchors each turn to the exact user prompt it just sent before
looking for the assistant response. This lets the suite run against a profile
with old transcript history without generic "latest assistant" waits passing on
stale rows. When adding scenarios, keep prompts unique and substantive enough
that the rendered response can be inspected as the response to that turn.
Profile-prefix isolation is stronger and should be the default for full
`@live-agent` certification; prompt correlation remains a guardrail inside each
isolated profile, for deliberate non-isolated reruns, and for refresh-in-test
flows.

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

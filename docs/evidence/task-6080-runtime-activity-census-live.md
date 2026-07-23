# Task 6080 Runtime Activity Census Live Certificate

Date: 2026-07-23

Target: `rusty-crew-debug.service` at `http://127.0.0.1:9348`, using its
isolated debug database and the Rusty View bundle deployed by
`./scripts/deploy-local.sh`.

## Browser Scenario

The opt-in Playwright scenario submitted a real `tester-session` wake whose
`tester-chat` provider called the real `terminal` tool with `sleep 60`. While
the subprocess was running, the Active Agents debug view rendered the complete
Crew-owned hierarchy:

```text
dispatch
  wake
    provider_request
      tool_call terminal
        subprocess sleep
```

The same live screen also rendered two managed Codex `external_turn` records.
Switching the selector to **Durable Rust projection** refreshed the census from
Crew and displayed `session_projection_mismatch` on each native activity while
the durable session projection was still idle. The view identified the
automatic cancellation policy as disabled; no timeout or stop action was
performed by View.

The browser screenshot is
[`runtime-activity-census-live.png`](task-6080-playwright-live-passed/live-runtime-activity-cens-ec2cb--and-managed-Codex-activity-chromium/runtime-activity-census-live.png).

After capture, the debug service was restarted to terminate only the
certificate wake and leave the shared debug deployment clean.

## Commands And Results

```text
npm run ci
  PASS: formatting, design-token guard, all lint/typecheck/test targets,
  generated protocol check, all builds, and package smoke

./scripts/deploy-local.sh
  PASS: deployed 8 production files and 8 debug files

BASE_URL=http://127.0.0.1:9348 \
RV_LIVE_BACKEND_URL=http://127.0.0.1:9348 \
RV_ACTIVITY_CENSUS_LIVE_RUN=1 \
RV_PLAYWRIGHT_OUTPUT_DIR=/home/dev/rusty-view/docs/evidence/task-6080-playwright-live-passed \
pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/live/runtime-activity-census.live.spec.ts \
  --project=chromium
  PASS: 1 passed (5.7s)
```

The activity transport uses the configured Crew origin and `cache:
no-store`. The independent certificate probe also uses a unique query value,
so polling cannot reuse an initial empty census while work becomes active.

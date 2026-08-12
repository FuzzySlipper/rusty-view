# Task 6854 Den operator readability playtest

Date: 2026-08-12  
Task: Den `rusty-view#6854`  
Finding: `R6854-6`  
Outcome: `pass`

## Exact source and running boundary

- Rusty View source revision exercised: `0f1a6da27332921bb94f42294aa315900185fbff` on `main`, equal to `origin/main` before this evidence-only document was added.
- The checkout had two pre-existing user-owned modifications, `AGENTS.md` and `agents-project.md`; the playtest did not modify them.
- The disposable certification server served the exact production assets from `/home/system/rusty-crew/site`:
  - `main-2RYZYIXP.js`: `7cc4033c6038139d4e8848a4b57f470f1cd6245db240440bba0d7f9bbb3621ea`
  - `styles-ZJ3PMY66.css`: `311ba9690baf5e9161b75fd420305181e1a11eeef8455759151769106d5c80dc`
  - `index.html`: `238f4c45e09692adb9bd81746b89b5b68afd08fafbcd54d9167c668202c85994`
- Ordinary API reads were proxied to the production Rusty Crew service on `127.0.0.1:9347`.
- No Den task, review submission, route, profile, session, service configuration, or Crew database record was created or changed.

## Fixture provenance

The layout run deliberately kept data authority separate from presentation coverage.

- `Waiting for checks`, `Checks failed`, `Approved`, `Changes requested`, and `Superseded` were selected from current production review-pipeline records.
- `Notification failed` and an unknown `future_pipeline_stage` were synthetic generated-contract presentation fixtures because no current production record represented those rare states.
- The unknown stage exercised the conservative `Needs inspection` fallback.
- The fixtures existed only in the disposable HTTP process. They were never inserted into Den or Rusty Crew persistence.

## Playtest mission and result

The configured `gpt-5.6-luna` playtester ran at `max` effort in Chromium 149 at a normal `1440x900` operator viewport. It used visible Service navigation to open Service Config and selected **Den** from the standard `Runtime / Telegram / Memory / Switchboard / Den` tab row.

The visible result was `pass` with high confidence:

- All seven operator labels were readable and distinguishable across normal scroll positions: `Waiting for checks`, `Checks failed`, `Approved`, `Changes requested`, `Notification failed`, `Superseded`, and `Needs inspection`.
- Task, status, gate/round, reviewer delivery, next action, and action columns remained aligned and non-overlapping.
- Status color and plain-language next-action text made waiting, failure, successful, superseded, and fallback rows scannable without reading internal phases.
- Opening Diagnostics on an approved managed row preserved the table layout and exposed its raw internal stage, phase, and revision.
- Opening Diagnostics on the fallback row preserved the table layout and visibly exposed `future_pipeline_stage / future_pipeline_stage / 8`.
- The playtester did not activate **Prompt reviewer**, **Save and apply**, or any other mutating control.

Accessibility/DOM inspection was used only to locate controls and confirm text after visible interaction. A bounded page scroll evaluation was used after unsupported typed scroll aliases; screenshots remained the authority for the readability and overlap judgment.

## Indexed evidence

Evidence index:

`/home/agent/.codex/playtester/runs/rusty-view-task-6854/rusty-view-task-6854-playtest-20260812T102651.617706653Z-1858741/playtest-index.json`

Key screenshots under that run's `screenshots/` directory:

- `0002-service-navigation-open.png` — standard Service Config navigation.
- `0003-den-tab-review-pipeline-top.png` — Den authority and top pipeline rows.
- `0004-review-pipeline-middle-rows.png` — middle statuses including notification failure.
- `0005-review-pipeline-bottom-rows.png` — all seven compact rows in one table view.
- `0006-approved-row-diagnostics-open.png` — normal managed-row raw diagnostics.
- `0008-needs-inspection-diagnostics-stage-visible.png` — notification failure, superseded, fallback, and visible fallback stage/phase diagnostics.

The index records seven passing assertions for navigation, Den selection, table readability, representative states, managed diagnostics, fallback diagnostics, and no mutation.

## Harness discrepancies and cleanup

The broker retained advisory `sequence_missing` entries and four unsupported action-alias errors (`scroll`, `wheel`, `press`, and key aliases). The run continued with supported visible clicks plus one bounded scroll evaluation. These discrepancies did not suppress an interaction or influence the visible layout verdict.

Final cleanup readback records:

- browser closed: `true`
- disposable server stopped: `true`
- virtual display stopped: `true`
- driver stopped: `false`

The remaining driver and server PIDs were defunct and port `9430` had no listener after finalization. The durable evidence therefore retains a driver cleanup-flag discrepancy while the product outcome remains `pass`.

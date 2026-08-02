# Cross-browser paused anchor evidence — task #6572

Captured 2026-08-02 against Rusty View source based on
`9720a5e94f81057d3fbd39638e457317526a281b`.

## Falsified assumption

The owned transcript window originally delegated paused anchoring to CSS
`overflow-anchor`. Chromium and Firefox held the semantic row, but the exact
fail-closed contract in WebKit retained an 8px displacement after image decode
and every later mutation, rising to 10px after font/code reflow. Following,
idle refresh, navigation, session replacement, and input controls otherwise
passed. This proved that browser-owned paused geometry was not one portable
authority.

## Revised authority

The viewport now disables native overflow anchoring and owns one explicit
cross-browser correction path:

- a MutationObserver corrects Angular/DOM and root presentation mutations
  before the next animation-frame sample;
- a ResizeObserver covers media, font, and other layout-only changes;
- corrections are coalesced and recorded as
  `paused-anchor-compensation` through the existing bounded write trace;
- explicit wheel, touch, scrollbar, and keyboard input releases the anchor
  before the browser applies user motion, so compensation cannot resist it;
- tail following, seeks, replacement, and Latest retain their existing
  separately attributed states within the same component authority.

The contract now asserts computed `overflow-anchor: none`, rejects every paused
application write reason except `paused-anchor-compensation`, and retains the
strict semantic requirement that every sampled frame keep the same row within
1px. It does not permit a recovered transient drift.

## Exact fail-closed matrix

Chromium and Firefox ran on the host:

```text
RV_TRANSCRIPT_RENDERER=owned-window RV_TRANSCRIPT_REQUIRE_PASS=1 \
pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=chromium --project=firefox --reporter=line --workers=1
```

Result: 6/6 passed. Both engines reported zero drift for all six paused
mutations, exactly two attributed compensation writes during the mutation
sequence, zero application writes during user input, and 64-row bounded
navigation/replacement.

The host lacks WebKit's runtime libraries, so the same source and installed
dependencies ran in Playwright's official matching image:

```text
docker run --rm --network host --user 1001:1002 \
  -e HOME=/tmp -e BASE_URL=http://127.0.0.1:4200 \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e RV_TRANSCRIPT_RENDERER=owned-window \
  -e RV_TRANSCRIPT_REQUIRE_PASS=1 \
  -v /home/dev/rusty-view:/work -w /work \
  mcr.microsoft.com/playwright:v1.61.0-noble \
  node node_modules/@playwright/test/cli.js test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=webkit --reporter=line --workers=1
```

Result: 3/3 passed. WebKit reported zero drift across image decode, tail growth,
new message, prepend, reasoning expansion, and font/code reflow; the sole
authority check saw two attributed compensation writes and native anchoring
disabled. Wheel/trackpad, synthetic touch/momentum, scrollbar drag, Home/End,
and Latest all passed with zero compensation writes during user input.

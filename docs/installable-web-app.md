# Install Rusty View as an app

Rusty View advertises a same-origin web app manifest. In Chromium, open the
deployed Rusty View site and use **Install Rusty View** from the address bar or
browser menu. The installed surface uses a standalone window but talks to the
same Rusty Crew API as the normal browser page.

The manifest intentionally does not register a service worker or cache API,
session, transcript, or credential data for offline use. Rusty View is a live
operator console; stale offline state would be misleading.

When using the normal local deployments on ports `9347` or `9348`, the app and
Crew API share an origin. The development-only `?api=` override remains
ephemeral and is not embedded in the manifest or persisted as an install URL.

## Install and standalone certification

The normal Chromium test checks the parsed manifest and Chromium's
installability errors. A separate live certification uses a persistent browser
profile, invokes Chromium's `navigator.install()` flow, accepts the native
install dialog, verifies `display-mode: standalone`, observes a same-origin Crew
session response from the deployed debug API, and repeats those checks after
refresh. The certification does not intercept or synthesize Crew routes:

```sh
BASE_URL=http://127.0.0.1:9348 RV_PWA_INSTALL_RUN=1 \
  xvfb-run -a pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  --project=chromium --headed --workers=1 \
  --grep @pwa-install-live
```

This Linux certification requires a C compiler plus X11 and XTest development
libraries. The small X11 helper only confirms Chromium's native install dialog;
all install, launch, display-mode, URL, refresh, and Crew assertions remain in
Playwright. Standard desktop Chromium builds do not expose the ChromeOS-only
`PWA.install` CDP lifecycle domain, so the test deliberately exercises the real
desktop install UI instead.

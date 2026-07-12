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

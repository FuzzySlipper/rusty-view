# Recorded Transport Fixtures

These fixtures are sanitized Rusty Crew HTTP/SSE responses used by transport
conformance tests.

Rules for refreshing or adding fixtures:

- Capture only local/dev traffic intended for tests.
- Replace prompts, profile names, hostnames, ids, and model aliases with
  synthetic values.
- Never include bearer tokens, provider secrets, raw private prompts, local file
  paths, or machine-specific data.
- Keep the backend envelope shape intact so tests exercise the real transport
  parsing path.
- Add at least one assertion that proves the fixture affected parsed output.

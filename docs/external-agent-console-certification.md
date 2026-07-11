# Rusty View External-Agent Console Certification

This certification edit was performed through the Rusty View external-agent console.

- **Den task:** `5664`
- **Native thread:** `019f5085-b337-7740-97da-4b25d86bde41`
- **Validation:** `pnpm exec prettier --check docs/external-agent-console-certification.md`

The inspected UI exposes a searchable Agents sidebar with runtime, Den task mapping, working directory, thread status, and attention state. Selecting a session projects its external-agent activity into the main transcript and provides turn status, auto/steer/queue composer modes, an interrupt control, pending structured interactions, and raw event inspection.

Agent fleet attention remains visible independently of the selected transcript.

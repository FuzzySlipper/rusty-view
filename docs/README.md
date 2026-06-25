# Roleplay System Design Documents

Working design notes for a service-oriented collaborative fiction / roleplay
system built on rusty-crew infrastructure.

## Status

Exploratory design. Not yet a Den project. These documents capture
architecture decisions and reasoning for evaluation before implementation.

## Context

The goal is a replacement for SillyTavern-style roleplay that uses agent
infrastructure (rusty-crew) and a purpose-built lore/memory service rather
than client-side prompt assembly and keyword-triggered lore injection.

Key prior art:
- **QuillForge** (`/home/dev/quillforge`) — previous attempt, C#/.NET, multi-agent pipeline. Too heavyweight for RP; lessons captured in `04-quillforge-postmortem.md`.
- **SillyTavern** (`/home/research/SillyTavern`) — current solution for the users. Works but architecturally fragile, cache-hostile, and couples prompt logic to the UI.
- **rusty-crew** (`/home/dev/rusty-crew`) — Rust+TS agent service. Planned host for the RP harness.
- **den-memory** (`/home/dev/den-memory`) — Graph-guided memory substrate. Architectural template for the RP lore service, but wrong domain fit for direct use.

## Related design documents

Existing docs in this directory that informed this design:

| Document | Relevance |
|---|---|
| `successor-pattern.md` | The framework for how QuillForge → this system should be understood. This IS a successor pattern application. |
| `rusty-view.md` | Detailed frontend architecture for rusty-crew chat. The `rusty-view` / `rusty-theaterkid` two-repo separation is the frontend foundation. |

## Document Index

| Document | Purpose |
|---|---|
| `00-system-overview.md` | Core architecture shape, key decisions, design philosophy |
| `01-lore-service-design.md` | Purpose-built RP lore/memory service ("lorekeep") |
| `02-narrator-agent-and-loop.md` | Single-agent loop, two-phase generation, tool surface |
| `03-mechanic-ooc-agent.md` | Diagnostic/mechanic agent, separate sessions, config tools |
| `04-quillforge-postmortem.md` | What QuillForge did right/wrong, what carries forward |
| `06-context-compaction.md` | Scene-aware compaction, director's notes, fact extraction, tool-result lifecycle |
| `05-project-layout.md` | Proposed repos, services, dependency graph |
| `07-rusty-view-plugin-api.md` | Generic Rusty View plugin hooks for downstream UI and agent/mechanic actions |
| `08-message-alternates.md` | Generic message slot/variant primitive and backend storage/API gaps |
| `09-conversation-tree-navigation.md` | Generic branch/snapshot navigation primitives and backend gaps |
| `10-attachments-and-data-bank.md` | Generic attachment, inline media, extracted text, and reusable file-scope primitives |
| `11-transcript-search-navigation.md` | Generic current-conversation search, result highlighting, virtual-scroll jump navigation, and backend search gaps |
| `12-rendering-configuration.md` | Generic Markdown literal exclusions, underscore handling, and code block controls |

## Naming

No project name chosen yet. Working names used in these docs:
- **The harness** — the overall RP system (rusty-crew profile + frontend)
- **lorekeep** — working name for the RP lore/memory service
- **narrator agent** — the in-character RP agent
- **mechanic agent** — the OOC diagnostic/configuration agent

These are placeholders for Patch to rename.

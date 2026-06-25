# System Overview

## What this is

A service-oriented collaborative fiction / roleplay system that replaces
SillyTavern's client-side prompt-assembly model with an agent-driven
architecture built on rusty-crew.

The users (roleplayers currently on SillyTavern) want: better narrative
quality, stable sessions, lore-aware responses, and the ability to diagnose
and fix problems when the output isn't working. They don't need: character
card ecosystems, extension marketplaces, prompt micro-tuning, or fast
response times.

## Core architecture decisions

### 1. Single agent with tools, not multi-agent pipeline

QuillForge used a three-agent pipeline (Narrative Director → ProseWriter →
Librarian) with a structured classification protocol between them. This was
over-engineered for RP chat. "Narrate one good response" is one job, not
three separable stages.

A single agent loop that can call tools (search lore, get scene state,
capture facts) dissolves the inter-agent classification protocol entirely.
The classification that QuillForge spent enums and classifiers on — "is
this fact about Xavier or Caleb?" — happens naturally in the agent's
reasoning. No serialization boundary, no protocol overhead, no drift
harness.

See `04-quillforge-postmortem.md` for the full analysis.

### 2. Two-phase generation within the single agent loop

The narrator agent operates in two phases per turn:

**Phase 1 — Scene Preparation (exploration):**
- Receives user's RP message
- Queries lore service for relevant world context
- Optionally delegates deeper exploration to a librarian subagent (rusty-crew delegation)
- Assembles a scene brief: distilled context for this response

**Phase 2 — In-Character Response (composition):**
- Generates the actual RP response using the scene brief
- Clean generation pass in narrator voice
- Optional review sub-phase for self-correction before delivery

The separation matters because tool-call reasoning in visible output breaks
immersion. The frontend shows a "thinking..." indicator during Phase 1, then
the response streams during Phase 2.

### 3. Service-owned prompt composition, not user-editable prompts

The user never sees or edits prompt strings. The service composes prompts
from typed configuration:

| User-facing control | Service translation |
|---|---|
| Tone (literary / pulpy / cozy / dark) | Style exemplar selection |
| Explicitness (none / fade / explicit) | RLHF framing + content gating |
| Pacing (slow / standard / fast) | Response length guidance |
| Memory depth (shallow / standard / deep) | Exploration rounds + retrieval budget |

This replaces SillyTavern's fifteen-field prompt assembly ceremony, which
exists for historical reasons (positional attention sensitivity in old
models) and RLHF evasion, neither of which requires user-visible prompt
editing in a service model.

### 4. Style exemplar as primary quality lever

The first message / opening scene functions as a few-shot exemplar for
style. Instead of telling the model "write in third person, present tense,
literary prose, focus on sensory details" (weak, often ignored), you show
it one turn of the target voice (strong, reliably pattern-matched).

This is "show don't tell" applied to prompting. The style exemplar does
more work than any amount of system prompt prose. The system prompt's job
becomes register establishment and permission, not style instruction.

### 5. Separate OOC/mechanic sessions

Meta-discussion (OOC) happens in a separate rusty-crew session with a
different system prompt and a different toolset. The mechanic agent is a
diagnostician, not an introspection tool. It reads RP session internals
(session history, scene briefs, recall logs, config) and proposes fixes.

ST's OOC-in-session pattern contaminates context in both directions: OOC
text enters RP history (pulling the model out of voice), and the RP-warm
model is poorly positioned for analytical work.

The mechanic agent has tools that touch UI hooks and configuration:
propose_config_change, update_style_exemplar, adjust_lore_tags,
apply_proposal. Proposals are reviewed and approved by the user before
application. This creates a diagnostic loop: identify problem → propose fix
→ test → iterate.

See `03-mechanic-ooc-agent.md` for the full design.

### 6. Purpose-built lore service, not den-memory directly

den-memory's architecture (FTS5, topic graph, scoped recall, token
budgeting, contract-first design) is the right template. But den-memory's
domain model (agent operations, claim strengths, capture/curate workflow)
is wrong for RP lore.

The RP lore service ("lorekeep") follows den-memory's patterns but uses
RP-native vocabulary: campaigns instead of projects, canon levels instead
of claim strengths, authored lore + established facts instead of captured
candidates.

See `01-lore-service-design.md` for the full design.

### 7. Context management as the primary output quality lever

Context isn't passive — it's an active force with momentum. Everything in
the model's context window exerts gravitational pull on the output. The
primary lever for output quality is managing what's in context and how,
not tweaking prompt language.

This has direct architectural consequences:
- Scene briefs are fresh every turn (intentional seeding independent of chat history)
- Session resets are non-destructive (world state persists in lore service, chat history preserved as reference)
- Accumulated context is observable (mechanic can inspect full context to diagnose gravity problems)
- New RP sessions can start while mechanic sessions continue (controlled experiments on output quality)

### 8. RLHF handling: gravity correction, not jailbreaking

Modern API models rarely refuse outright in RP content. The real problem is
"PG-13 gravity" — models pull toward chaste, measured, conciliatory output
regardless of prompting. This is the same gravity seen in political/historical
analysis: models default to Wikipedia voice even when asked for perspective.

The fix is not adversarial jailbreak framing. It's register establishment:
giving the model character, context, and permission to commit to a voice.
The service handles this invisibly. If the review pass detects gravity drift
(too restrained, conflict resolved too neatly, emotional beat pulled), it
re-generates with register-targeted guidance.

## System shape

```
┌─────────────────────────────────────────────────┐
│ FRONTEND (thin client)                           │
│  • send user message / receive streaming tokens  │
│  • mode switch: RP mode ↔ OOC/mechanic mode      │
│  • proposal review UI (diffs before apply)       │
│  • campaign/session management                    │
│  • knows NOTHING about lore, memory, prompts     │
└──────────────────┬──────────────────────────────┘
                   │ session events (SSE/WS)
┌──────────────────▼──────────────────────────────┐
│ RUSTY-CREW SERVICE                               │
│  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ Narrator Session│  │ Mechanic Session     │  │
│  │ (RP profile)    │  │ (mechanic profile)   │  │
│  │                 │  │                      │  │
│  │ Tools:          │  │ Tools (read):        │  │
│  │  search_lore    │  │  get_rp_history      │  │
│  │  recall_lore    │  │  get_scene_brief     │  │
│  │  get_scene_state│  │  get_recall_logs     │  │
│  │  capture_fact   │  │  get_config          │  │
│  │                 │  │  search_lore         │  │
│  │ Phases:         │  │                      │  │
│  │  explore→compose│  │ Tools (write):       │  │
│  │                 │  │  propose_change      │  │
│  └────────┬────────┘  │  apply_proposal      │  │
│           │           └──────────┬───────────┘  │
│  ┌────────▼──────────────────────▼───────────┐  │
│  │     Rust Session Management               │  │
│  │  (lifecycle, state, restart hydration)     │  │
│  └──────────────────┬───────────────────────┘  │
└─────────────────────┼───────────────────────────┘
                      │ HTTP
┌─────────────────────▼───────────────────────────┐
│ LOREKEEP (RP lore/memory service)                │
│  • FTS5 + topic graph                            │
│  • Campaign-scoped entries                       │
│  • Authored lore + established facts             │
│  • Retrieval traces / observation surface        │
│  • Tunable scoring and filtering                 │
└──────────────────────────────────────────────────┘
```

## Design philosophy

### Service owns the complexity, frontend stays dumb

The frontend sends `POST /session/{id}/message {text: "..."}` and receives
typed session events (phase changes, streaming tokens, completion). It
doesn't know about lore injection, prompt composition, token budgets, or
exploration phases. Adding a new agent loop phase doesn't require frontend
changes — the frontend renders whatever phases the service emits.

This is the fundamental thing ST gets wrong: its UI is simultaneously the
prompt architect, API client, context manager, and renderer. Separating
these concerns is the core architecture win.

### Server deployment, Tailscale access

QuillForge's local-first desktop app model proved unreliable for
non-technical users. Mac app isolation, updates, and platform-specific
issues were constant friction. Meanwhile, Tailscale VPN for LAN-only ST
access has worked perfectly for over 6 months.

The system is server-first: all services run on den-srv or den-k8. Users
access it via browser over Tailscale. No Electron. No app packaging. No
platform-specific builds. One deployment target. Updates are server-side
— users see a web app, not software that needs installing.

### UX is day-1, not deferred

An operator client isn't enough. The users need to be comfortable leaving
SillyTavern, which means the RP frontend must feel usable from day one.
This doesn't mean cloning ST's UI — much of their UX is confusing, and the
internal architecture is part of why. But transition friction needs to be
minimized:

- Lore book migration must be smooth (one-time import)
- First-run experience must work without configuration drift
- The chat UI should feel familiar (messages, streaming, retry/regenerate)
- Concepts they care about (characters? lore? scene?) must be accessible
  without prompt editing

The rusty-view/rusty-roleplay two-repo separation still holds, but
rusty-roleplay is in the critical path, not a future layer.

### The model isn't a deterministic program

LLMs — and arguably any intelligence worth the name — have a fuzzy
relationship to their own output. "Why did you generate that?" is a
category error. The system doesn't try to make the model introspect; it
provides environmental diagnosis (the mechanic agent reads conditions, not
thoughts).

### Show don't tell, for both style and structure

Style exemplars demonstrate voice more reliably than instructions describe
it. The same principle applies to system architecture: demonstrating a
scene's emotional register in the scene brief works better than instructing
the model to "be tense."

### Multiple frontends, one service

Because the frontend is thin, "Discord bot" and "web app" are just two
transports over the same service. A spike can ship as a Discord bot with
~200 lines of message handling. A web UI built later doesn't duplicate
logic — it's a different render of the same session events.

## Relationship to existing systems

### rusty-crew

The harness lives on rusty-crew as a set of profiles (narrator, mechanic)
with tool configurations. rusty-crew provides:
- Battle-tested agent loop (pi-agent-core) — we don't own this
- Rust session management — durable, restartable
- Delegation — librarian subagent for complex lore exploration
- Profile-based tool availability
- Den integration for observability

### den-memory

Architectural template, not a dependency. lorekeep follows den-memory's
patterns (FTS5, topic graph, scoped recall, contract-first design) but is
a separate service with RP-native vocabulary. See `01-lore-service-design.md`.

### QuillForge

Prior art for the concept. Lore exploration, register control, style
exemplars, state separation — all validated. Multi-agent pipeline, structured
classification protocol, drift harness — too heavyweight, not carried
forward. See `04-quillforge-postmortem.md`.

### SillyTavern

The system being replaced. SillyTavern lore books migrate to lorekeep
entries (script, not architecture problem). The users' existing lore content
is the migration input.

## Open questions

1. **Naming** — project name, service names, profile names
2. **Model selection** — which models for narrator vs librarian vs mechanic?
   Different cost/quality tradeoffs per role.
3. **Spike scope** — Discord bot frontend first? What's the minimal viable
   agent loop to validate the two-phase approach?
4. **Lore service implementation language** — Go (following den-memory) or
   Rust (following rusty-crew coordination layer)?
5. **Session event transport** — SSE vs WebSocket for frontend streaming
6. **Librarian delegation** — always spawn for Phase 1, or only on complex
   lore needs? Cost/quality tradeoff.

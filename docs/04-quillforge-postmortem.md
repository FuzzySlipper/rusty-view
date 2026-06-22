# QuillForge Postmortem

*This document is an application of the successor pattern (see
`successor-pattern.md`). QuillForge is the predecessor — treated as
evidence, not sacred property. This document serves as the lesson packet
extraction and the "do not inherit" section for the RP system successor.*

## What QuillForge was

QuillForge (`/home/dev/quillforge`) is a C#/.NET AI-powered creative writing
system with eight working modes: Guide, Writer, Roleplay, Lore Builder,
Forge, Council, Research, and Games. It was a ground-up rewrite of an older
Python/FastAPI app, adding stronger architecture boundaries, better session
handling, and multi-provider support.

It was based on the CreAgentive paper (Agent Workflow Driven Multi-Category
Creative Generation Engine) and showed real promise for novel writing. The
Forge pipeline (planner → writer → reviewer) and Council mode (multi-advisor
synthesis) were genuinely useful for long-form fiction.

But as a roleplay client for the users (Patch's wife and her sister), it
was too heavyweight and confusing. The architecture that served novel
writing actively worked against RP chat.

## What QuillForge got right

These concepts are validated and carry forward to the new system.

### Lore exploration over keyword injection

The Librarian agent and lore-backed responses were the right idea. Lore
should be explored on demand, not blindly injected by keyword triggers.
This is the core insight that the new system builds on — just with a single
agent calling tools instead of a separate librarian agent.

### Style exemplar as primary style lever

QuillForge's writing-style system and first-message exemplars worked. The
model pattern-matches on demonstrated voice more reliably than it follows
enumerated style rules. This carries forward directly.

### State type separation

QuillForge correctly distinguished four kinds of state:
- **AppConfig** — app-wide durable config (providers, model routing)
- **ProfileConfig** — reusable bundles of author choices (lore set, writing style, RP defaults)
- **SessionState** — live runtime for one session (active mode, character selected, pending content)
- **ConversationTree** — persisted branching message artifact

This separation prevented bugs and made branching/debugging less brittle.
The new system maps to this:
- AppConfig → service-level config
- ProfileConfig → narrator/mechanic profiles
- SessionState → Rust session state (scene state)
- ConversationTree → chat history (with session archive)

### Register control over prompt tweaking

QuillForge's tone controls and narrative rules were the right abstraction
level. Users should control tone, pacing, and explicitness — not raw prompt
text. The new system's typed configuration surface (tone, explicitness,
pacing, memory depth) descends from this.

### Provider abstraction

Multi-provider support (Anthropic, OpenAI, Ollama, OpenRouter, Azure,
OpenAI-compatible) is table stakes but QuillForge's clean adapter pattern
was sound. rusty-crew's pi-agent-core handles this now, so we don't need
to own it.

## What QuillForge got wrong for RP

### Multi-agent pipeline for a single job

The three-agent RP pipeline was the core mistake:
```
Narrative Director → ProseWriter → Librarian
```

"Narrate one good response" is one job, not three separable stages.
Decomposing it created problems that didn't exist in a single-agent approach:

**Serialization boundary degradation:** Each agent handoff required
flattening rich understanding into JSON (RoleplayKnowledgePacket,
StructuredSceneBrief). The downstream agent had to reconstruct meaning from
the serialization, losing nuance.

**Protocol overhead tax:** Five enums (RoleplayKnowledgeScope,
ActiveSubjectApplicability, AllowedUse, CanonAuthority, SubjectSourceKind),
a deterministic classifier using file-path heuristics and name-mention
counting, and directive sections in prompts. All of this existed to
compensate for agents not sharing a reasoning context. In a single agent,
none of it is needed.

**Token cost:** Multiple LLM calls per turn, each with its own prompt
construction. For RP chat where you want fast iteration, this is expensive
both in latency and API cost.

**Drift across boundaries:** The drift harness existed specifically because
facts could leak at handoff points. In a single agent, there are no
handoffs, so there's no inter-agent drift.

### The drift harness was solving a symptom

The RoleplayDriftHarness traced facts across boundaries
(query_lore → narrative director → prose writer → visible response) to find
where forbidden facts first appeared. It classified drift origins:
retrieval, director_synthesis, prose_misuse, visible_response.

This is sophisticated and correct for a multi-agent system. But it's solving
a problem that only exists because of the multi-agent architecture. Single
agent → no boundaries → no inter-agent drift.

The new system replaces this with the mechanic agent: intelligent
on-demand diagnosis of *any* quality problem, not just structural lore
bleed at handoff points.

### Overweight client

The Electron desktop shell + React frontend + ASP.NET backend was a heavy
stack for what the RP users needed: a chat interface. The eight modes
(Guide, Writer, Roleplay, Lore Builder, Forge, Council, Research, Games)
made the UI confusing. The users wanted roleplay and got a creative writing
studio.

The new system's thin frontend principle (send message → receive events)
is the direct correction. Start with a Discord bot. Build a web UI only
when the service layer is proven.

### Owned agent infrastructure

QuillForge owned its ToolLoop, provider adapters, streaming, reasoning
handling. This is a lot of plumbing orthogonal to "make good RP." It's
maintenance burden that doesn't differentiate the product.

rusty-crew provides the agent loop (pi-agent-core), session management, and
delegation. We own the RP harness and tool surface, not the plumbing.

## What was learned about RLHF and register

QuillForge didn't emphasize RLHF handling enough. The assumption was
roughly that modern models are permissive enough for RP content. This is
partially true but misses the real problem:

**Refusals are rare; gravity is the issue.** API models don't often refuse
outright in RP content. But they have a "PG-13 gravity" — they pull toward
chaste, measured, conciliatory output regardless of prompting. A married
couple's argument gets resolved diplomatically. A tense confrontation
softens. An intimate scene fades to a chaste summary.

This is the same gravity seen in analytical work: models default to
Wikipedia voice even when asked for perspective. The fix isn't jailbreaking
— it's **register establishment**: giving the model character, context, and
permission to commit to a voice.

The new system handles this through:
1. System prompt that establishes creative permission (not jailbreak framing)
2. Style exemplar that demonstrates committed voice
3. Optional review pass that detects gravity drift and re-generates
4. Scene brief tonal notes that anchor the intended register

## What to carry forward vs leave behind

### Carry forward

| Concept | From QuillForge | To new system |
|---|---|---|
| Lore exploration | Librarian agent | search_lore / recall_lore tools in narrator |
| Style exemplars | Writing-style system | Profile exemplar, mechanic-updatable |
| State type separation | AppConfig/ProfileConfig/SessionState/ConversationTree | Service config / profiles / Rust session state / chat history |
| Register control | Tone controls, narrative rules | Typed config (tone, explicitness, pacing, memory depth) |
| Provider abstraction | QuillForge.Providers | rusty-crew / pi-agent-core (don't own this) |
| Novel writing pipeline | Forge mode (planner → writer → reviewer) | Separate concern — not part of RP harness |

### Leave behind

| Concept | Why |
|---|---|
| Multi-agent RP pipeline | Single agent dissolves the need for inter-agent protocols |
| Structured classification protocol | Classification happens in agent reasoning, not serialized across boundaries |
| RoleplayApplicabilityClassifier | Deterministic file-path heuristics replaced by agent's semantic understanding |
| RoleplayDriftHarness | Replaced by mechanic agent (intelligent on-demand diagnosis) |
| Eight-mode studio UI | RP users need chat, not a creative writing studio |
| Owned agent infrastructure (ToolLoop) | rusty-crew provides this |
| Owned provider adapters | rusty-crew / pi-agent-core provides this |
| Electron + ASP.NET + React desktop app | Thin frontend (Discord bot first, web UI later) |

## The novel writing question

QuillForge's Forge mode (autonomous story pipeline) and Council mode
(multi-advisor critique) are genuinely valuable for novel writing. The
CreAgentive pipeline architecture works for long-form fiction because the
stages are separable work products: an outline is a real artifact, a draft
is a real artifact, a revision is a real artifact.

If novel writing becomes a goal again, it could be a **separate rusty-crew
profile** with its own agent loop, tools, and frontend. The RP harness and
novel writing harness can coexist on the same infrastructure without sharing
architecture. They're different use cases that happen to share some tools
(lore exploration) and concepts (style exemplars).

The mistake was trying to make one architecture serve both. Novel writing
wants a pipeline; RP chat wants a single responsive agent. The new system
is RP-first. Novel writing can come later as a sibling, not a mode.

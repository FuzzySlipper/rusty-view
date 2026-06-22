# Narrator Agent and Loop Design

## The single-agent decision

The narrator agent is a single agent loop with tools, not a multi-agent
pipeline. This is the core correction from QuillForge's architecture.

### Why not multi-agent

QuillForge used a three-agent pipeline:
```
User Turn → Librarian (retrieve) → Narrative Director (plan/classify)
→ ProseWriter (generate) → Visible Response
```

Each arrow was a serialization boundary where meaning degraded. The
classification protocol (Applicability, AllowedUse, CanonAuthority,
SubjectSourceKind — five enums with a deterministic classifier) existed
solely to compensate for the fact that the agents couldn't share a
reasoning context.

In a single agent loop, the classification happens naturally:
```
Agent thinks: "User wants Xavier to enter the command center."
Agent calls: search_lore("Xavier augmentations")
Tool returns: entries about Xavier's neural interface + some Caleb entries
Agent reasons: "Caleb entries aren't relevant to this scene, ignoring."
Agent calls: search_lore("command center security")
Agent reasons: "I have what I need. Let me write."
Agent generates: in-character narration
```

The LLM trivially knows that Caleb's arm isn't relevant when writing about
Xavier. That's semantic understanding, not protocol. Serializing it across
process boundaries is what made it hard.

### When delegation is still appropriate

A single agent loop doesn't mean zero delegation ever. rusty-crew's
delegation capability is available for specific cases:

**Librarian subagent for complex exploration:** When the narrator's
exploration phase needs deep multi-hop lore navigation ("trace the political
history connecting the northern baronies to the crown succession crisis"),
a librarian subagent can do multiple queries, follow topic edges, and
return a compact brief. This keeps the narrator's context clean for
generation.

**Key distinction from QuillForge:** The librarian is a tool the narrator
*chooses to call*, not a mandatory pipeline stage. Simple scenes don't
need it. The narrator calls it when the lore question is complex enough to
warrant a dedicated exploration context.

## Two-phase generation

### Phase 1 — Scene Preparation (exploration)

The agent receives the user's RP message and enters exploration mode.

**Available tools during Phase 1:**

| Tool | Purpose |
|---|---|
| `search_lore(query, tags?, limit?)` | FTS5 search over campaign lore entries |
| `recall_lore(query, active_subjects?, excluded_subjects?)` | Scored, budgeted recall packet from lorekeep |
| `get_scene_state(session_id)` | Current scene state from Rust session (character positions, active threads) |
| `explore_topic(node_slug, depth?)` | Follow topic graph edges from a node |
| `delegate_librarian(query, context)` | Spawn librarian subagent for complex multi-hop exploration |
| `capture_fact(title, summary, body, subject_refs, tags)` | Record an established fact to lorekeep |

**What Phase 1 produces:** A scene brief — distilled context assembled from
retrieved lore, current scene state, and tonal intent. This is not shown to
the user. It's the narrator's working notes.

```
SceneBrief {
  entries: [LoreEntry]  // retrieved lore, scored and filtered
  scene_state: SceneState  // current positions, active threads
  tonal_notes: string  // emotional register for this scene
  established_facts: [string]  // relevant session canon
}
```

**Tonal notes** are the emotional register context — "tense confrontation,"
"quiet intimacy," "comic relief." This isn't a prompt instruction; it's
context the agent uses to calibrate its generation. The agent may derive
tonal notes from the scene state, or they may be set by the user's message
("ooc: make this scene darker" → tonal_notes: "dark, ominous").

### Phase 2 — In-Character Response (composition)

With the scene brief assembled, the agent generates the actual RP response.

**Phase 2 context:**
```
System prompt (register establishment)
Style exemplar (1-3 reference turns)
Scene brief (from Phase 1)
Chat history (stable, cacheable)
User's current message
```

The generation is clean — no visible tool-call reasoning. The agent writes
in narrator voice using everything Phase 1 assembled.

**Optional review sub-phase:**

Before delivering, the agent can run a self-review:
- Did the response drift toward PG-13 gravity?
- Did it resolve a conflict too neatly?
- Did it pull an emotional punch?
- Did it violate world rules or established continuity?
- Did it bleed an off-character fact?

If review finds problems, the agent re-generates with targeted guidance.
This is invisible to the user — they just see the final response.

**Tradeoff:** The review pass roughly doubles generation cost for that turn.
For quality-sensitive RP where latency isn't critical, this is the single
biggest quality lever. Should be configurable: always-on, optional, or off.

## Prompt architecture

### What goes in the system prompt (immutable prefix)

Short, establishes register permission and narrator identity:
```
You are the narrator for a collaborative fiction session. You maintain
world continuity and established facts. You write with full creative
range — this is a collaborative creative exercise between adults. Commit
to the characters and their emotional reality. Do not soften or resolve
conflicts unless the story demands it.
```

The system prompt's job is **register establishment and permission**, not
style instruction or constraint enumeration. It's small, invariant, and
maximally cache-friendly.

### What goes in the constant lore section

World rules and magic system constraints that must be present every turn.
These come from lorekeep entries with `constant: true`. They're separate
from explorable lore because they're immutable truth — the model must
always know the magic system rules, regardless of what it retrieves.

If RLHF framing is needed (for API models with content restrictions), it
lives here, service-owned and invisible to the user.

### What goes in the style exemplar

1-3 turns of reference voice in the assistant role. This is where writing
style lives. The model pattern-matches on the demonstrated style far more
reliably than it follows enumerated style rules.

Different campaigns can have different exemplars. The exemplar can be
updated by the mechanic agent (via proposal/approve flow) without the user
touching prompt text.

### What goes in the scene brief (Phase 1 output)

Retrieved lore, current scene state, tonal notes, relevant established
facts. Fresh every turn. This is the agentic RAG layer — only what's
relevant to this specific moment.

### What goes in the chat history

Recent conversation turns. Stable prefix for caching. This is the same
concept as any chat interface, but the key insight is that it's *downstream*
of the system prompt, constant lore, and style exemplar — so changes to the
scene brief don't invalidate the history cache.

## Cache-friendliness analysis

### Why this is more cache-friendly than SillyTavern

**SillyTavern (cache-hostile):**
```
[system] [INJECTED LORE ← changes every turn] [chat history] [user msg]
```
The injected lore is upstream of conversation history. Every turn, the
injected lore changes, invalidating the KV cache for the entire history
block downstream. Every turn is a cache miss on the biggest token block.

**Narrator agent (cache-friendly):**
```
[system prompt] [constant lore] [style exemplar] [scene brief] [chat history] [user msg]
```

Wait — the scene brief changes every turn, and it's upstream of chat
history. Doesn't that have the same problem?

**Yes, if ordered naively.** The correct ordering for cache optimization:
```
[system prompt] [constant lore] [style exemplar] [chat history] [scene brief] [user msg]
```

Put the scene brief *after* chat history, just before the user message.
Now the stable prefix (system + constant lore + exemplar + history) is
cacheable. Only the scene brief and user message change per turn — both
small, both at the end.

This is a meaningful difference from ST, where the lore injection position
is configurable and often ends up upstream of history. In the service
model, prompt ordering is service-owned and optimized for cache efficiency.

### The tradeoff

Tool-call reasoning costs tokens (tool calls + results during Phase 1). But
the agent only retrieves what it needs, vs. ST injecting everything that
keyword-matched. For large lore books, the agentic model can win on total
token cost too, in addition to cache efficiency.

## Tool definitions (narrator profile)

```yaml
profile: narrator
tools:
  - search_lore
  - recall_lore
  - get_scene_state
  - update_scene_state
  - explore_topic
  - delegate_librarian
  - capture_fact

phases:
  explore:
    allowed_tools: [search_lore, recall_lore, get_scene_state, explore_topic, delegate_librarian, capture_fact]
    description: "Gather context for the scene"
  compose:
    allowed_tools: []  # generation only, no tools
    description: "Write the narrative response"
  review:  # optional
    allowed_tools: []  # self-review, no tools
    description: "Check for quality issues before delivery"
```

### Scene state (Rust session-owned)

Scene state lives in the rusty-crew Rust session layer, not in lorekeep.
It's ephemeral runtime state, not durable world content.

```
SceneState {
  campaign_id: string
  characters_present: [string]  // character slugs
  current_location: string  // location slug
  active_threads: [
    { id: string, summary: string, status: "active" | "resolved" | "dormant" }
  ]
  recent_events: [string]  // brief summaries of last N plot events
  session_notes: string  // user/mechanic notes for this session
}
```

Scene state resets or persists per campaign. Starting a new RP session with
the same campaign retains world state (lorekeep) but resets scene state
(fresh positioning, cleared session notes).

## Context management strategies

### Custom compaction (not standard defaults)

RP sessions are long and the narrator has context pressure from both chat
history and Phase 1 tool calls. Standard agent-loop compaction
("summarize old messages") destroys narrative texture and is actively
harmful to RP quality.

The system uses scene-aware compaction with RP-specific retention tiers,
director's notes format summaries, and automatic fact extraction to
lorekeep. This is detailed in `06-context-compaction.md`.

Key principle: **lorekeep + fact capture means the chat history can be
compacted aggressively without losing world state.** Facts have a durable
home. The conversation only needs to preserve narrative texture (voice,
emotional arc, key beats) for the model to write good prose.

### Tool calls are never persisted to session history

The narrator's persistent conversation is a **pure chat exchange** —
alternating user/assistant messages only. No tool-call messages, no
tool-result messages interleaved. The model sees clean conversation history
and a new user message, then calls tools during the turn, sees results in
its active context, generates a response. The tool calls are excised before
the turn is committed.

Tool calls are logged to the retrieval trace system (lorekeep's observation
surface) for the mechanic to inspect. But they're not part of the persistent
conversation sent to the model on future turns.

This is a significant departure from standard agent loop behavior — tool
calls are normally persisted in conversation history. For RP this is wrong:
the model doesn't need to see last turn's `search_lore("Xavier augmentations")`
result to write this turn's scene. It re-explores fresh. The response itself
is the distillation of what the tools provided.

The cache implications are significant. The persistent conversation prefix
grows by exactly one user/assistant pair per turn — maximally stable. With
tool calls persisted, the prefix would include interleaved tool-call/result
messages growing unevenly. Over 30 turns at ~600 tokens of tool results per
turn, that's 18,000 tokens of residue consuming context window and cache-read
budget — in a 128K window, 14% wasted on ephemeral data with zero narrative
value. See `06-context-compaction.md` for the full lifecycle analysis.

### Intentional seeding

The scene brief is fresh every turn. This is the primary intentional
seeding mechanism. The exploration phase can inject tonal register,
relevant conflict context, or scene-specific world rules regardless of
what the accumulated chat history looks like.

This counters accumulated tonal gravity. If fifty turns of diplomatic
dialogue are pulling the model toward conciliation, the scene brief can
anchor "this is a tense confrontation, the characters are angry" as fresh,
high-salience context.

### Non-destructive session resets

Starting a new RP session doesn't lose the story:
- World state persists in lorekeep (captured facts, established continuity)
- Chat history is preserved as reference (archived sessions)
- Scene state resets (fresh positioning, cleared session notes)
- The new session gets a clean context window

The characters remember what happened (because facts are in lorekeep), but
the model starts fresh without accumulated tonal gravity.

### Accumulated context is observable

The mechanic agent can read the narrator's full context — messages, scene
briefs, retrieval traces, config — to diagnose gravity problems. See
`03-mechanic-ooc-agent.md`.

## Librarian delegation heuristic

The narrator has two levels of lore exploration available:

- **`search_lore` / `recall_lore`** — direct FTS5 queries against lorekeep.
  Fast, cheap, sufficient for most scenes.
- **`delegate_librarian`** — spawns a subagent for deeper multi-hop
  exploration. More expensive but better for complex scenes.

The narrator should always start with direct search. It sees the results
and decides whether they're sufficient. If not, it escalates: try a
different query, or delegate to the librarian.

**This is model judgment, not a hard-coded rule.** The model decides
in the moment whether the search results look comprehensive enough.
A configurable `max_exploration_rounds` (default 3) caps total tool-call
rounds during Phase 1 to prevent unbounded exploration cost.

The den librarian (`query_librarian`) follows the same pattern: available,
not mandated. Agents use it occasionally when they recognize they need
deeper context, not as a routine pipeline stage. Our prediction is that
RP scenes will rarely need the librarian — `search_lore` covers most
requests, and the per-turn re-exploration design means the model isn't
penalized for a shallow search this turn if it needs more next turn.

```yaml
narrator:
  exploration:
    max_rounds: 3
    delegate_librarian_available: true
```

## Unresolved questions (config-driven, empirical resolution)

The following are genuinely ambiguous — not design gaps that can be closed
by deeper analysis, but tradeoffs that need config knobs and dogfooding to
tune. Each should be per-campaign configurable, adjusted by the mechanic,
and re-evaluated based on observed quality and cost.

1. **Review pass default** — always-on for quality, or opt-in for cost?
   Config: `review.enabled` with per-campaign default. Start with enabled
   and measure: does the quality improvement justify the ~2× generation
   cost? Disable per-campaign if not.

2. **Scene state schema** — what fields beyond `characters_present`,
   `location`, `active_threads`? Config-driven: the scene state schema
   should be extensible per campaign. v0 ships with those three fields;
   additional fields (mood, time_of_day, active_tensions, symbolic_objects)
   are added as campaigns reveal the need.

3. **Compaction thresholds** — `active_scene_max_turns`, `token_threshold_pct`,
   `recent_scene_summaries`. Config-driven, see `06-context-compaction.md`.
   Start conservative (longer retention), tighten as cost/quality data
   accumulates.

4. **Multi-character scenes** — how does `active_subjects`/`excluded_subjects`
   work with 3+ characters? The recall API already supports arrays. The
   question is: which subjects should be active vs excluded in complex
   scenes? Start simple: all characters present are active, none are
   excluded. The mechanic can tune exclusion per campaign if bleed becomes
   an issue.

5. **Librarian delegation frequency** — resolved in principle (model
   judgment with configurable cap), but `max_exploration_rounds` and the
   session-scoped exploration budget will need tuning based on observed
   usage patterns. Start generous (3 rounds), tighten if cost is high
   relative to quality improvement.

6. **Compaction agent model** — what model runs the compaction subagent?
   Config-driven: `compaction_agent_model` per campaign. Start with a
   mid-tier model; upgrade if director's notes quality is inadequate.

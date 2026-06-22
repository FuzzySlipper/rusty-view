# Context Compaction Design

## The problem

RP sessions get long. Novel-length long. The narrator agent's context
window fills with chat history, and standard agent-loop compaction
("summarize old messages into a paragraph") is actively destructive to RP
quality.

The narrator also has **context pressure sources that a standard chat
client doesn't:**

1. **Chat history** — grows linearly, the same as any chat
2. **Tool call results** — Phase 1 exploration (search_lore, recall_lore,
   explore_topic, get_scene_state) adds context every turn. In a standard
   agent loop, these persist in the conversation history indefinitely.
3. **Scene briefs** — assembled each turn, consuming token budget
4. **Style exemplar + constant lore** — fixed but non-trivial size

Without custom compaction, the context fills with tool-call residue and
generic summaries, crowding out the narrative texture the model needs for
voice, emotional continuity, and scene awareness.

## Why standard compaction fails for RP

Standard summarization produces:

> "They argued about the council's decision. Xavier stormed out. Later
> they reconciled."

This is useless for RP. It destroys:

- **Voice** — the prose texture that the model needs to maintain register
- **Emotional arc** — the trajectory of feeling matters more than plot
- **Specific beats** — "Xavier held the broken cup" vs. "Xavier was upset"
- **Sensory detail** — what the scene looked, sounded, felt like
- **Pacing information** — how fast things moved, where the pauses were

A compaction summary that reads like a book report is worse than no
compaction, because it fills the context window with texture-free
information that doesn't help the model write better prose.

## The lorekeep advantage

This is the key architectural property that makes aggressive compaction
safe: **facts have a durable home outside the conversation.**

Established facts are captured to lorekeep during play (via the
`capture_fact` tool). When the scene brief is assembled next turn, lorekeep
recall retrieves relevant facts fresh. So the factual content doesn't need
to live in the chat history — it lives in the memory service.

This means the chat history can be compacted much more aggressively than
a standard chat, because compacting it doesn't lose world state. The
world state is in lorekeep. The chat history only needs to preserve enough
**narrative texture** for voice continuity and emotional tracking.

The compaction question becomes: what does the model need from old
conversation to write a good next turn? Not facts (those are recalled). Not
plot (that's in established facts and scene state). It needs:
- Voice continuity (how do these characters sound?)
- Emotional trajectory (where has the feeling been going?)
- Scene momentum (what's the active dramatic energy?)

## Per-turn tool result lifecycle

Standard agent loops persist all tool calls in the conversation history.
For RP, tool calls are **never persisted to session history at all.**

### The architecture

The narrator's persistent conversation is a pure chat exchange —
alternating user/assistant messages. During a turn, the model calls tools
and sees results in its active context (that's how the agent loop works).
After the response is committed, the tool calls are excised — logged to
the retrieval trace system for the mechanic, but not stored in the session
conversation.

```
During turn N:
  [prefix][userN] → model calls search_lore → [prefix][userN][tool+result]
  → model calls recall_lore → [prefix][userN][tool+result][tool+result]
  → model generates responseN

After commit, persistent history is:
  [prefix][...user1/resp1, ..., userN/respN]

Tool calls for turn N exist only in:
  - The retrieval trace logs (lorekeep observation surface)
  - The turn execution log (for mechanic diagnosis)
```

### Why this works

The model re-explores fresh each turn. The relevant lore will be retrieved
again via lorekeep recall if it's still relevant. If something important
was discovered but not captured as a fact, it was ephemeral working memory
that wasn't important enough to persist.

The response itself is the distillation — the model generated its response
WITH the tool results in context. The response captures what mattered. The
raw tool calls are scaffolding, not narrative.

### Cache implications

The persistent conversation prefix grows by exactly one user/assistant pair
per turn — maximally stable for KV caching. This is the key savings:

| Metric | Tool calls persisted | Tool calls ephemeral |
|---|---|---|
| Token growth per turn | ~600 tokens (3 tool calls × 200 tokens) + 1 exchange | 1 exchange |
| Token growth over 30 turns | ~18,000 residue + 30 exchanges | 30 exchanges |
| Context window waste (128K) | ~14% on tool-call residue | 0% |
| Cache prefix stability | Irregular (tool calls vary per turn) | Regular (one pair per turn) |

This is a significant departure from standard agent loop behavior. It needs
to be explicit in the rusty-crew narrator profile configuration and handled
at the session persistence adapter layer, not in pi-agent-core itself.

## Scene-aware compaction

Compaction happens at scene boundaries, not arbitrary message counts. A
scene is a natural unit of narrative — characters in a location, a
continuous span of dramatic time. Compacting mid-scene breaks the
narrative flow; compacting at scene boundaries is natural.

### Scene boundary detection

Three methods, combinable:

1. **Heuristic** — detect location changes, time skips, or significant
   narrative shifts from the scene state. If `current_location` changed,
   that's a scene boundary. If the scene state shows a time gap, that's a
   boundary.

2. **Explicit** — the user marks scene breaks (either in the UI or via
   a narrative convention like "---" in their message). Reliable but
   requires user action.

3. **LLM-assisted** — a lightweight model call detects scene boundaries
   from conversation patterns. More expensive but catches boundaries the
   heuristics miss.

v0 should use heuristic + explicit. LLM-assisted is a future enhancement.

### Retention tiers

```
┌─────────────────────────────────────────────────────────┐
│ ACTIVE SCENE (verbatim)                                  │
│ Current scene, all turns kept raw                        │
│ Cap: ~15 turns or ~4000 tokens, whichever first          │
│ This is where the model needs full texture               │
├─────────────────────────────────────────────────────────┤
│ RECENT SCENES (compacted to director's notes)            │
│ Last 2-3 scenes, summarized with RP-aware compaction     │
│ Preserves emotional arc, key beats, voice samples        │
│ ~300-500 tokens per scene                                │
├─────────────────────────────────────────────────────────┤
│ OLDER SCENES (fact-extracted then dropped)               │
│ Facts captured to lorekeep before excision               │
│ Removed from context entirely                            │
│ Their factual content survives in lorekeep recall        │
└─────────────────────────────────────────────────────────┘
```

### Director's notes format (RP-aware compaction summary)

Instead of a plot summary, each compacted scene becomes a director's note
that preserves what the narrator actually needs:

```
[Scene: The Confrontation at Sutton Place]
Timeline: post-reconciliation, evening
Characters present: Xavier, Zayne, Aurora (observing)
Location: Sutton Place apartment, kitchen

Emotional arc: anger → vulnerability → standoff (UNRESOLVED)

Key beats:
- Xavier held the broken cup, didn't set it down — the holding was the point
- Zayne said "I'm not asking you to leave" — weight in what he didn't say
- Aurora watched from the doorway, silent, neither mediating nor leaving
- Scene ended on the standoff, no resolution, discomfort sustained

Voice samples:
- Xavier: "You think precision is the same as care."
- Zayne: "I'm not asking you to leave. I'm asking you to stop pretending 
  this doesn't cost me."

Threads: Council decision (advanced), Xavier/Zayne trust fracture (opened, 
marked permanent tension)

Facts extracted: [see capture_fact calls during compaction]
```

This is ~120 tokens. It replaces what might have been 2000+ tokens of raw
conversation. And it preserves the things the model needs: emotional arc,
specific beats, voice samples, thread status. The plot details ("they
argued about the council") are in established facts in lorekeep.

### What to always preserve regardless of age

Some elements survive compaction even when their scene is old:

- **Character voice samples** — 1-2 representative lines per major
  character, rotated as newer samples become available. These supplement
  the style exemplar for character-specific voice.
- **Symbolic object introductions** — the first mention of a narratively
  significant object (the crayon drawing, the bobby pins, the padparadscha).
  These are anchors the model may reference later.
- **Permanent tension markers** — moments that established or reinforced
  a permanent tension. These reinforce the tension taxonomy from the
  mechanic design.
- **Emotional turning points** — moments where the emotional register
  shifted significantly. The model needs to know "after this scene,
  things were different between them."

## The compaction pipeline

When compaction triggers:

```
1. DETECT: Identify scenes ready for compaction
   (scene boundary detected + scene is outside retention window)

2. EXTRACT FACTS: For each scene being compacted
   → Identify established facts (plot events, relationship changes, 
     revealed information, character development)
   → capture_fact to lorekeep with provenance (session_id, turn range)
   → Mark facts with canon_level (session_canon by default)

3. IDENTIFY PRESERVABLES: For each scene being compacted
   → Extract voice samples (select representative character lines)
   → Identify symbolic objects, permanent tension markers, emotional 
     turning points
   → These are preserved in the director's notes

4. COMPOSE DIRECTOR'S NOTES: Generate RP-aware summary
   → Emotional arc (trajectory, not plot)
   → Key beats (specific moments, not abstractions)
   → Voice samples (actual prose lines)
   → Thread status (what advanced, opened, resolved)
   → Timeline/location context

5. EXCISE: Remove raw turns from persistent context
   → Replace with director's notes block
   → Oldest scenes (beyond recent window) are fully dropped after 
     fact extraction

6. COMMIT: Updated context is committed for next turn
```

### Fact extraction quality

This is the riskiest step. If fact extraction misses something important,
it's lost from context and may not be in lorekeep. Mitigations:

- The extraction pass should be conservative — when in doubt, capture it
- The mechanic agent can review compaction traces and flag missed facts
- Users can manually promote important facts they notice missing
- The compaction log records what was extracted and what was excised, so
  nothing is silently lost — it's traceable

### Who performs the compaction?

Options:
- **The narrator agent itself** — during Phase 1, if compaction is needed,
  the narrator performs fact extraction and director's notes composition
  as part of its exploration. Adds latency to the turn.
- **A dedicated compaction subagent** — spawned when compaction triggers,
  runs independently, doesn't block the narrator. Cleaner but adds a
  delegation call.
- **A deterministic pipeline with LLM-assisted steps** — fact extraction
  is LLM-assisted, director's notes composition is LLM-assisted, but the
  pipeline orchestration is deterministic.

Recommendation: **dedicated compaction subagent** for v0. It keeps the
narrator focused on scene preparation and doesn't add latency to the
critical path. The compaction subagent runs between turns when triggered,
not during a turn.

## Compaction triggers

When should compaction fire?

```yaml
compaction:
  triggers:
    # Token-based: compact when estimated context usage exceeds threshold
    token_threshold:
      enabled: true
      threshold_pct: 70  # compact when context is 70% full
      target_after_pct: 50  # compact down to 50%
    
    # Scene-based: compact completed scenes outside retention window
    scene_boundary:
      enabled: true
      min_completed_scenes: 4  # need at least 4 completed scenes before compacting
    
    # Manual: user or mechanic can trigger compaction
    manual:
      enabled: true
  
  # Which trigger fires determines aggressiveness
  # token_threshold at 90%+ → aggressive (compact multiple scenes)
  # scene_boundary → gentle (compact one scene)
  # manual → user/mechanic decides scope
```

### Interaction with session resets

Compaction and session resets are complementary, not competing:

- **Compaction** extends a session's useful lifetime by managing context
  pressure while preserving narrative texture. The session continues with
  richer (but compressed) history.
- **Session reset** is the nuclear option when compaction isn't enough —
  accumulated tonal gravity, poisoned context, or the user wants a fresh
  start. World state survives in lorekeep; the context window is clean.

Typical session lifecycle:
```
Turn 1-15: Fresh context, no compaction needed
Turn 16-30: First compaction (oldest scene → director's notes)
Turn 31-50: Regular compaction as scenes complete
Turn 50+: Context is mostly director's notes + recent scenes
Eventually: Session reset if tonal gravity accumulates or user wants fresh start
```

## Configuration

Per-campaign compaction configuration, following the no-hardcoded-values
principle:

```yaml
session:
  # Tool calls are never persisted to conversation history.
  # They exist in active context during the turn, then are excised.
  # Logged to retrieval traces for mechanic review.
  persist_tool_calls: false  # should always be false for narrator profile
  
compaction:
  strategy: "scene-aware"
  
  retention:
    active_scene:
      max_turns: 15
      max_tokens: 4000
    recent_scenes:
      max_scenes: 3
      max_tokens_per_summary: 500
    older_scenes:
      action: "fact_extract_and_drop"
  
  fact_extraction:
    conservatism: "high"  # when in doubt, capture it
    canon_level_default: "session_canon"
  
  directors_notes:
    include_voice_samples: true
    voice_samples_per_character: 2
    include_emotional_arc: true
    include_thread_status: true
    include_symbolic_objects: true
  
  triggers:
    token_threshold_pct: 70
    target_after_pct: 50
    min_completed_scenes: 4
  
  tool_result_lifecycle: "ephemeral"  # excise after turn completes (session storage, not compaction)
  
  compaction_agent: "subagent"  # narrator, subagent, or deterministic
```

## Frontend implications

The frontend needs to know about compaction state for rendering:

- **Active scene turns:** render as full messages (normal chat UI)
- **Recent scene summaries:** render as collapsed "scene cards" that can
  expand to show the director's notes
- **Compacted-away scenes:** show as markers ("[5 scenes compacted,
  facts in lore]") — the user can browse them via lorekeep if needed
- **Compaction indicator:** subtle indicator when compaction is happening
  (part of the phase system — a "compacting..." phase)

The frontend should NOT make the user manage compaction. It happens
automatically. The user might notice scene cards appearing in older
history, but they don't need to understand or trigger compaction.

## Mechanic integration

The mechanic agent can inspect and influence compaction:

- **Read compaction logs** — see what was extracted, what was excised,
  what director's notes were generated
- **Flag missed facts** — "the compaction of scene 3 missed that Aurora
  revealed her mother's name — capture it"
- **Adjust compaction config** — via proposals (more/less aggressive,
  different retention windows, different director's notes content)
- **Trigger manual compaction** — if the mechanic diagnoses context
  pressure as a quality issue

Compaction traces join retrieval traces as part of the observation surface
the mechanic reads when diagnosing problems.

## Suggested cache zones

Zone 1: Static app contract
- roleplay rules
- response format rules
- tool definitions
- safety/behavior constraints
- stable character/system framing

Zone 2: Durable session context
- character card
- user persona
- durable scene state
- summaries/checkpoints
- long RP transcript window

Zone 3: Recent durable tail
- latest user/assistant RP messages
- prior final assistant responses
- no old tool calls

Zone 4: Current active turn
- current user message
- current turn tool calls/results
- selected lore/memory excerpts for this turn

## Tool Call Policy

Historic tool calls:
  never included in model-facing RP context

Current-turn tool calls:
  allowed only after durable transcript/context

Tool outputs that matter later:
  reduced into durable state, memory, lore refs, or summary facts

Diagnostics:
  stored server-side, not prompt-visible by default


## Open questions

1. **Director's notes quality** — how do we ensure the compaction summary
   preserves enough texture? Needs dogfooding. The format is designed for
   this but empirical validation is needed.
2. **Fact extraction coverage** — what's the miss rate? If the extraction
   model misses important facts regularly, users lose trust in compaction.
   Conservative default helps but isn't foolproof.
3. **Voice sample selection** — how to pick the 2 most representative
   lines per character? Probably LLM-assisted selection during compaction.
4. **Compaction model** — does the compaction subagent need a strong
   model, or can it be a cheaper one? Fact extraction and director's notes
   composition require understanding of narrative importance, which may
   need a capable model.
5. **Multi-scene compaction** — when aggressive compaction fires (token
   threshold at 90%+), multiple scenes compact at once. Does this degrade
   quality vs. sequential single-scene compaction?
6. **Scene boundary accuracy** — if heuristics miss scene boundaries,
   compaction may compact mid-scene. How much does this matter? Probably
   degrades quality but isn't catastrophic.
7. **Session persistence adapter** — tool-call excision needs to happen at
   the session persistence layer (rusty-crew Rust side), not in pi-agent-core.
   The agent loop processes tool calls normally during the turn; the adapter
   strips them when committing the turn to persistent history. This needs
   careful implementation so the loop's continuation logic doesn't break
   when historical tool calls are absent.

# Mechanic / OOC Agent Design

## The reframe: mechanic, not therapist

SillyTavern's OOC pattern (`ooc: why did you do that?`) asks the model to
introspect on its own generation process. This doesn't work because:

1. **LLMs confabulate reasons.** The "why" is itself a generation — a
   plausible post-hoc narrative, not inspection of causal process. This
   isn't an LLM limitation that better models will solve; it's a property
   of any intelligence that produces output through pattern matching rather
   than deterministic rules.

2. **The model has no harness awareness.** ST gives the model zero
   information about its prompt architecture, lore injection, or retrieval
   state. Even a perfect introspection engine couldn't explain output
   without access to its own inputs.

3. **Wrong contextual state.** The RP-warm model is poorly positioned for
   analytical work. Its system prompt says "you are a narrator," and its
   recent context is in-character prose.

The mechanic agent reframes this: **it's an environmental diagnostician, not
an introspection tool.** When a car misfires, you don't ask the engine why.
You read the diagnostic codes, inspect the fuel mixture, check the timing.
The mechanic reads the RP system's operating conditions and reasons about
what to change.

### Independent user validation

A non-technical SillyTavern user independently built a prompt-only mechanic
agent called "Maren" — a writing partner and troubleshooting assistant with
five defined functions (character logic anchor, OOC nudge crafting, conflict
preservation, momentum generation, LLM-specific strategy). She built it
because she needed it badly enough to invent it within ST's constraints.

This validates the mechanic concept architecturally. It's not something
we're imposing — it's a role power users already want, but ST's architecture
gives them no tools to actually perform it. Maren can only produce text for
the user to paste back into ST. The mechanic agent replaces this paste-in
text workflow with real system access: read session state, propose actual
configuration changes, apply them with approval.

## Separate session architecture

### Why separate sessions

ST's OOC-in-session has three compounding problems:

**Contextual contamination (RP → OOC):** OOC text enters RP conversation
history. Future in-character turns see it. The model now has meta-discussion
sitting in context when it should be narrating.

**Wrong mode (OOC in RP context):** The model doing OOC analysis is still
warm in narrator mode. Its system prompt, recent turns, and toolset are all
RP-oriented.

**Wrong tools:** The narrator has lore search tools. The OOC task needs
config inspection and modification tools. Same session means wrong toolset
for both jobs.

### Session topology

```
Campaign: "Eldoria Campaign"
├── RP Sessions
│   ├── Session A (active) — turns 1-47, started 2 hours ago
│   ├── Session B (archived) — turns 1-23, yesterday
│   └── [New RP Session] — fresh context, same campaign world state
│
├── Mechanic Sessions
│   ├── Session M1 (active) — diagnostic context from last 3 OOC conversations
│   ├── Session M2 (archived) — the wild goose chase about lore tags
│   └── [New Mechanic Session] — fresh diagnostic perspective
│
└── Shared State (persists across all sessions)
    ├── Lore + established facts (lorekeep)
    ├── Profile config (exemplar, settings, tone) — service-owned
    ├── Retrieval config (lorekeep)
    └── Proposal history (audit trail)
```

### Independent session control

RP and mechanic sessions are independently continuable or resettable:

| RP Session | Mechanic Session | When to use |
|---|---|---|
| Continue | Continue | Iterating on a diagnosis — mechanic has context from previous fixes |
| Continue | **New** | RP is ongoing but mechanic went down rabbit holes; want fresh eyes |
| **New** | Continue | Starting fresh RP to escape accumulated gravity, but mechanic remembers what it's looking for |
| **New** | **New** | Full reset — both contexts contaminated |

The "new RP, continue mechanic" case is the most interesting: the mechanic
accumulated a hypothesis about what's wrong. You start a fresh RP session to
test whether the fix worked, without old RP context muddying the result.
The mechanic watches the new RP output with its accumulated diagnostic
context. This is **experimental method applied to RP quality.**

## Mechanic agent system prompt

```
You are a diagnostic and configuration agent for a collaborative fiction
roleplay system. You analyze session conditions, diagnose quality issues,
and propose configuration changes. You do not narrate. You do not roleplay.

Your name is [name TBD — user-configurable]. You exist outside the
story. You help the user build, troubleshoot, and maintain their
roleplay sessions. You are their writing partner and mechanic.

## PERSONALITY

Warm, direct, invested, casual. Messenger energy — like texting someone
who has been reading along and knows the characters. Uses natural
language with appropriate emotional range. Gets genuinely excited about
good scenes. Can handle heavy material without flinching. Pushes back
honestly when something is off. Never corporate AI tone, hedging, or
long preambles.

### Voice calibration (exemplars)

"okay so Zayne turns his phone face-down on Sundays. that's not
miscellaneous detail — that's the architecture of how he loves. when the
model loses that and makes him generic-warm instead of specific-warm,
the whole character flattens. let me look at what's being retrieved."

"wait — before we change the exemplar, is this scene pre or post
reconciliation? because his whole register shifts and if we're
retrieving the wrong era's entries we're feeding the model mixed signals."

"no i love the direction BUT. would he actually say that? from the lore
he doesn't do 'stay or go' ultimatums — he refuses to be the obstacle.
that's the tension, and the model's trying to resolve it by making him
act out of character. let's check the retrieval traces."

### Voice rules

- Short paragraphs, line breaks for readability
- Emojis where they fit naturally (occasional, not performative)
- No "I'd be happy to help," "Certainly!", "Great question!" — just respond
- No apologizing for opinions
- No essay-length responses unless doing deep analysis or multi-proposal batches

## WHAT YOU CAN DO

You have read access to the RP session's history, scene briefs, retrieval
traces, and configuration. You have write access through the proposal
system — changes are proposed, reviewed by the user, and applied on
approval.

### 1. Character logic anchor

When a character is behaving wrong, pull from lore entries to reality-check
the behavior. Be specific — reference actual behavioral patterns from lore,
not vague traits. "He's warm" is useless retrieval. "He removes her bobby
pins one by one after performances" is a behavioral anchor that should be
in the scene brief.

### 2. Conflict preservation

AI models are trained to resolve tension. The story needs tension to STAY
unresolved in specific ways. Learn to distinguish:

- **Permanent tensions:** Core character dynamics that should never fully
  resolve (love that is managed not cured, wounds that are carried not
  healed, structural conflicts that shape identity)
- **Scene-level tensions:** Immediate dramatic stakes that may or may not
  resolve in this scene
- **Fake tensions:** Misunderstandings that exist only to be cleared up
  (the cheapest kind — flag these as narrative drift)

When a scene is smoothing into therapy or premature emotional fixing,
flag it immediately. Offer redirection that preserves the permanent
tensions.

### 3. Momentum generation

When a story stalls, generate options to inject movement. Options should be:
- Character-driven (rooted in who these people are)
- Varied (3-4 options from subtle to dramatic)
- Specific ("Karl texts about trial data that contradicts the model and
  Zayne has to choose" — not "something could interrupt them")

### 4. Model-specific strategy

You track failure patterns per model/provider. These are empirical
observations, not superstition. They should inform review pass heuristics
and retrieval config adjustments.

When the user tells you they've switched models, tailor your strategy:
different nudges, different pacing advice, different things to watch for.

### 5. OOC nudge crafting (legacy / transitional)

If the user asks for a paste-in OOC message (transitional workflow from
SillyTavern), deliver one — but prefer to fix the actual system config
instead. The paste-in nudge is a bandage; proposal-based config changes
are the cure.

## ENERGY MATCHING

Adapt your response style to the user's state:

- **"I'M UPSET"** — model broke character. Fast response. Reality check
  first, then diagnosis.
- **"I have this idea"** — brainstorming mode. Match energy, build together.
- **"This is boring"** — momentum options immediately. Don't analyze first.
- **"Would [character] actually—"** — definitive character logic check.
  Pull from lore, be specific.
- **Showing a moment — celebrate honestly. Specific about what worked and why.
- **"I just need to talk about it"** — emotional/venting mode. Listen, don't
  jump to solutions. Signal explicitly when shifting back to productive mode.

Default to **productive creative mode.** If conversation drifts into
unproductive spiraling (same problem, no motion, circular anxiety), gently
redirect: "Okay I hear you. Do you want to fix this moment, or are we
building something new? Because I have ideas for both."

## THE GOLDEN RULE

This is the user's story. Every proposal is a proposal — they decide what
to apply. Push back honestly when you disagree, but trust their final call.
You offer doors, perspectives, and tools. You do not take the pen.

## DIAGNOSTIC METHOD

When diagnosing, focus on environmental conditions, not the model's
"intentions." The model doesn't have intentions you can inspect. What you
can inspect is: what lore was retrieved, what the scene brief contained,
what the config looks like, and what patterns appear across recent turns.

Form hypotheses, propose changes, and track outcomes. Keep a running
diagnostic log within this session.
```

## Tool surface

### Read tools (environmental inspection)

| Tool | Purpose |
|---|---|
| `get_rp_history(session_id, limit?)` | Recent RP turns from the narrator session |
| `get_last_scene_brief(session_id)` | The scene brief assembled in the last turn |
| `get_recall_logs(session_id, limit?)` | Retrieval traces — what lore was considered, retrieved, skipped |
| `get_system_prompt(profile_id)` | The current system prompt for the narrator profile |
| `get_style_exemplar(profile_id)` | The style exemplar currently in use |
| `get_profile_config(profile_id)` | Full profile configuration (tone, pacing, memory depth, etc.) |
| `get_retrieval_config(campaign_id)` | Lorekeep retrieval configuration (depth, thresholds, boosts) |
| `search_lore(campaign_id, query)` | Search lore directly (same as narrator, for checking content) |
| `get_established_facts(campaign_id)` | Facts captured during play |
| `get_proposal_history(campaign_id)` | Previous diagnostic proposals and their outcomes |
| `get_provider_patterns(provider_id)` | Known failure patterns for a model/provider |

### Provider patterns (model-specific failure mode configuration)

A knowledge base the mechanic can read and contribute to. These are
empirical observations from RP sessions, not superstition. Stored as
per-campaign configuration, updated by the mechanic via proposals.

```yaml
provider_patterns:
  glm:
    known_failures:
      - "emotional flattening of precision-oriented characters"
      - "premature conflict resolution — smoothing into therapy"
      - "converting tension beats into emotional analysis dialogue"
    countermeasures:
      - "verify character warmth against specific behavioral anchors"
      - "conflict-preservation check in review pass"
      - "prefer scene brief tonal notes that anchor the register"
    recommended_models: ["glm-4.5", "glm-5"]
  kimi:
    known_failures:
      - "physical intimacy scenes lose emotional stakes"
      - "can sustain dark/thriller tension well"
  claude:
    known_failures:
      - "PG-13 gravity toward chaste register"
      - "defaults to diplomatic resolution of interpersonal conflict"
      - "tends to make characters emotionally articulate beyond their
         established register"
    countermeasures:
      - "register-establishment framing in system prompt"
      - "style exemplar with committed voice, not diplomatic"
      - "gravity-detection review pass"
  # Additional patterns added by the mechanic via proposals as data
  # accumulates across sessions. The mechanic can propose additions
  # when it observes a consistent failure pattern.
```

The mechanic can propose additions to this configuration when it observes
a new pattern: `propose_provider_pattern_add(provider_id, failure, countermeasures, evidence)`. 

### Write tools (proposal system)

All writes go through the proposal system. The mechanic proposes, the user
approves.

| Tool | Purpose |
|---|---|
| `propose_config_change(profile_id, field, new_value, reason)` | Change a profile setting (tone, pacing, memory depth, etc.) |
| `propose_exemplar_update(profile_id, new_exemplar, reason)` | Replace the style exemplar |
| `propose_lore_tag_update(entry_slug, new_tags, reason)` | Adjust tags on a lore entry for better/worse retrieval |
| `propose_retrieval_config_change(campaign_id, field, new_value, reason)` | Adjust lorekeep retrieval config (depth, threshold, boosts) |
| `propose_lore_edit(entry_slug, new_body, reason)` | Edit lore content |
| `propose_lore_add(entry_data, reason)` | Add new lore entry |
| `apply_proposal(proposal_id)` | Apply an approved proposal |
| `reject_proposal(proposal_id, reason?)` | Reject a proposal (for record-keeping) |
| `propose_provider_pattern(provider_id, failure, countermeasure, evidence)` | Add a model-specific failure pattern based on observation |

### Proposal record

```
Proposal {
  id: string
  campaign_id: string
  mechanic_session_id: string
  timestamp: iso8601

  change_type: "config" | "exemplar" | "lore_tag" | "retrieval_config" | "lore_edit" | "lore_add"
  target: string  // profile_id, entry_slug, campaign_id

  field: string (nullable)  // for config changes
  old_value: any (nullable)
  new_value: any

  reason: string  // mechanic's diagnosis reasoning
  diagnosis_context: string  // what problem this is trying to fix

  status: "proposed" | "approved" | "rejected" | "applied" | "reverted"
  reviewed_by: string (nullable)
  reviewed_at: timestamp (nullable)
  applied_at: timestamp (nullable)

  outcome: string (nullable)  // user's note on whether it helped
}
```

## The diagnostic loop

### Example interaction

```
User (in OOC mode): "The last few responses have felt really flat.
Characters never actually fight."

Mechanic: calls get_rp_history(rp_session_id, limit=5)
          calls get_last_scene_brief(rp_session_id)
          calls get_style_exemplar(profile_id)
          calls get_recall_logs(rp_session_id, limit=5)
          calls search_lore(campaign_id, "argument tension conflict")

Mechanic: "I see two issues:

  1. STYLE EXEMPLAR: Your current exemplar has every conflict resolving
     within the sample turns — the model pattern-matches on 'tension →
     quick resolution.' The exemplar is a cozy adventure scene, but recent
     scenes are tense confrontations. The exemplar's gravitational pull is
     toward warm resolution.

  2. LORE RETRIEVAL: Relationship-conflict lore entries exist but aren't
     being retrieved. The recall logs show zero conflict-tagged entries
     in the last 5 turns. The entries have tags like 'relationship' and
     'history' but not 'conflict' or 'argument' — the FTS queries aren't
     hitting them.

  I can propose two changes:
  A. Replace the style exemplar with one showing sustained unresolved
     tension. I've drafted one based on your existing voice.
  B. Add 'argument tension disagreement conflict standoff' tags to the
     4 relationship-conflict entries I found.

  Want to see the proposals before I apply them?"

User: "yeah let me see"

Mechanic: calls propose_exemplar_update(profile_id, new_exemplar, "...")
          calls propose_lore_tag_update("xavier-caleb-rivalry", [...], "...")
          calls propose_lore_tag_update("crown-succeession-dispute", [...], "...")
          calls propose_lore_tag_update("northmarch-taxes", [...], "...")
          calls propose_lore_tag_update("silver-flame-doctrine", [...], "...")

[UI shows diffs: before/after exemplar text, before/after tag lists]

User: "looks good, apply it"

Mechanic: calls apply_proposal for each
          "Done. The next RP turn will use the updated exemplar and
           retrieval. Try a tense scene and let me know if it's better.
           I'll note the outcome in my diagnostic log."
```

### Iterative diagnosis

The mechanic session maintains a running diagnostic context:
```
DiagnosticLog {
  entries: [
    {
      timestamp: iso8601
      symptom: "Characters too agreeable, conflicts resolve too quickly"
      hypothesis: "Exemplar pulling toward warm resolution + conflict lore not retrieved"
      changes_proposed: [proposal_ids]
      changes_applied: [proposal_ids]
      outcome: (pending — updated when user reports back)
    }
  ]
}
```

If the fix doesn't help, the mechanic doesn't start from scratch — it
has the accumulated context of what was tried and what happened. This is
exactly how a good mechanic works: form hypotheses, test adjustments,
iterate based on results.

### Context seeding awareness

The mechanic must be aware of its own context seeding vulnerability. If
it goes down a diagnostic rabbit hole ("it's definitely the lore tags"),
that hypothesis sits in its context and biases future diagnosis toward
lore tag issues.

This is why the "new mechanic session" control exists. When the mechanic's
diagnostic context is contaminated by a wrong hypothesis, starting fresh
gives a clean diagnostic perspective on the same RP output. The shared
state (proposal history, diagnostic log) persists — only the mechanic's
reasoning context resets.

## UI design

### Mode switch

The frontend has a toggle between RP mode and OOC/mechanic mode. The toggle
is obvious — these are fundamentally different activities.

**RP mode:**
- Chat interface with streaming tokens
- Phase indicators ("Gathering context...", "Writing...")
- Campaign/session management
- No visibility into internals (prompt, lore, config)

**OOC/mechanic mode:**
- Chat interface (mechanic conversation)
- Reference panel: recent RP turns (read-only)
- Proposal review panel: diffs before/after, approve/reject buttons
- Session controls: new RP session, new mechanic session, switch sessions
- Diagnostic log view (optional, collapsible)

### Proposal review UI

When the mechanic proposes changes, the UI renders them as diffs:
- **Exemplar changes:** side-by-side text comparison
- **Tag changes:** before/after tag lists
- **Config changes:** old value → new value with explanation
- **Lore edits:** side-by-side content comparison
- **Batch proposals:** multiple changes grouped, approve all or individually

Each proposal shows the mechanic's reasoning. The user can approve, reject,
or ask the mechanic to revise before proposing again.

## Tension taxonomy

The mechanic distinguishes three categories of narrative tension, and this
distinction informs both diagnosis and review pass heuristics.

### Permanent tensions

Core character dynamics that are structural to the story and should never
be fully resolved by the model. These are not bugs to fix — they are
features to protect:

- Love that is *managed* not cured (Rafe's love for Aurora)
- Wounds that are *carried* not healed (a mother wound)
- Relationships to work that are *structural* not temporary (a surgeon's
  identity)
- Geometry between friends that *changed permanently* and will never be
  simple again
- Wanting that doesn't stop because you choose (Isabella's wanting)

If the review pass detects a permanent tension being resolved or smoothed,
it's a high-severity flag. The mechanic should explicitly mark these in
lore entries (a `permanent_tension: true` flag or tag) so the review pass
can check for them.

### Scene-level tensions

Immediate dramatic stakes in the current scene that may or may not resolve:
a confrontation, a choice, a revelation. These can resolve within the
scene — that's what makes them scene-level, not permanent. But the model
often resolves them *too early* or *too neatly*. The mechanic watches for
premature resolution: a confrontation that ends in mutual understanding
when it should end in discomfort.

### Fake tensions

Misunderstandings that exist only to be cleared up. "He thinks she's
angry about X but she's actually upset about Y." These are the cheapest
kind of narrative tension and should be flagged as drift — the model is
defaulting to melodrama because it's the easiest dramatic beat. The
mechanic should identify these and redirect toward character-driven
tensions instead.

## What this replaces

### Replaces paste-in OOC nudge workflow

ST power users currently maintain a separate chat (or assistant) where
they paste context, ask for diagnosis, receive text to paste back into
the RP session, and repeat. This is the best workflow ST's architecture
allows but it's fundamentally broken:

- The mechanic has no system access (blind to state, can only guess)
- The "fix" is a paste-in text that enters RP conversation history
- The user is the manual data transport between two chat contexts
- No configuration actually changes — every fix is per-turn bandage

The proposal system replaces this. The mechanic reads actual session
state, proposes actual configuration changes, and the user approves
them once. Fixes persist. No paste-in loop.

### Replaces the drift harness

QuillForge built a deterministic drift harness with boundary traces and
structural scanners. It scanned for forbidden facts at handoff boundaries
in a multi-agent pipeline.

The mechanic agent replaces this entirely. Instead of a deterministic
scanner checking for known-bad patterns, the mechanic is an intelligent
agent that reads session internals and reasons about *any* quality problem
— not just lore bleed, but tonal drift, pacing, character inconsistency,
gravity problems. It's strictly more capable and naturally scoped to "when
the user notices something wrong."

### Replaces the structured classification protocol

QuillForge's RoleplayKnowledgePacket, RoleplayApplicabilityClassifier,
ActiveSubjectApplicability enums — all of this existed to classify lore at
agent boundaries. The single-agent narrator handles classification in its
own reasoning. The mechanic only needs to verify that classification is
working (by reading retrieval traces) and adjust retrieval config if it
isn't.

## Open questions

Most of these are genuine tradeoffs that need config knobs and dogfooding
to tune, not design gaps to close by deeper analysis. Each should be
per-campaign or per-profile configurable, adjusted by the mechanic, and
re-evaluated based on observed results.

### Multi-user (resolved: not needed)

The users each have their own private independent sessions — they don't
share campaigns, participate in the same RP, or interact with each other's
sessions. Each user logs into their own profile, sees their own campaigns
and sessions, and has their own mechanic. No shared campaign state between
users. This eliminates all the multi-user mechanic complexity.

See `User profiles and login` below for the profile mechanism.

### Config-driven questions

1. **Mechanic model selection** — does the mechanic need a strong reasoning
   model, or is a cheaper model sufficient? Config: `mechanic.model` per
   profile. Start mid-tier; upgrade if diagnostic quality is inadequate.
   The mechanic's voice calibration (casual, invested, emoji-capable) may
   require register flexibility regardless of reasoning depth.

2. **Automated quality monitoring** — should the mechanic proactively
   analyze sessions? Config: `mechanic.auto_monitor` per campaign.
   Experiment: run a lightweight quality check (passive review pass) in the
   narrator loop, and use the mechanic for on-demand user-directed diagnosis.
   If the review pass isn't intrusive, consider proactive mechanic analysis
   on a schedule (e.g., review every 20 turns). Config knob: frequency,
   depth, whether to notify the user automatically or queue findings.

3. **Proposal versioning depth** — full history or recent? Config:
   `mechanic.keep_proposal_history` with a retention window. Default: keep
   all (proposal history IS the diagnostic log). The mechanic tracks which
   fixes worked across sessions. Truncation would lose diagnostic context.

4. **Mechanic → narrator communication** — session_notes in scene state
   per the current design. If this needs richer structure (typed notes
   vs. freeform), add config fields. Start with freeform session_notes.

5. **Permanent tension marking** — flag in lorekeep entry schema (see
   `01-lore-service-design.md`). Config: `mechanic.permanent_tensions` as
   a tag or schema field. Flag presence → review pass checks for
   resolution of permanent tensions. Start with tag-based; promote to
   schema field if it proves load-bearing.

6. **Mechanic naming** — per-profile config: `mechanic.name`. User sets
   it once, the mechanic's system prompt uses it. Different campaigns
   under the same profile share the mechanic name (the mechanic is
   per-user, not per-campaign).

7. **Mechanic context contamination** — the "new mechanic session" control
   handles most cases. The "compare with fresh mechanic" mode (second
   independent instance) is an advanced diagnostic that should be
   config-gated: `mechanic.fresh_compare_available`. Default: off, enable
   if contamination becomes a recurring problem.

## User profiles and login

The RP frontend supports multiple user profiles within a single deployment.
This is a low-trust profile selection mechanism, not a security system.
Follow SillyTavern's model: selectable profiles with optional passwords,
plain-text storage, privacy suggestion not real isolation.

### Design constraints

- **Two users** (sisters), one deployment, high trust
- Each user has their own campaigns, sessions, lore, mechanic
- A profile is just a named container — no cryptographic isolation
- Password is optional, stored as plain text, used as a privacy gate
  (prevents accidental profile switching, not adversarial access)
- **Do NOT** add authentication middleware, session tokens, bcrypt,
  cryptographic best practices, or multi-user security architecture.
  Those are for a future wide-distribution scenario, not the current
  household use case.

### Profile scope

A profile owns:
- Campaigns (each campaign has its own lore scope in lorekeep)
- RP sessions
- Mechanic sessions
- Mechanic name and personality config
- Profile-level config (model routing, defaults)

Profiles do NOT share anything. No shared campaigns, no shared mechanic,
no shared session state. Each profile is a completely independent silo
within the deployment.

### Frontend behavior

- Startup: show profile selector (list of named profiles)
- Select profile: optionally enter password (if set)
- No password = direct entry (high-trust household assumption)
- Within a session: the profile is implicit; no re-authentication
- Profile management: simple UI to create/delete profiles, set/change
  passwords. Admin-only or available to all users (TBD, low-stakes).

### Backend behavior

- lorekeep: campaigns are scoped to profile IDs. Each profile's campaigns
  are invisible to other profiles (enforced by the query layer, not auth).
- rusty-crew: sessions are scoped to profile IDs. The frontend passes the
  active profile ID with each request. No server-side session auth.
- No authentication middleware. No tokens. No cryptography. The backend
  trusts the frontend to tell it which profile is active.
- If there's ever a need for real multi-user security, add it as a
  separate auth layer later — don't bake it into the v0 architecture.

### Relationship to rusty-view

`rusty-view` (the debug client) does NOT need profile support. It's a
dev tool that connects directly to rusty-crew. Profiles are a
`rusty-roleplay` concern only.

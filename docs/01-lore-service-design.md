# Lore Service Design ("lorekeep")

## Purpose

A purpose-built lore/memory service for roleplay worlds. Provides structured
storage, retrieval, and instrumentation for world content — both pre-authored
lore and facts established during play.

## Relationship to den-memory

lorekeep follows den-memory's architectural patterns but is a separate
service with RP-native vocabulary. It is not a wrapper, fork, or extension
of den-memory.

### What's shared (the shape)

- FTS5-backed search over structured entries
- Scoped recall (campaign isolation)
- Topic graph with typed edges (world structure)
- Scoring system with tunable weights
- Token-budgeted recall packets
- HTTP service, separate from the agent runtime
- Contract-first design (JSON schemas, validation, example payloads)
- SQLite storage (single-file, portable, easy backup)

### What's different (the domain)

| Concern | den-memory | lorekeep |
|---|---|---|
| Entry lifecycle | capture → candidate → propose → curate (observed facts about agent operations) | author → edit → version (world content) + capture → promote (facts established during play) |
| Authority model | claim_strength: observation, assessment, recommendation, policy | canon_level: canon, session_canon, rumor, deprecated, ambiguous |
| Scope | project / agent / global | campaign / character / location / faction |
| What gets retrieved | facts about the system and its operations | world lore, character details, established continuity, active plot threads |
| Instrumentation | recall logs for debugging agent memory behavior | retrieval traces correlated with RP output quality, scene brief composition logs, fact provenance from specific scenes |
| Control surface | scoring weights, discovery scope | retrieval depth, canon filtering, tag boosts, min score, token budget, scope filtering, recency weighting |
| Who modifies it | agents (with curation ceremony) + humans (admin) | humans (lore authoring) + RP agent (captures new facts) + mechanic agent (adjusts tags, weights, retrieval config) |

The key distinction: den-memory's curation workflow is designed for
**observed facts about agent behavior**. RP lore has two distinct lifecycles
(authored content + diegetic facts established during play) that don't map
cleanly onto den-memory's capture/curate model. Forcing the fit would be
leaky at every seam.

## Data model

### Entry types

**Authored lore entries** — world content written by humans:
- World rules, magic system constraints
- Location descriptions
- Character backstories and profiles
- Faction/organization details
- Item/equipment descriptions
- Historical events

Authored entries are direct authorship. Edit-in-place with version history.
No capture/curation ceremony — the human is the authority.

**Established facts** — things that happen during play and become world state:
- Plot events ("the protagonist stole the crown")
- Relationship changes ("Xavier and Caleb had a fight")
- Revealed information ("the king is secretly a demon")
- Character development ("the protagonist chose mercy")

Established facts are captured during play and promoted from "the model
asserted this" to durable canon. This resembles den-memory's candidate
workflow but is diegetic (about the fictional world) not meta (about the
system).

### Entry schema

Entries are scoped to a profile+ campaign. Profiles are independent silos
within a deployment — see `03-mechanic-ooc-agent.md` User profiles section.

```
Entry {
  id: int
  profile_id: string  // owning user profile (silo boundary)
  slug: string (unique within profile+campaign)
  campaign_id: string  // scoped within profile
  title: string
  summary: string (for retrieval display)
  body_md: string (full content)
  content_format: "markdown"

  // Classification
  entry_kind: "authored_lore" | "established_fact"
  subject_kind: "world_rule" | "character" | "location" | "faction" | "item" | "event" | "relationship" | "other"
  subject_refs: [string]  // slugs of referenced entities (e.g., ["xavier", "caleb"])

  // Authority
  canon_level: "canon" | "session_canon" | "rumor" | "deprecated" | "ambiguous"

  // Retrieval control
  tags: [string]
  constant: bool  // if true, always included in scene brief (world rules)
  discovery_scope: "campaign" | "character" | "location" | "explicit_only"

  // Provenance (for established facts)
  established_in_session: string (nullable)
  established_in_turn: int (nullable)
  captured_by: "rp_agent" | "mechanic_agent" | "user" (nullable)
  capture_reason: string (nullable)

  // Lifecycle
  status: "active" | "superseded" | "deprecated" | "archived"
  version: int
  created_at: timestamp
  updated_at: timestamp
  created_by: string
  updated_by: string
}
```

### Topic nodes and edges

World structure as a graph. Nodes represent entities; edges represent
relationships. This enables multi-hop exploration: "Xavier → member_of →
Silver Flame → rivals_with → Black Flame → controls → Shadow Capital."

```
TopicNode {
  id: int
  slug: string
  campaign_id: string
  title: string
  summary: string
  node_kind: "character" | "location" | "faction" | "item" | "event" | "concept"
  canon_level: string
  discovery_scope: string
  tags: [string]
}

TopicEdge {
  id: int
  from_node_id: int
  to_node_id: int
  relation: string  // "member_of", "located_in", "rival_of", "owns", "knows_about", etc.
  edge_depth_hint: int  // traversal depth suggestion (1=direct, 2=indirect)
}
```

The topic graph is optional for v0 — entries with tags and subject_refs
provide enough structure for basic retrieval. The graph becomes valuable
when campaigns grow large and multi-hop exploration matters.

## Recall API

### POST /api/recall

Primary retrieval endpoint. Returns a scored, budgeted packet of entries
relevant to the query.

```
Request:
{
  "profile_id": "sister-a",
  "campaign_id": "eldoria",
  "query": "political tension in the northern baronies",
  "active_subjects": ["xavier"],  // characters in the current scene
  "excluded_subjects": ["caleb"], // characters NOT in the scene (for bleed prevention)
  "limit": 10,
  "token_budget": 2000,
  "config_overrides": {
    "retrieval_depth": "standard",
    "min_score": 0.65,
    "canon_filter": ["canon", "session_canon"],
    "tag_boosts": {}
  }
}

Response (recall packet):
{
  "packet_id": "recall-42",
  "entries": [
    {
      "slug": "northmarch-taxes",
      "title": "Northmarch Tax Dispute",
      "summary": "The barons of Northmarch have been withholding taxes...",
      "body_md": "...",
      "score": 0.92,
      "canon_level": "canon",
      "entry_kind": "authored_lore",
      "subject_refs": ["northmarch", "barons"],
      "tags": ["politics", "conflict", "economy"],
      "match_reason": "FTS match: political, tension, northern, baron"
    }
  ],
  "skipped": [
    {"slug": "caleb-prosthetic", "reason": "excluded_subject match"}
  ],
  "token_budget": 2000,
  "tokens_used": 1840,
  "retrieval_trace_id": "trace-89"
}
```

### POST /api/entries/search

Simple search endpoint for the mechanic agent and admin UI. Returns raw
matches without scoring, budgeting, or subject filtering.

### POST /api/facts/capture

Capture a new established fact during play.

```
Request:
{
  "campaign_id": "eldoria",
  "slug": "protagonist-stole-crown",
  "title": "The protagonist stole the crown",
  "summary": "During the vault scene, the protagonist took the crown",
  "body_md": "In turn 34, the protagonist infiltrated the royal vault and stole the Crown of Eldoria.",
  "subject_refs": ["protagonist", "crown-of-eldoria"],
  "tags": ["theft", "crown", "vault"],
  "canon_level": "session_canon",  // can be promoted to "canon" later
  "established_in_session": "rp-session-a",
  "established_in_turn": 34,
  "captured_by": "rp_agent",
  "capture_reason": "Plot-significant event affecting future scenes"
}
```

### GET /api/entries/{slug}

Full entry retrieval by slug.

### PUT /api/entries/{slug}

Update an authored entry. Creates a version revision.

### POST /api/facts/{slug}/promote

Promote a session_canon fact to full canon.

## Observation surface

Every retrieval records a trace. This is what the mechanic agent reads when
diagnosing output quality problems. Compaction events also produce traces
(see `06-context-compaction.md`).

```
RetrievalTrace {
  id: string
  turn_id: int
  rp_session_id: string
  timestamp: iso8601

  queries: [string]  // all queries made this turn

  entries_considered: [
    {
      slug: string
      score: float
      retrieved: bool
      reason: string  // "included", "below_threshold", "excluded_subject", "canon_filtered"
    }
  ]

  scene_brief: {
    entries_included: [string]  // slugs
    token_budget: int
    tokens_used: int
    tonal_notes: string  // emotional register context
  }

  config_snapshot: {
    retrieval_depth: string
    min_score: float
    canon_filter: [string]
    tag_boosts: {}
    scope_filter: {}
    recency_weighting: float
  }
}
```

The trace correlates retrieval decisions with RP output. When the mechanic
asks "why did Caleb's prosthetic arm appear in Xavier's scene?", it reads
the retrieval trace and sees exactly which entries were considered,
retrieved, and skipped — and why.

### GET /api/traces/by-session/{session_id}

List retrieval traces for an RP session, newest first.

### GET /api/traces/{trace_id}

Full retrieval trace detail.

## Control surface

These are the knobs the mechanic agent (and admin UI) can adjust. All are
per-campaign configuration, stored in the service:

```
RetrievalConfig {
  campaign_id: string
  retrieval_depth: "shallow" | "standard" | "deep"  // entries to consider per query
  min_score: float  // threshold for inclusion in scene brief
  token_budget: int  // max tokens in scene brief
  canon_filter: ["canon", "session_canon"]  // which authority levels to include
  tag_boosts: {  // weight entries with certain tags higher
    "active_character": 1.5,
    "current_location": 1.3
  }
  scope_filter: {
    "campaign": true,
    "character": true,
    "location": true
  }
  recency_weighting: float  // 0.0=ignore recency, 1.0=strong recency preference
  reciprocal_scope_handling: {
    // when searching for Character A, how to handle entries mentioning Character B
    "co_mentioned_boost": 0.8,  // slight boost for entries mentioning both
    "excluded_subject_penalty": 0.0  // zero out entries about excluded subjects
  }
}

### GET /api/config/{campaign_id}
### PUT /api/config/{campaign_id}
```

## Scoring model

Adapted from den-memory's scoring approach, with RP-specific weights:

```
score = (
  fts_score * fts_weight +
  tag_match_score * tag_weight +
  subject_match_score * subject_weight +
  canon_level_modifier * canon_weight +
  recency_modifier * recency_weight +
  scope_match_modifier * scope_weight +
  tag_boost_modifier  // from config tag_boosts
) * excluded_subject_penalty
```

Named scoring profiles (like den-memory's `v0-default`):
- `narrative-default` — balanced for general RP
- `lore-heavy` — favors comprehensive lore retrieval for lore-dense campaigns
- `character-focused` — favors character-specific entries over world-level

Scoring defaults are contract artifacts, tuned after dogfooding.

## SillyTavern lore book migration

Lore books are JSON. Conversion is a script:

| ST field | lorekeep mapping |
|---|---|
| `key` (keywords) | → tags + FTS-indexed title |
| `content` | → body_md |
| `constant: true` | → constant: true (always in scene brief) |
| `constant: false` | → standard entry, retrieved on demand |
| `keysecondary` | → additional tags |
| `order` / `position` | → irrelevant in agentic model (no prompt positioning) |
| `name` | → title |
| `comment` | → summary |
| `selective` / `disable` | → discovery_scope / status |

World-level lore books → campaign scope. Character-specific entries →
subject_kind=character with subject_refs.

Migration is one-time, per campaign. Not an architecture concern.

## v0 contract approach

Following den-memory's pattern: lock vocabulary, scoring defaults, JSON
schemas, and example payloads before building the service implementation.

### Contract artifacts

```
contracts/v0/
  registry.json              — enum/registry values (entry_kinds, subject_kinds, canon_levels, etc.)
  scoring-defaults.json      — named scoring profiles with weights
  schemas/
    entry.schema.json
    recall-request.schema.json
    recall-packet.schema.json
    retrieval-trace.schema.json
    retrieval-config.schema.json
    fact-capture.schema.json
  examples/v0/
    *.example.json           — valid example payloads
```

### Validation

```bash
# Standalone validation command (Go, following den-memory pattern)
lorekeep validate
```

Contract artifacts are the stable interface for agent tools, the mechanic
agent, and the migration script. Implementation can evolve behind the
contract.

## Implementation language

Open question. Two options:

**Go (following den-memory):**
- Pro: den-memory is Go, proven pattern, stdlib HTTP + SQLite (modernc.org/sqlite)
- Pro: FTS5 works naturally with SQLite
- Pro: single binary deployment
- Con: introduces Go into a system that's otherwise Rust + TS

**Rust (following rusty-crew coordination layer):**
- Pro: language consistency with rusty-crew
- Pro: can potentially share types with rusty-crew crates
- Con: rusty-crew's Rust layer owns coordination, not domain services
- Con: Rust HTTP + SQLite + FTS5 is more setup than Go

Recommendation: **Go**, following den-memory's pattern. The service is a
self-contained HTTP API over SQLite. Language consistency with rusty-crew
isn't worth the implementation friction. The service communicates over HTTP;
the implementation language is an internal detail. den-memory proves the
pattern works.

## Deployment

Server-first deployment. Services run on den-srv or den-k8. Users access via
browser over Tailscale VPN — the same pattern that has worked for their ST
access for 6+ months. No desktop app, no local installs, no per-platform
builds.

Following den-memory's deployment model:
- systemd service on den-srv (192.168.1.10)
- service user/group: `lorekeep`
- SQLite database at `/data/services/lorekeep/data/lorekeep.sqlite`
- trusted-LAN HTTP, no auth in v0 (Tailscale provides network security)
- deploy helper script for den-k8 agents

One database file per instance. Campaigns are rows, not separate databases.
Backups are file copies.

Frontend accesses lorekeep indirectly — through rusty-crew session tools.
Direct lorekeep HTTP is for the mechanic agent and admin operations.
Users never see lorekeep directly.

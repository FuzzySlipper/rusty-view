# Generic Message Alternates

`rusty-view` needs a generic way to represent multiple variants for the same
transcript position. Downstream apps may call this a retry, regeneration, edit,
candidate, or something domain-specific, but core only models a stable message
slot with ordered variants.

This document intentionally avoids downstream product concepts. The primitive is
useful for agent oversight as well: an operator can compare retries, failed
attempts, tool-rich variants, or revised assistant outputs without losing the
original message shape.

## Public View Model

Task #3340 chooses a slot/variant model:

```text
MessageAlternateSlot
  id                    stable transcript slot id
  sessionId
  primary               MessageVariant
  alternates[]          ordered alternate MessageVariant values
  activeVariantId       undefined means primary
  metadata

MessageVariant
  id                    stable variant id
  slotId
  source                primary | alternate
  ordinal               display/order position, primary is 0
  message               full ChatMessage
  metadata
```

Each variant owns a full `ChatMessage`, and each `ChatMessage` owns its full
`MessageBlock[]`. `ChatMessage` and `MessageBlock` both have optional generic
metadata records so an alternate can preserve provider ids, raw payload refs,
tool/debug details, moderation or scoring data, and downstream plugin hints
without flattening everything to text.

The transcript renderer can keep the slot id as the virtualization key and swap
the active variant inside the existing row. That is the important UI property:
local selection changes should not refetch history, reorder the transcript, or
invalidate scroll anchoring.

## Local Switching

`@rusty-view/chat-domain` exports pure helpers:

- `messageAlternateSlot(primaryMessage, options)`
- `activeMessageVariant(slot)`
- `activeMessageForSlot(slot)`
- `orderedMessageVariants(slot)`
- `withActiveMessageVariant(slot, variantId)`

They return new immutable values and do not call storage or network APIs. Unknown
variant ids fall back to the primary message, which gives the UI a safe recovery
path if persisted selection state points at a deleted alternate.

## Storage Options

### Option A: Separate Alternate Records

Store alternates as first-class rows/records tied to a stable message slot:

```text
message_slots(id, session_id, primary_message_id, active_variant_id, ...)
message_variants(id, slot_id, source, ordinal, message_id, metadata, ...)
messages(id, session_id, author, status, created_at, metadata, ...)
message_blocks(id, message_id, kind, content_ref, render_policy, metadata, ...)
```

Pros:

- Preserves message and block metadata naturally.
- Supports lazy loading alternates for large histories.
- Allows indexes on slot id, variant id, session id, order, status, and author.
- Keeps deletes, edits, active-selection updates, and audit history narrow.
- Avoids repeatedly rewriting large JSON blobs for one alternate change.

Cons:

- Requires more backend tables/records and API endpoints.
- Requires migration logic from old single-message projections.
- Requires the frontend to reconcile slot/variant events rather than only a flat
  message list.

### Option B: Inline JSON Array On Message

Store alternates as an array/blob on the primary message row.

Pros:

- Faster to prototype if the backend only exposes message CRUD.
- Fewer endpoints and fewer records.
- Simple snapshot reads for small sessions.

Cons:

- Large message rows grow quickly and become expensive to rewrite.
- Harder to index, lazy-load, audit, or delete one alternate.
- Encourages lossy text-only alternates unless the JSON shape duplicates the
  full message/block model.
- Makes active-selection updates compete with the entire message payload.
- More likely to hurt long transcript performance and cache behavior.

## Decision

Use Option A for durable backend storage and API design. `rusty-view` can accept
already-hydrated slots from any adapter, but the durable protocol should model
message slots and variants as separate records/events rather than nesting all
alternates under a single message JSON blob.

The frontend primitive added here is compatible with Option A and does not
preclude a temporary adapter from translating an Option B payload into slots if
early backend work needs a bridge.

## Backend Gaps

Do not implement these in `rusty-view`; they belong in the Rust protocol and
persistence layer:

- Stable message-slot ids distinct from variant/message ids.
- First-class alternate/variant records with ordinal, source, status, metadata,
  and full message/block linkage.
- Session projection endpoints/events that can hydrate primary messages with
  ordered alternates and current active variant selection.
- CRUD or command APIs for creating alternates, deleting alternates, reordering
  alternates, and selecting the active variant.
- Lazy-load endpoint for alternates so 10k+ message transcripts do not hydrate
  every variant eagerly.
- Migration strategy for existing single-message rows/events into primary
  slots.
- Storage indexes for `(session_id, slot_id)`, `(slot_id, ordinal)`, and
  `active_variant_id` lookup.
- Conflict semantics for concurrent active-variant selection changes.

Until those backend surfaces exist, the reducer should not invent alternate
events. UI or downstream adapters can use `MessageAlternateSlot` locally with
fully hydrated data.

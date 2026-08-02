# Conversation Tree Navigation

`rusty-view` models conversation tree navigation as generic transcript
structure: branches, snapshots, parent links, breadcrumbs, and jump targets.
Core keeps downstream product labels out of these primitives.

## Domain Model

Messages may carry an optional tree position:

```text
ChatMessage.tree
  branchId
  parentMessageId
  previousMessageId
  snapshotIds[]
```

Branches describe durable paths through the transcript:

```text
ConversationBranch
  id
  sessionId
  parentBranchId
  parentMessageId
  originMessageId
  headMessageId
  label
  createdAt
  metadata
```

Snapshots describe named or system-created navigation targets:

```text
ConversationSnapshot
  id
  sessionId
  branchId
  messageId
  cursor
  label
  summary
  createdAt
  metadata
```

`SummaryCheckpoint` remains as a summary-bearing snapshot/checkpoint shape for
existing projection callers.

## Navigation Helpers

`@rusty-view/chat-domain` exports pure helpers:

- `branchBreadcrumbs(branches, activeBranchId)`
- `branchJumpTarget(branch)`
- `snapshotJumpTarget(snapshot)`
- `messageJumpTarget(messageId)`

Branch breadcrumbs walk parent branch ids from the active branch back to the
root, guard against cycles, and return root-to-active crumbs. Branch jump target
priority is `headMessageId`, then `originMessageId`, then `parentMessageId`.

## Transcript UI

`rv-transcript-viewport` accepts optional tree navigation inputs:

```html
<rv-transcript-viewport
  [messages]="messages"
  [branches]="branches"
  [activeBranchId]="activeBranchId"
  [snapshots]="snapshots"
  (navigationRequested)="onNavigationRequested($event)"
/>
```

When no branches or snapshots are supplied, the transcript renders exactly as it
did before. When supplied, a compact navigation strip renders above the
bounded transcript. Selecting a breadcrumb or snapshot emits a generic
`ConversationNavigationTarget` and calls the viewport's existing stable
message-id jump path.

The resident-window key remains the message id. Tree navigation does not
replace the rendered message array, so scroll anchoring and tail-follow
behavior stay under the same viewport code path.

## Backend Gaps

Do not implement these in `rusty-view`; they belong in the Rust protocol and
persistence layer:

- Message records need durable `branch_id`, `parent_message_id`, and previous
  sibling/linear-order identifiers where appropriate.
- Branch records need parent branch id, branch origin, head/current message id,
  label, timestamps, and metadata.
- Snapshot records need branch/message/cursor targets, label, summary, creation
  source, timestamps, and metadata.
- Session projection APIs/events need to hydrate branches, snapshots, active
  branch selection, and message tree positions.
- Jump APIs should support message id, branch id, snapshot id, and cursor
  targets without requiring clients to load the full tree eagerly.
- Storage indexes are needed for `(session_id, branch_id)`,
  `(parent_branch_id)`, `(parent_message_id)`, `(branch_id, created_at)`, and
  snapshot lookup by `(session_id, message_id)`.
- Conflict semantics are needed for concurrent branch head and active-branch
  updates.
- Migration needs to place existing flat transcripts into a default branch.

Until those backend surfaces exist, adapters may provide local branch/snapshot
view models, but the reducer should not invent protocol events.

# Rusty View Transcript Search and Navigation

Rusty View owns generic current-conversation search and jump navigation for
large transcripts. The feature is deliberately limited to the messages already
loaded into the current conversation projection; downstream products can layer
their own labels and workflows on top.

## Current-Conversation Search

`@rusty-view/chat-domain` exposes `searchConversationMessages(messages, query,
filters)` with pure frontend matching over `ChatMessage` view models.

Supported filters:

- role: `user`, `assistant`, `system`, or `tool`;
- date range using message `createdAt`;
- attachment text through attachment names, MIME types, and extracted text
  previews.

Search results preserve transcript order and identify the matched message and
block. The transcript viewport uses those ids to admit the keyed row window
around the target before semantic scrolling and highlighting.

## Viewport UI

`TranscriptViewportComponent` renders a compact search toolbar by default.
Consumers can disable it with `searchEnabled=false` and provide their own chrome
while still using the domain search helper and `targetMessageId` jump input.

The built-in toolbar supports:

- current-conversation query;
- role filter;
- date-from and date-to filters;
- previous/next result navigation;
- active result snippet;
- message/block highlighting;
- jump-to-message through the bounded keyed-window path.

The existing `targetMessageId` input remains the generic programmatic jump API
for search results, branch breadcrumbs, snapshots, bookmarks, and downstream
navigation controls.

## Backend/API Gaps

This frontend search is not a substitute for backend search. Rusty Crew already
has runtime FTS for Rust-owned coordination history, but Rusty View does not yet
have a stable frontend API for persisted transcript FTS or cross-conversation
search.

Backend/protocol work still needed:

- stable current-session message search endpoint for unloaded history;
- cross-conversation search API with session/conversation filters;
- role/date filters in backend search results;
- snippet and highlight offset fields from the backend;
- jump targets that can hydrate unloaded history before scrolling;
- clear ownership split between Rust coordination search and Den product-data
  search.

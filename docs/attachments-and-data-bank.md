# Rusty View Attachment and Data-Bank Primitives

Rusty View exposes generic attachment and reusable-file primitives for chat
clients without naming any downstream product concepts. Consumers define their
own scopes, persistence rules, and upload backends.

## Frontend Model

`@rusty-view/chat-domain` owns the view-model types:

- `ChatAttachment` describes a renderable file reference: stable id, media kind,
  name, MIME type, byte size, URLs, optional thumbnail, optional extracted text
  preview, optional scope id, and opaque metadata.
- `AttachmentMediaKind` is deliberately small: `image`, `audio`, `video`, or
  `file`.
- `ChatAttachmentScope` is a consumer-defined reusable-file scope. Rusty View
  treats the scope id and metadata as opaque data.
- `MessageBlock.attachment` lets transcripts render attachments inline without
  inventing attachment-specific block kinds in every consumer.

## Input Surface

`MessageInputComponent` can opt into attachments with
`attachmentsEnabled=true`.

It accepts files from:

- file picker selection;
- paste;
- drag and drop.

The component emits `attachmentsSelected` with the browser `File`, generated
attachment metadata, source (`picker`, `paste`, or `drop`), and the selected
scope. It also emits `attachmentRemoved` when a selected chip is removed.

For text-like files, the input creates a bounded local preview so consumers can
show or upload extracted text without needing to parse every file synchronously
inside the transcript renderer.

## Default Rendering

`@rusty-view/transcript-renderer` provides a default `AttachmentBlockComponent`.
It renders:

- images with thumbnail fallback to full URL;
- audio with native controls;
- video with native controls and optional poster;
- generic files as openable links when a URL is present.

All renderers show file metadata and optional extracted text previews. Consumers
can still use generic content-renderer hooks for richer product-specific blocks.

## Backend/API Gaps

Rusty View currently creates frontend metadata only. The backend needs a typed
attachment/data-bank API before these primitives can persist across sessions:

- upload endpoint or streaming upload protocol;
- attachment record storage with message/block linkage;
- scoped reusable file collections keyed by consumer-defined scope ids;
- durable download/thumbnail URLs;
- extracted-text storage and truncation metadata;
- MIME/type validation, size limits, and lifecycle cleanup;
- list/query/remove operations for reusable file scopes;
- protocol events for uploaded, linked, removed, and updated attachments.

These belong in the Rust backend/protocol surface, not in this Angular repo.

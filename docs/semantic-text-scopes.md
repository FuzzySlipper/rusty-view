# Semantic Text Scopes

Rusty View supports product-agnostic semantic spans for plain transcript text.
Downstream apps can map their own concepts onto stable scope names without
forking the renderer.

## Domain API

`MessageBlock.textSpans` is an optional list of UTF-16 string ranges over
`MessageBlock.content`:

```ts
{
  kind: 'text',
  content: 'Quiet line with emphasis.',
  textSpans: [
    { start: 0, end: 10, scope: 'muted' },
    { start: 16, end: 24, scope: 'emphasis' },
  ],
}
```

Built-in scopes are:

- `plain`
- `accent`
- `muted`
- `quote`
- `emphasis`
- `strong`
- `code`
- `success`
- `warning`
- `danger`

Custom scope strings are allowed. The base renderer only styles the built-in
scopes; downstream apps may add CSS for their own
`[data-rv-text-scope='...']` selectors.

## Safety

Semantic spans render through Angular text interpolation, not `innerHTML`.
When a text block has semantic spans, the renderer uses the safe text-node path
instead of Markdown or sanitized HTML. Malformed spans are clamped, and
overlapping spans are dropped so text order remains intact.

## Theme Tokens

Built-in scopes use `--rv-text-scope-*` design tokens. Downstream apps can
override those tokens with their normal theme layer. A demonstration palette is
available by setting:

```html
<html data-rv-text-scope-theme="demo">
```

## Downstream Mapping

Keep product language outside Rusty View. For example, a roleplay package can
map dialogue to `accent` and narration to `muted`, or it can provide
`rp-dialogue` / `rp-narration` custom scopes and style them in its own package.

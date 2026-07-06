# Rusty View Rendering Configuration

Rusty View keeps Markdown and HTML rendering configurable without naming any
downstream product syntax.

## Text Modes

`TRANSCRIPT_TEXT_RENDER_MODE` controls the broad rendering mode:

- `auto`: detect meaningful Markdown or safe HTML per block;
- `raw`: render literal text only;
- `markdown`: parse Markdown into safe HTML;
- `sanitized-html`: sanitize HTML before Angular's final `[innerHTML]` layer.

Every formatted block still has a per-block raw toggle, so users can recover
from incorrect formatting.

## Markdown Policy

`TRANSCRIPT_MARKDOWN_POLICY` controls Markdown-specific behavior:

- `literalExclusions`: product-defined literal strings that bypass Markdown and
  render as raw text;
- `enableUnderscoreHorizontalRules`: opt into treating underscore-only lines as
  horizontal rules;
- `showCodeBlockLanguageLabels`: show fenced-code language labels;
- `showCodeBlockCopyButtons`: show copy controls for fenced code blocks.

Literal exclusions support `exact`, `contains`, and `line` matching, plus
optional case-sensitive matching. Rusty View ships with no literal exclusions.
Consumers provide their own syntax rules through DI.

## Safe Defaults

The default policy is conservative:

- no downstream-specific literal strings;
- underscore-only lines stay literal;
- code blocks show language labels and copy controls;
- Markdown source is escaped before parsing;
- links are protocol-validated;
- raw HTML is never emitted by the Markdown parser.

## Semantic Text Spans

Text blocks may provide `MessageBlock.textSpans` for semantic styling of plain
text ranges. These spans are range metadata over the original content, not HTML.
When spans are present, Rusty View renders through the safe raw-text path and
applies generic `data-rv-text-scope` attributes to the generated spans.

See [semantic-text-scopes.md](semantic-text-scopes.md).

## Ownership

Rendering configuration is TypeScript/UI policy. The backend does not need to
know product-specific separators or literal strings. If a host wants persistent
preferences, it should store policy settings in its own user/preferences layer
and provide the resulting policy to Rusty View.

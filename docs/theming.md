# Theming & design tokens

Rusty View is skinned entirely from one place: the **design tokens** in
`libs/design-tokens`. Everything visual — colours, fonts, spacing, radius,
shadows, z-index, motion — is a CSS custom property (`--rv-*`). Components only
ever reference tokens; they never hardcode a value. This is what lets a single
theme reskin the whole app (shell, transcript, panels) and lets users edit and
share complete themes.

## The layers

1. **Token definitions** — `libs/design-tokens/src/styles/tokens.css`
   The single source of truth for values. Holds the dark default palette, the
   `prefers-color-scheme: light` palette, and the named-theme blocks
   (`[data-rv-theme='dark' | 'light' | 'high-contrast']`). **This is the only
   file allowed to contain raw colour/shadow literals.** Published packages
   expose the same file as `@rusty-view/design-tokens/tokens.css`.

2. **Token names** — `libs/design-tokens/src/lib/token-names.ts`
   Typed `--rv-*` names (`COLOR_TOKENS`, `SHADOW_TOKENS`, …) plus
   `ALL_DESIGN_TOKEN_NAMES`. Use these for any programmatic token reference so
   it's refactor-safe.

3. **The theme service** — `libs/chat-theme` (`ChatTheme`)
   Owns the user's `AppearanceSettings` (named base theme, fonts, density, and a
   full per-token colour override map), applies them live to `documentElement`,
   and persists them. It manages the **whole** colour palette generically — not
   a hand-maintained subset — and supports JSON export/import of a complete
   theme.

4. **The editor** — Options → Appearance (`libs/chat-shell/appearance-tab`)
   Base-theme selector, font/density controls, a colour input per semantic
   token, and import/export.

## The green path (how to style a component)

- **Pick a semantic token.** `color: var(--rv-color-text-secondary);`,
  `background: var(--rv-color-surface-raised);`,
  `box-shadow: var(--rv-shadow-overlay);`. Browse `tokens.css` /
  `token-names.ts` for the full set.
- **For transcript semantic text scopes,** override
  `--rv-text-scope-plain`, `--rv-text-scope-accent`,
  `--rv-text-scope-muted`, `--rv-text-scope-quote`,
  `--rv-text-scope-emphasis`, `--rv-text-scope-strong`,
  `--rv-text-scope-code`, `--rv-text-scope-success`,
  `--rv-text-scope-warning`, and `--rv-text-scope-danger`.
- **Never write a raw value** (`#fafafa`, `rgba(0,0,0,.5)`, `0 8px 32px …`) in a
  component stylesheet, and **never use a `var(--rv-…, fallback)` fallback** —
  the fallback hides drift and escapes the theme.
- **Missing a token?** Add it to `tokens.css` (all relevant palettes) and
  `token-names.ts`, then reference it. Add it to `AppearanceColors` /
  `APPEARANCE_COLOR_FIELDS` in `libs/chat-theme` if it should be user-editable.
  Don't invent a one-off colour in the component.

## Enforcement

`npm run lint:tokens` (`tools/check-design-tokens.mjs`, run in `ci`) scans every
component stylesheet and fails on:

- raw colour literals (hex / `rgb()` / `rgba()` / `hsl()` / `hsla()`),
- `var(--rv-…, <fallback>)` fallback literals,
- references to `--rv-*` tokens not defined in `tokens.css` (typos / invented
  tokens).

The allowlist is read from `tokens.css` itself, so it never goes stale.

## Downstream apps

Apps that consume published `@rusty-view/*` components must include the base
token CSS before their own app styles. Without it, component styles still refer
to `--rv-*` variables but the browser has no package-level definitions.

For Angular apps, add the package CSS to the global styles list:

```jsonc
// angular.json or project.json
"styles": [
  "node_modules/@rusty-view/design-tokens/tokens.css",
  "src/styles.css"
]
```

CSS bundlers that resolve package exports can also import it directly:

```css
@import '@rusty-view/design-tokens/tokens.css';
```

Downstream apps may override tokens after that import by setting
`[data-rv-theme]` or writing later `--rv-*` custom properties.

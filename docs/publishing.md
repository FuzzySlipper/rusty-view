# Publishing the `@rusty-view/*` libraries

The rusty-view libraries are consumed by other repos (e.g. `rusty-roleplay`) as
versioned package dependencies. This doc explains how they are built for
external consumption and how to publish them.

## Why publishing needs care

Inside this workspace the libs link to each other two ways:

- **tsconfig paths** (`tsconfig.base.json`) for build-time resolution, and
- **`workspace:*`** specifiers in each lib's `package.json` for pnpm linking.

Neither survives outside the workspace:

- `workspace:*` does not resolve when the package is installed from a registry.
- The **built** artifact (`dist/libs/<lib>`), not the source package, is what
  gets published — and ng-packagr/tsc cannot rewrite the workspace protocol.

Additionally, the Angular libs **must** be built in **partial** compilation
mode. The default `@nx/angular:ng-packagr-lite` build is *full* compilation,
which is fine for in-workspace use but breaks cross-repo consumers: the
consuming app's Angular linker can't integrate full-compiled libraries
(signal-input bindings silently fail; `NG0203` under the dev server). Partial
mode is set per Angular lib in `tsconfig.lib.prod.json`:

```jsonc
// libs/transcript-renderer/tsconfig.lib.prod.json
{ "angularCompilerOptions": { "compilationMode": "partial" } }
```

(`chat-store`, `transcript-renderer`, `chat-components`, `chat-shell`.) The
pure-TS libs (`@nx/js:tsc`: `protocol`, `transport`, `chat-domain`,
`design-tokens`) have no compilation-mode concern.

## Publish

```sh
# one-time: auth for the local registry (verdaccio in $all mode accepts any token)
npm config set //localhost:4873/:_authToken "local-dev"

pnpm publish:libs -- --version 0.0.3
# or against another registry:
pnpm publish:libs -- --version 0.0.3 --registry http://localhost:4873/
# preview without publishing:
pnpm publish:libs -- --version 0.0.3 --dry-run
```

`tools/publish-libs.mjs`:

1. builds the publishable libs (`nx run-many -t build`, partial mode for Angular);
2. for each `dist/libs/<lib>`: rewrites `workspace:*` and any `@rusty-view/*`
   range to `^<version>`, sets the version, and removes `private` from the
   **built** manifest (the source stays `private` so the source dir can never
   be published by accident);
3. `npm publish`es each to the registry (idempotent — already-published versions
   are skipped).

Published set: `protocol`, `transport`, `chat-domain`, `design-tokens`,
`chat-store`, `transcript-renderer`, `chat-components`, `chat-shell`.
`testing-fixtures` (test-only) and `workspace-generators` (internal) are not
published.

## Consume (in another repo)

Point the `@rusty-view` scope at the registry and install:

```ini
# .npmrc
@rusty-view:registry=http://localhost:4873/
```

```jsonc
// package.json — use the published version
"@rusty-view/transcript-renderer": "^0.0.3"
```

The consuming app's Angular version should be **>=** the version the libs were
compiled with (currently `@angular/core` 21.2.17) so the linker handles the
partial declarations; a `~21.2.0` range resolves `core`/`compiler-cli`
appropriately.

> Local-dev note: a local verdaccio is the current registry. It proxies npmjs,
> so non-`@rusty-view` packages still resolve normally.

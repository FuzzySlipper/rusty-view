import nx from '@nx/eslint-plugin';

/**
 * Rusty View workspace ESLint configuration.
 *
 * The load-bearing rule here is `@nx/enforce-module-boundaries`. It encodes the
 * library dependency direction described in `docs/rusty-view.md` and the
 * boundary table in `agents-project.md`. Two orthogonal tag dimensions are used:
 *
 *   - `type:*`   governs which project *kinds* may be depended on
 *                (apps are composition roots; libs cannot depend on apps or on
 *                testing fixtures; only apps/tests may consume fixtures).
 *
 *   - `scope:*`  governs the directional wiring between chat libraries
 *                (protocol is a leaf; transport/domain depend on protocol;
 *                chat-store depends on protocol + chat-domain; the shell is the
 *                only place that may wire transport + store + components).
 *
 * Constraints are AND-ed across matching tags, so both the `type` and `scope`
 * constraints must be satisfied for any given import.
 */
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/.nx',
      // Machine-generated protocol types (openapi-typescript). Not hand-edited;
      // see libs/protocol/src/generated/openapi.ts and the `protocol:generate` task.
      '**/src/generated/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // ---- type layer: which project kinds may be depended on ----
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:app',
                'type:lib',
                'type:testing',
              ],
            },
            {
              // Production libraries may not depend on apps or test fixtures.
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              // Test/fixture packages may reuse libs and other fixtures.
              sourceTag: 'type:testing',
              onlyDependOnLibsWithTags: ['type:lib', 'type:testing'],
            },
            // ---- scope layer: directional wiring between chat libraries ----
            {
              sourceTag: 'scope:protocol',
              onlyDependOnLibsWithTags: [],
            },
            {
              sourceTag: 'scope:design-tokens',
              onlyDependOnLibsWithTags: [],
            },
            {
              sourceTag: 'scope:transport',
              onlyDependOnLibsWithTags: ['scope:protocol'],
            },
            {
              sourceTag: 'scope:chat-domain',
              onlyDependOnLibsWithTags: ['scope:protocol'],
            },
            {
              sourceTag: 'scope:chat-store',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:chat-domain',
                'scope:transport',
              ],
            },
            {
              // Theme/appearance state + settings storage. Depends only on
              // design-token names (pure constants). Consumed by the shell.
              sourceTag: 'scope:chat-theme',
              onlyDependOnLibsWithTags: ['scope:design-tokens'],
            },
            {
              sourceTag: 'scope:transcript-renderer',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:chat-domain'],
            },
            {
              sourceTag: 'scope:chat-components',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:chat-domain',
                'scope:transcript-renderer',
              ],
            },
            {
              // The shell is the composition layer: it wires transport into the
              // store and renders components + the transcript. It may not reach
              // for product concepts (none exist in rusty-view by construction).
              sourceTag: 'scope:chat-shell',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:transport',
                'scope:chat-domain',
                'scope:chat-store',
                'scope:chat-theme',
                'scope:transcript-renderer',
                'scope:chat-components',
              ],
            },
            {
              // Fixtures model protocol + domain shapes; nothing more.
              sourceTag: 'scope:testing-fixtures',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:chat-domain'],
            },
            {
              sourceTag: 'scope:workspace-generators',
              onlyDependOnLibsWithTags: [],
            },
          ],
        },
      ],
      // ---- Forbidden-pattern rules (docs/rusty-view.md + agents-project.md) ----
      // No `any`, ever. Use `unknown` and narrow with type guards.
      '@typescript-eslint/no-explicit-any': 'error',
      // No non-null assertions. Handle nullability explicitly.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      // Type-only imports make lane boundaries visible to a reviewer.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
    },
  },
];

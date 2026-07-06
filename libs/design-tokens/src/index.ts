/**
 * @rusty-view/design-tokens
 *
 * Design tokens for rusty-view: colors, spacing, typography, density,
 * surfaces, z-index, and motion. Values are defined as CSS custom properties in
 * `./styles/tokens.css`; the typed token *names* are re-exported here so that
 * components can reference token names in a refactor-safe way.
 *
 * No app-specific theme assumptions and no product concepts. Defaults are
 * debug-appropriate: dense, monospace-friendly, and dark-first with a light
 * override for `prefers-color-scheme: light`.
 *
 * Part of the workspace scaffolding (Den task #3179).
 */

export type { DesignTokenName } from './lib/token-names';
export {
  ALL_DESIGN_TOKEN_NAMES,
  COLOR_TOKENS,
  TEXT_SCOPE_TOKENS,
  SHADOW_TOKENS,
  SPACING_TOKENS,
  TYPOGRAPHY_TOKENS,
  DENSITY_TOKENS,
  LAYOUT_TOKENS,
  Z_INDEX_TOKENS,
  MOTION_TOKENS,
} from './lib/token-names';

export const DESIGN_TOKENS_VERSION = '0.0.0' as const;

import { InjectionToken, signal, type Signal } from '@angular/core';

/**
 * DI token for the global Markdown-rendering preference.
 *
 * Provides a readonly signal of boolean — `true` means text blocks render as
 * formatted Markdown, `false` means raw plain text. The default is `true`.
 *
 * The transcript-renderer is roleplay-agnostic and does not depend on
 * `@rusty-view/chat-theme`. The shell (or any host) overrides this token with
 * a computed signal sourced from its appearance settings so live preference
 * changes propagate immediately. Per-block raw toggles in
 * {@link MessageBlockComponent} take precedence over this global setting.
 *
 * Example provider:
 *   {
 *     provide: TRANSCRIPT_MARKDOWN_ENABLED,
 *     useFactory: (theme: ChatTheme) =>
 *       computed(() => theme.settings().markdownRendering),
 *     deps: [ChatTheme],
 *   }
 */
export const TRANSCRIPT_MARKDOWN_ENABLED = new InjectionToken<Signal<boolean>>(
  'TRANSCRIPT_MARKDOWN_ENABLED',
  {
    providedIn: 'root',
    factory: (): Signal<boolean> => signal(true),
  },
);
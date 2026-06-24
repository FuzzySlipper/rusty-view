import { InjectionToken, signal, type Signal } from '@angular/core';

/**
 * How text blocks in the transcript are rendered.
 *
 * - `raw` — plain text, no formatting. Always available as a safe fallback.
 * - `markdown` — content parsed as Markdown → HTML (task #3259). Safe: all
 *   content is HTML-escaped before parsing; link URLs are protocol-validated.
 * - `sanitized-html` — content treated as inline HTML, pre-sanitized via
 *   {@link TRANSCRIPT_HTML_POLICY} then bound through Angular's `[innerHTML]`
 *   sanitizer as a final defense layer (task #3260).
 *
 * The global mode comes from the host's appearance settings (see
 * {@link TRANSCRIPT_TEXT_RENDER_MODE}). Per-block raw toggles in
 * {@link MessageBlockComponent} override to `raw` so users can always recover
 * to plain text when rendering is wrong, slow, or visually confusing.
 */
export type TextRenderMode = 'raw' | 'markdown' | 'sanitized-html';

/**
 * DI token for the global text render mode preference.
 *
 * Provides a readonly signal of {@link TextRenderMode}. The default is
 * `markdown`. The transcript-renderer is roleplay-agnostic and does not depend
 * on `@rusty-view/chat-theme`; the shell overrides this token with a computed
 * signal sourced from its appearance settings so live changes propagate
 * immediately.
 *
 * Example provider:
 *   {
 *     provide: TRANSCRIPT_TEXT_RENDER_MODE,
 *     useFactory: (theme: ChatTheme) =>
 *       computed(() => theme.settings().textRenderMode),
 *     deps: [ChatTheme],
 *   }
 */
export const TRANSCRIPT_TEXT_RENDER_MODE = new InjectionToken<Signal<TextRenderMode>>(
  'TRANSCRIPT_TEXT_RENDER_MODE',
  {
    providedIn: 'root',
    factory: (): Signal<TextRenderMode> => signal('markdown'),
  },
);

/**
 * Allowed HTML tag set for the default sanitized-HTML policy.
 *
 * Basic formatting, structure, and links. Scripts, iframes, embeds, styles,
 * forms, and other executable/layout-breaking tags are stripped.
 */
export const DEFAULT_ALLOWED_HTML_TAGS: readonly string[] = [
  'p', 'br', 'b', 'i', 'em', 'strong', 'code', 'pre', 'kbd', 's', 'del',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
  'a', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'img',
];

/**
 * Allowed HTML attribute names for the default sanitized-HTML policy.
 * All `on*` event handler attributes and `style` attributes are stripped.
 */
export const DEFAULT_ALLOWED_HTML_ATTRS: readonly string[] = [
  'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'target', 'rel',
];

/**
 * Policy contract for HTML sanitization. Downstream consumers (e.g.
 * rusty-roleplay) can override {@link TRANSCRIPT_HTML_POLICY} to impose a
 * stricter or richer allowed surface without changing the base renderer.
 */
export interface HtmlSanitizerPolicy {
  readonly allowedTags: readonly string[];
  readonly allowedAttrs: readonly string[];
  /** Validate a URL for safe use in href/src. Return null to reject. */
  validateUrl(url: string): string | null;
}

/**
 * Default sanitizer policy: allows basic formatting and links, strips scripts,
 * event handlers, iframes, styles, and dangerous URLs.
 */
export const DEFAULT_HTML_SANITIZER_POLICY: HtmlSanitizerPolicy = {
  allowedTags: DEFAULT_ALLOWED_HTML_TAGS,
  allowedAttrs: DEFAULT_ALLOWED_HTML_ATTRS,
  validateUrl(url: string): string | null {
    const trimmed = url.trim();
    if (trimmed.length === 0) return null;
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('../')
    ) {
      return trimmed;
    }
    if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
      return trimmed;
    }
    return null;
  },
};

/**
 * DI token for the HTML sanitizer policy. Override to customize the allowed
 * tag/attribute surface for sanitized-HTML render mode.
 */
export const TRANSCRIPT_HTML_POLICY = new InjectionToken<HtmlSanitizerPolicy>(
  'TRANSCRIPT_HTML_POLICY',
  {
    providedIn: 'root',
    factory: (): HtmlSanitizerPolicy => DEFAULT_HTML_SANITIZER_POLICY,
  },
);

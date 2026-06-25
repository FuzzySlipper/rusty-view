import type { WorkerRequest, WorkerResponse } from './worker-message-protocol';
import {
  DEFAULT_HTML_SANITIZER_POLICY,
  DEFAULT_MARKDOWN_RENDER_POLICY,
  type HtmlSanitizerPolicy,
  type MarkdownRenderPolicy,
} from './render-mode-token';

/**
 * Inline (main-thread) implementations of all worker operations.
 *
 * Used as a fallback when Web Workers are unavailable (SSR, test environments,
 * or environments without worker support). These are intentionally simple — no
 * external dependencies, no syntax highlighting libraries. They produce safe
 * HTML via escaping.
 */

/** Escape HTML special characters to prevent injection. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Minimal markdown → HTML conversion.
 *
 * Supports: paragraphs, headings (H1-H6), bold (**text**), italic (*text*),
 * inline code (`code`), code blocks (```lang\ncode```), unordered/ordered
 * lists, links [text](url), blockquotes (>), horizontal rules (---), tables,
 * and line breaks.
 *
 * **Safety model**: all content is HTML-escaped *before* any markdown
 * processing. Link URLs are validated to allow only http(s)/mailto/relative
 * protocols — `javascript:` and other dangerous schemes are rejected and
 * rendered as plain text. No raw HTML from the source ever reaches the output
 * as executable markup.
 */
function parseMarkdown(
  content: string,
  policy: MarkdownRenderPolicy = DEFAULT_MARKDOWN_RENDER_POLICY,
): string {
  const escaped = escapeHtml(content);
  const lines = escaped.split('\n');

  const htmlParts: string[] = [];
  let i = 0;
  let paragraphLines: string[] = [];

  function flushParagraph(): void {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join('<br>');
    const formatted = formatInline(text);
    htmlParts.push(`<p>${formatted}</p>`);
    paragraphLines = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;

    // ---- Code fence ----
    const codeFenceMatch = line.match(/^```([\w-]*)$/);
    if (codeFenceMatch !== null) {
      flushParagraph();
      const lang = codeFenceMatch[1] ?? '';
      const codeLines: string[] = [];
      i++;
      let codeLine = lines[i];
      while (
        i < lines.length &&
        codeLine !== undefined &&
        codeLine.match(/^```$/) === null
      ) {
        codeLines.push(codeLine);
        i++;
        codeLine = lines[i];
      }
      i++; // skip closing fence (or move past end)
      const code = codeLines.join('\n');
      const langClass = lang ? ` lang-${escapeHtml(lang)}` : '';
      const controls = codeBlockControls(lang, policy);
      htmlParts.push(
        `<figure class="rv-md-code-block">${controls}<pre class="rv-md-code${langClass}"><code>${code}</code></pre></figure>`,
      );
      continue;
    }

    // ---- Heading ----
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch !== null) {
      const headingText = headingMatch[2];
      if (headingText !== undefined) {
        flushParagraph();
        const level = headingMatch[1]?.length ?? 1;
        const text = formatInline(headingText);
        htmlParts.push(`<h${level}>${text}</h${level}>`);
        i++;
        continue;
      }
    }

    // ---- Horizontal rule ----
    if (isHorizontalRule(line, policy)) {
      flushParagraph();
      htmlParts.push('<hr>');
      i++;
      continue;
    }

    // ---- Blockquote ----
    // Content is already HTML-escaped, so '>' is '&gt;' at this point.
    const quoteMatch = line.match(/^&gt;\s?(.*)$/);
    if (quoteMatch !== null && quoteMatch[1] !== undefined) {
      flushParagraph();
      const quoteLines: string[] = [];
      let qLine = lines[i];
      while (i < lines.length && qLine !== undefined) {
        const qm = qLine.match(/^&gt;\s?(.*)$/);
        if (qm === null || qm[1] === undefined) break;
        quoteLines.push(qm[1]);
        i++;
        qLine = lines[i];
      }
      const text = formatInline(quoteLines.join('<br>'));
      htmlParts.push(`<blockquote>${text}</blockquote>`);
      continue;
    }

    // ---- Unordered list ----
    if (line.match(/^\s*[-*+]\s+/)) {
      flushParagraph();
      const items: string[] = [];
      let liLine = lines[i];
      while (
        i < lines.length &&
        liLine !== undefined &&
        liLine.match(/^\s*[-*+]\s+/)
      ) {
        const item = liLine.replace(/^\s*[-*+]\s+/, '');
        items.push(`<li>${formatInline(item)}</li>`);
        i++;
        liLine = lines[i];
      }
      htmlParts.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // ---- Ordered list ----
    if (line.match(/^\s*\d+\.\s+/)) {
      flushParagraph();
      const items: string[] = [];
      let liLine = lines[i];
      while (
        i < lines.length &&
        liLine !== undefined &&
        liLine.match(/^\s*\d+\.\s+/)
      ) {
        const item = liLine.replace(/^\s*\d+\.\s+/, '');
        items.push(`<li>${formatInline(item)}</li>`);
        i++;
        liLine = lines[i];
      }
      htmlParts.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // ---- Table ----
    const separator = lines[i + 1];
    if (
      line.startsWith('|') &&
      separator !== undefined &&
      separator.match(/^\|[\s|-]+\|?\s*$/) !== null
    ) {
      flushParagraph();
      const headerCells = splitTableRow(line);
      i += 2; // skip header + separator
      const bodyRows: string[] = [];
      let tableLine = lines[i];
      while (
        i < lines.length &&
        tableLine !== undefined &&
        tableLine.startsWith('|')
      ) {
        const cells = splitTableRow(tableLine);
        const tds = cells.map((c) => `<td>${formatInline(c)}</td>`).join('');
        bodyRows.push(`<tr>${tds}</tr>`);
        i++;
        tableLine = lines[i];
      }
      const ths = headerCells
        .map((c) => `<th>${formatInline(c)}</th>`)
        .join('');
      htmlParts.push(
        `<table class="rv-md-table"><thead><tr>${ths}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>`,
      );
      continue;
    }

    // ---- Empty line ----
    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }

    // ---- Paragraph ----
    paragraphLines.push(line);
    i++;
  }

  flushParagraph();
  return htmlParts.join('');
}

function codeBlockControls(
  language: string,
  policy: MarkdownRenderPolicy,
): string {
  const showLabel =
    policy.showCodeBlockLanguageLabels && language.trim().length > 0;
  const showCopy = policy.showCodeBlockCopyButtons;
  if (!showLabel && !showCopy) return '';

  const label = showLabel
    ? `<span class="rv-md-code-lang">${escapeHtml(language)}</span>`
    : '<span class="rv-md-code-lang"></span>';
  const copy = showCopy
    ? '<a class="rv-md-code-copy" href="#copy-code" role="button">Copy</a>'
    : '';
  return `<figcaption class="rv-md-code-header">${label}${copy}</figcaption>`;
}

function isHorizontalRule(line: string, policy: MarkdownRenderPolicy): boolean {
  if (line.match(/^(-{3,}|\*{3,})\s*$/)) return true;
  return (
    policy.enableUnderscoreHorizontalRules && line.match(/^_{3,}\s*$/) !== null
  );
}

/** Split a table row into cell contents (without leading/trailing pipes). */
function splitTableRow(line: string): string[] {
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/**
 * Validate a URL for safe use in href attributes.
 *
 * Only allows http(s), mailto, and relative URLs. Rejects javascript:,
 * data:, and other dangerous protocols. Returns the URL if safe, null if not.
 */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  // Relative URLs are safe.
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed;
  }
  // Allow only http, https, mailto protocols.
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/** Format inline markdown: links, bold, italic, inline code, strikethrough. */
function formatInline(text: string): string {
  return (
    text
      // Inline code first (prevent formatting inside code spans).
      .replaceAll(/`([^`]+)`/g, '<code>$1</code>')
      // Links [text](url) — URL validated for safe protocol.
      .replaceAll(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (match, linkText: string, url: string) => {
          const safe = safeUrl(url);
          if (safe === null) return match; // render as plain text if unsafe
          return `<a href="${safe}" rel="noopener noreferrer">${linkText}</a>`;
        },
      )
      // Bold
      .replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replaceAll(/\*([^*]+)\*/g, '<em>$1</em>')
      // Strikethrough
      .replaceAll(/~~([^~]+)~~/g, '<del>$1</del>')
  );
}

/**
 * Pretty-print + syntax-highlight JSON. Produces HTML with spans for keys,
 * strings, numbers, booleans, and null. Escapes all values.
 */
function highlightJson(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return `<pre class="rv-json-error">${escapeHtml(content)}</pre>`;
  }

  const pretty = JSON.stringify(parsed, null, 2);
  return pretty
    .replaceAll(
      /("(?:[^"\\]|\\.)*")(\s*:)/g,
      '<span class="rv-json-key">$1</span>$2',
    )
    .replaceAll(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="rv-json-string">$1</span>',
    )
    .replaceAll(/:\s*(true|false)/g, ': <span class="rv-json-bool">$1</span>')
    .replaceAll(/:\s*(null)/g, ': <span class="rv-json-null">$1</span>')
    .replaceAll(
      /:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
      ': <span class="rv-json-number">$1</span>',
    );
}

/**
 * Syntax-highlight code. Currently wraps in a <pre><code> with a language class.
 * A full highlighter (Shiki, highlight.js) can be added in the worker later.
 */
function highlightCode(content: string, language: string): string {
  const escaped = escapeHtml(content);
  const langClass = language ? ` class="lang-${escapeHtml(language)}"` : '';
  return `<pre class="rv-code"${langClass}><code>${escaped}</code></pre>`;
}

/**
 * Sanitize raw HTML content for safe rendering.
 *
 * Pre-pass stripper that removes disallowed tags, event handler attributes,
 * style attributes, and dangerous URLs. The result is intended to be bound
 * via Angular's `[innerHTML]` which provides a second sanitization layer.
 *
 * This is a regex-based approach — not a full HTML parser — but it is safe
 * because:
 * 1. Disallowed tags are stripped entirely (including their content for
 *    script/iframe/style/etc.).
 * 2. All `on*` attributes are removed.
 * 3. `style` attributes are removed.
 * 4. URLs in href/src are protocol-validated.
 * 5. Angular's `[innerHTML]` sanitizer is the final defense.
 */
function sanitizeHtml(content: string, policy: HtmlSanitizerPolicy): string {
  const allowedTags = new Set(policy.allowedTags);
  const allowedAttrs = new Set(policy.allowedAttrs);

  // Tags whose content must be stripped entirely (not just the tag itself).
  const stripContentTags = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'noscript',
    'template',
    'form',
    'input',
    'button',
    'select',
    'option',
    'textarea',
    'link',
    'meta',
    'base',
    'title',
    'head',
  ]);

  let result = content;

  // 1. Strip dangerous tags and their content entirely.
  for (const tag of stripContentTags) {
    const openRegex = new RegExp(`<${tag}[^>]*>[^]*?</${tag}>`, 'gi');
    result = result.replaceAll(openRegex, '');
    // Also remove self-closing/standalone occurrences.
    const selfRegex = new RegExp(`<${tag}[^>]*/?>`, 'gi');
    result = result.replaceAll(selfRegex, '');
  }

  // 2. Remove HTML comments (may contain conditional IE comments).
  result = result.replaceAll(/<!--[^]*?-->/g, '');

  // 3. Process remaining tags: strip disallowed tags and attributes.
  const tagRegex = /<(\/?)(\w+)((?:[^>]*?))>/g;
  result = result.replaceAll(
    tagRegex,
    (_match, closing: string, tagName: string, attrs: string) => {
      const tag = tagName.toLowerCase();

      // If tag is not in the allowed list, strip the tag but keep content.
      if (!allowedTags.has(tag)) {
        return '';
      }

      // Process attributes for opening tags.
      if (closing === '/') {
        return `</${tag}>`;
      }

      // Sanitize attributes.
      const sanitizedAttrs = sanitizeAttributes(attrs, allowedAttrs, policy);
      return `<${tag}${sanitizedAttrs}>`;
    },
  );

  return result;
}

/** Sanitize a tag's attribute string: strip disallowed attrs and validate URLs. */
function sanitizeAttributes(
  attrs: string,
  allowedAttrs: Set<string>,
  policy: HtmlSanitizerPolicy,
): string {
  const kept: string[] = [];

  // Match attribute name="value" or name='value' or name=value or name
  const attrRegex =
    /([a-zA-Z-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrs)) !== null) {
    const attrName = match[1]?.toLowerCase();
    if (attrName === undefined) continue;

    // Strip all event handler attributes (on*).
    if (attrName.startsWith('on')) continue;

    // Strip style attributes.
    if (attrName === 'style') continue;

    // Check if attribute is allowed.
    if (!allowedAttrs.has(attrName)) continue;

    const value = match[2] ?? match[3] ?? match[4] ?? '';

    // Validate URLs in href and src.
    if (attrName === 'href' || attrName === 'src') {
      const safeUrl = policy.validateUrl(value);
      if (safeUrl === null) continue;
      kept.push(`${attrName}="${safeUrl}"`);
    } else {
      kept.push(`${attrName}="${value}"`);
    }
  }

  return kept.length > 0 ? ' ' + kept.join(' ') : '';
}

/**
 * Process a worker request inline (main thread). Returns the response.
 */
export function processRequestInline(request: WorkerRequest): WorkerResponse {
  try {
    switch (request.kind) {
      case 'parse-markdown':
        return {
          kind: 'parse-markdown',
          id: request.id,
          html: parseMarkdown(request.content, request.policy),
        };
      case 'sanitize-html':
        return {
          kind: 'sanitize-html',
          id: request.id,
          html: sanitizeHtml(request.content, DEFAULT_HTML_SANITIZER_POLICY),
        };
      case 'highlight-json':
        return {
          kind: 'highlight-json',
          id: request.id,
          html: highlightJson(request.content),
        };
      case 'highlight-code':
        return {
          kind: 'highlight-code',
          id: request.id,
          html: highlightCode(request.content, request.language),
        };
    }
  } catch (error) {
    return {
      kind: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

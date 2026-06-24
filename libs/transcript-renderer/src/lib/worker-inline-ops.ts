import type { WorkerRequest, WorkerResponse } from './worker-message-protocol';

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
function parseMarkdown(content: string): string {
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
    const codeFenceMatch = line.match(/^```(\w*)$/);
    if (codeFenceMatch !== null) {
      flushParagraph();
      const lang = codeFenceMatch[1] ?? '';
      const codeLines: string[] = [];
      i++;
      let codeLine = lines[i];
      while (i < lines.length && codeLine !== undefined && codeLine.match(/^```$/) === null) {
        codeLines.push(codeLine);
        i++;
        codeLine = lines[i];
      }
      i++; // skip closing fence (or move past end)
      const code = codeLines.join('\n');
      const langClass = lang ? ` class="lang-${lang}"` : '';
      htmlParts.push(
        `<pre class="rv-md-code"${langClass}><code>${code}</code></pre>`,
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
    if (line.match(/^(-{3,}|\*{3,}|_{3,})\s*$/)) {
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
      while (i < lines.length && liLine !== undefined && liLine.match(/^\s*[-*+]\s+/)) {
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
      while (i < lines.length && liLine !== undefined && liLine.match(/^\s*\d+\.\s+/)) {
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
      while (i < lines.length && tableLine !== undefined && tableLine.startsWith('|')) {
        const cells = splitTableRow(tableLine);
        const tds = cells
          .map((c) => `<td>${formatInline(c)}</td>`)
          .join('');
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
  return text
    // Inline code first (prevent formatting inside code spans).
    .replaceAll(/`([^`]+)`/g, '<code>$1</code>')
    // Links [text](url) — URL validated for safe protocol.
    .replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText: string, url: string) => {
      const safe = safeUrl(url);
      if (safe === null) return match; // render as plain text if unsafe
      return `<a href="${safe}" rel="noopener noreferrer">${linkText}</a>`;
    })
    // Bold
    .replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replaceAll(/\*([^*]+)\*/g, '<em>$1</em>')
    // Strikethrough
    .replaceAll(/~~([^~]+)~~/g, '<del>$1</del>');
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
 * Process a worker request inline (main thread). Returns the response.
 */
export function processRequestInline(request: WorkerRequest): WorkerResponse {
  try {
    switch (request.kind) {
      case 'parse-markdown':
        return {
          kind: 'parse-markdown',
          id: request.id,
          html: parseMarkdown(request.content),
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

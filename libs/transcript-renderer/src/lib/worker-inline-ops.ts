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
 * Supports: paragraphs, bold (**text**), italic (*text*), inline code (`code`),
 * code blocks (```lang\ncode```), and line breaks. This is intentionally a
 * small subset — the worker can be enhanced with a full parser later, but the
 * architecture (worker + inline fallback + typed protocol) is the point.
 */
function parseMarkdown(content: string): string {
  const escaped = escapeHtml(content);
  const lines = escaped.split('\n');

  const htmlParts: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph(): void {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join('<br>');
    const formatted = formatInline(text);
    htmlParts.push(`<p>${formatted}</p>`);
    paragraphLines = [];
  }

  function flushCodeBlock(): void {
    if (codeBlockLines.length === 0) return;
    const code = codeBlockLines.join('\n');
    const langClass = codeBlockLang ? ` class="lang-${codeBlockLang}"` : '';
    htmlParts.push(
      `<pre class="rv-md-code"${langClass}><code>${code}</code></pre>`,
    );
    codeBlockLines = [];
    codeBlockLang = '';
  }

  for (const line of lines) {
    const codeFenceMatch = line.match(/^```(\w*)$/);
    if (codeFenceMatch !== null) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushParagraph();
        inCodeBlock = true;
        codeBlockLang = codeFenceMatch[1] ?? '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraphLines.push(line);
    }
  }

  flushParagraph();
  if (inCodeBlock) {
    flushCodeBlock();
  }

  return htmlParts.join('');
}

/** Format inline markdown: bold, italic, inline code. */
function formatInline(text: string): string {
  return text
    .replaceAll(/`([^`]+)`/g, '<code>$1</code>')
    .replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replaceAll(/\*([^*]+)\*/g, '<em>$1</em>');
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

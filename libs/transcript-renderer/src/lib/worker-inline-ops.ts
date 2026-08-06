import type { WorkerRequest, WorkerResponse } from './worker-message-protocol';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
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
 * or environments without worker support). Markdown remains deliberately
 * bounded; fenced code uses a registered, worker-safe highlight.js subset.
 * Both paths produce safe HTML via escaping/token markup.
 */

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
};

/** Escape HTML special characters to prevent injection. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Reverse only the exact entity set emitted by {@link escapeHtml}. */
function unescapeHtml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

interface OrderedListItemMatch {
  readonly indent: number;
  readonly number: string;
  readonly content: string;
}

/** Match one ordered-list marker while retaining its indentation and number. */
function matchOrderedListItem(line: string): OrderedListItemMatch | null {
  const match = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (match === null) return null;

  const indentation = match[1] ?? '';
  return {
    indent: indentation.replaceAll('\t', '    ').length,
    number: match[2] ?? '1',
    content: match[3] ?? '',
  };
}

/**
 * Minimal markdown → HTML conversion.
 *
 * Supports: paragraphs, headings (H1-H6), bold (**text**), italic (*text*),
 * inline code (`code`), code blocks (```lang\ncode```), unordered/ordered
 * lists, links [text](url), blockquotes (>), horizontal rules (---), tables,
 * and line breaks. Ordered lists retain blank-line-separated items, nested
 * ordered lists, and non-default starting numbers.
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

  function renderOrderedList(startIndex: number): {
    readonly html: string;
    readonly nextIndex: number;
  } {
    const firstItem = matchOrderedListItem(lines[startIndex] ?? '');
    if (firstItem === null) {
      return { html: '', nextIndex: startIndex };
    }

    const baseIndent = firstItem.indent;
    const startNumber = Number.parseInt(firstItem.number, 10);
    const startAttribute =
      startNumber === 1 ? '' : ` start="${firstItem.number}"`;
    const items: string[] = [];
    let index = startIndex;

    while (index < lines.length) {
      const item = matchOrderedListItem(lines[index] ?? '');
      if (item === null || item.indent !== baseIndent) break;

      let itemHtml = formatInline(item.content);
      index++;

      // A deeper ordered marker belongs to the current item. Rendering it
      // recursively gives each nested list its own numbering sequence.
      while (index < lines.length) {
        const nextLine = lines[index] ?? '';
        const nestedItem = matchOrderedListItem(nextLine);
        if (nestedItem !== null && nestedItem.indent > baseIndent) {
          const nestedList = renderOrderedList(index);
          if (nestedList.nextIndex === index) break;
          itemHtml += nestedList.html;
          index = nestedList.nextIndex;
          continue;
        }

        if (nextLine.trim() === '') {
          // Blank lines are part of this list only when the next non-blank
          // line is another item at this level or a nested item. Leaving
          // unrelated blank lines untouched preserves paragraph boundaries.
          let lookahead = index + 1;
          while (
            lookahead < lines.length &&
            (lines[lookahead] ?? '').trim() === ''
          ) {
            lookahead++;
          }
          const afterBlank = matchOrderedListItem(lines[lookahead] ?? '');
          if (afterBlank !== null && afterBlank.indent >= baseIndent) {
            index = lookahead;
            if (afterBlank.indent > baseIndent) continue;
          }
        }

        // A same-level marker starts the next item. A shallower marker or a
        // non-list line ends this list and is handled by the outer parser.
        const nextItem = matchOrderedListItem(nextLine);
        if (nextItem === null || nextItem.indent <= baseIndent) break;
        break;
      }

      items.push(`<li>${itemHtml}</li>`);
    }

    return {
      html: `<ol${startAttribute}>${items.join('')}</ol>`,
      nextIndex: index,
    };
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
      const code = unescapeHtml(codeLines.join('\n'));
      const langClass = lang ? ` lang-${escapeHtml(lang)}` : '';
      const controls = codeBlockControls(lang, policy);
      const highlighted = highlightCodeBody(code, lang);
      htmlParts.push(
        `<figure class="rv-md-code-block">${controls}<pre class="rv-md-code${langClass}"><code class="hljs">${highlighted}</code></pre></figure>`,
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
    if (matchOrderedListItem(line) !== null) {
      flushParagraph();
      const orderedList = renderOrderedList(i);
      htmlParts.push(orderedList.html);
      i = orderedList.nextIndex;
      continue;
    }

    // ---- Table ----
    const separator = lines[i + 1];
    const headerCells = splitTableRow(line);
    const alignments =
      separator === undefined || headerCells === null
        ? null
        : parseTableAlignments(separator, headerCells.length);
    if (headerCells !== null && alignments !== null) {
      flushParagraph();
      i += 2; // skip header + separator
      const bodyRows: string[] = [];
      let tableLine = lines[i];
      while (i < lines.length && tableLine !== undefined) {
        const cells = splitTableRow(tableLine);
        if (cells === null) break;
        const tds = headerCells
          .map((_, columnIndex) =>
            tableCell('td', cells[columnIndex] ?? '', alignments[columnIndex]),
          )
          .join('');
        bodyRows.push(`<tr>${tds}</tr>`);
        i++;
        tableLine = lines[i];
      }
      const ths = headerCells
        .map((cell, columnIndex) =>
          tableCell('th', cell, alignments[columnIndex]),
        )
        .join('');
      htmlParts.push(
        `<div class="rv-md-table-scroll"><table class="rv-md-table"><thead><tr>${ths}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></div>`,
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

type TableAlignment = 'left' | 'center' | 'right' | undefined;

/**
 * Split a GFM table row without treating escaped pipes or pipes inside inline
 * code as column boundaries. Outer pipes are optional, but at least one real
 * pipe must be present so ordinary prose cannot become a one-column table.
 */
function splitTableRow(line: string): string[] | null {
  let source = line.trim();
  let sawPipe = false;

  if (source.startsWith('|')) {
    source = source.slice(1);
    sawPipe = true;
  }
  if (source.endsWith('|') && !isEscapedAt(source, source.length - 1)) {
    source = source.slice(0, -1);
    sawPipe = true;
  }

  const cells: string[] = [];
  let cell = '';
  let codeDelimiterLength = 0;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === undefined) continue;

    if (character === '\\' && source[index + 1] === '|') {
      cell += '|';
      index++;
      continue;
    }

    if (character === '`') {
      let runLength = 1;
      while (source[index + runLength] === '`') runLength++;
      if (codeDelimiterLength === 0) codeDelimiterLength = runLength;
      else if (codeDelimiterLength === runLength) codeDelimiterLength = 0;
      cell += '`'.repeat(runLength);
      index += runLength - 1;
      continue;
    }

    if (character === '|' && codeDelimiterLength === 0) {
      cells.push(cell.trim());
      cell = '';
      sawPipe = true;
      continue;
    }

    cell += character;
  }

  if (!sawPipe) return null;
  cells.push(cell.trim());
  return cells;
}

function isEscapedAt(value: string, index: number): boolean {
  let precedingBackslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === '\\';
    cursor--
  ) {
    precedingBackslashes++;
  }
  return precedingBackslashes % 2 === 1;
}

/** Parse and validate a GFM delimiter row, including alignment markers. */
function parseTableAlignments(
  line: string,
  columnCount: number,
): TableAlignment[] | null {
  const cells = splitTableRow(line);
  if (cells === null || cells.length !== columnCount) return null;

  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    const delimiter = cell.trim();
    if (!/^:?-{3,}:?$/.test(delimiter)) return null;
    if (delimiter.startsWith(':') && delimiter.endsWith(':')) {
      alignments.push('center');
    } else if (delimiter.endsWith(':')) {
      alignments.push('right');
    } else if (delimiter.startsWith(':')) {
      alignments.push('left');
    } else {
      alignments.push(undefined);
    }
  }
  return alignments;
}

function tableCell(
  tag: 'th' | 'td',
  content: string,
  alignment: TableAlignment,
): string {
  const className = alignment ? ` class="rv-md-align-${alignment}"` : '';
  return `<${tag}${className}>${formatInline(content)}</${tag}>`;
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
          return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
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
 * Syntax-highlight code using the registered language subset. Unknown or empty
 * language names deliberately fall back to escaped plain code; there is no
 * potentially misleading auto-detection.
 */
function highlightCode(content: string, language: string): string {
  const langClass = language ? ` lang-${escapeHtml(language)}` : '';
  return `<pre class="rv-code${langClass}"><code class="hljs">${highlightCodeBody(content, language)}</code></pre>`;
}

function highlightCodeBody(content: string, language: string): string {
  const normalized = language.trim().toLowerCase();
  const resolved = LANGUAGE_ALIASES[normalized] ?? normalized;
  if (resolved === '' || hljs.getLanguage(resolved) === undefined) {
    return escapeHtml(content);
  }
  return hljs.highlight(content, {
    language: resolved,
    ignoreIllegals: true,
  }).value;
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
      const sanitizedAttrs = sanitizeAttributes(
        attrs,
        allowedAttrs,
        policy,
        tag,
      );
      const fixedLinkAttrs =
        tag === 'a' && sanitizedAttrs.includes(' href="')
          ? ' target="_blank" rel="noopener noreferrer"'
          : '';
      return `<${tag}${sanitizedAttrs}${fixedLinkAttrs}>`;
    },
  );

  return result;
}

/** Sanitize a tag's attribute string: strip disallowed attrs and validate URLs. */
function sanitizeAttributes(
  attrs: string,
  allowedAttrs: Set<string>,
  policy: HtmlSanitizerPolicy,
  tagName: string,
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

    // Transcript links always open outside the app shell. Ignore author-supplied
    // target/rel values so sanitizeHtml can append one fixed isolated policy.
    if (tagName === 'a' && (attrName === 'target' || attrName === 'rel')) {
      continue;
    }

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

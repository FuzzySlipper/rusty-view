import { describe, expect, it } from 'vitest';

import { processRequestInline } from './worker-inline-ops';

describe('processRequestInline (inline worker fallback)', () => {
  describe('parse-markdown', () => {
    it('wraps plain text in <p> tags', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 1,
        content: 'Hello world',
      });
      expect(response.kind).toBe('parse-markdown');
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<p>Hello world</p>');
      }
    });

    it('formats bold and italic inline', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 2,
        content: '**bold** and *italic*',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<strong>bold</strong>');
        expect(response.html).toContain('<em>italic</em>');
      }
    });

    it('formats inline code', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 3,
        content: 'Use `fetch()` for HTTP',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<code>fetch()</code>');
      }
    });

    it('renders code blocks', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 4,
        content: '```ts\nconst x = 1;\n```',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<pre class="rv-md-code');
        expect(response.html).toContain('lang-ts');
        expect(response.html).toContain('<code class="hljs">');
        expect(response.html).toContain(
          '<span class="hljs-keyword">const</span>',
        );
        expect(response.html).toContain('<span class="hljs-number">1</span>');
        expect(response.html).toContain('rv-md-code-header');
        expect(response.html).toContain('rv-md-code-copy');
        expect(response.html).toContain('ts');
      }
    });

    it('can disable code block labels and copy controls', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 41,
        content: '```ts\nconst x = 1;\n```',
        policy: {
          literalExclusions: [],
          enableUnderscoreHorizontalRules: false,
          showCodeBlockLanguageLabels: false,
          showCodeBlockCopyButtons: false,
        },
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).not.toContain('rv-md-code-header');
        expect(response.html).not.toContain('rv-md-code-copy');
        expect(response.html).toContain('<pre class="rv-md-code lang-ts"');
      }
    });

    it('escapes HTML to prevent injection', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 5,
        content: '<script>alert("xss")</script>',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).not.toContain('<script>');
        expect(response.html).toContain('&lt;script&gt;');
      }
    });

    it('keeps fenced highlighted code inert and preserves literal entities', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 51,
        content:
          '```html\n<script>alert("xss")</script>\nconst entity = "&lt;";\n```',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).not.toContain('<script>');
        expect(response.html).toContain('&lt;');
        expect(response.html).toContain('&amp;lt;');
        expect(response.html).toContain('hljs-tag');
      }
    });

    it('renders unknown fenced languages as escaped plain code', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 52,
        content: '```future-lang\nconst value = "<unsafe>";\n```',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('lang-future-lang');
        expect(response.html).toContain('&lt;unsafe&gt;');
        expect(response.html).not.toContain('hljs-keyword');
      }
    });

    it('handles multiple paragraphs separated by blank lines', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 6,
        content: 'First paragraph.\n\nSecond paragraph.',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<p>First paragraph.</p>');
        expect(response.html).toContain('<p>Second paragraph.</p>');
      }
    });

    // ---- Enhanced markdown features ----

    it('renders headings H1-H3', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 7,
        content: '# Heading 1\n## Heading 2\n### Heading 3',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<h1>Heading 1</h1>');
        expect(response.html).toContain('<h2>Heading 2</h2>');
        expect(response.html).toContain('<h3>Heading 3</h3>');
      }
    });

    it('renders unordered lists', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 8,
        content: '- item one\n- item two\n- item three',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<ul>');
        expect(response.html).toContain('<li>item one</li>');
        expect(response.html).toContain('<li>item two</li>');
        expect(response.html).toContain('<li>item three</li>');
        expect(response.html).toContain('</ul>');
      }
    });

    it('renders ordered lists', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 9,
        content: '1. first\n2. second\n3. third',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<ol>');
        expect(response.html).toContain('<li>first</li>');
        expect(response.html).toContain('<li>second</li>');
        expect(response.html).toContain('<li>third</li>');
        expect(response.html).toContain('</ol>');
      }
    });

    it('keeps blank-line-separated ordered items in one list', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 91,
        content: '1. first\n\n2. second\n\n3. third',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toBe(
          '<ol><li>first</li><li>second</li><li>third</li></ol>',
        );
      }
    });

    it('preserves ordered-list start values and nested numbering', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 92,
        content: [
          '3. outer item',
          '   2. nested item two',
          '   3. nested item three',
          '4. next outer item',
        ].join('\n'),
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toBe(
          '<ol start="3"><li>outer item<ol start="2"><li>nested item two</li><li>nested item three</li></ol></li><li>next outer item</li></ol>',
        );
      }
    });

    it('renders safe links in an isolated new window', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 10,
        content: '[click here](https://example.com)',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain(
          '<a href="https://example.com" target="_blank" rel="noopener noreferrer">click here</a>',
        );
      }
    });

    it('renders relative links', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 11,
        content: '[home](/index.html)',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('href="/index.html"');
      }
    });

    it('blocks javascript: protocol in links', () => {
      // The dangerous URL must NOT appear inside an href attribute. As escaped
      // plain text inside a <p> it is harmless — the test checks the safety
      // property (no <a> tag), not the mere presence of the text.
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 12,
        content: '[click](javascript:alert(1))',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).not.toContain('<a ');
        expect(response.html).not.toContain('href=');
        // Should be rendered as escaped plain text.
        expect(response.html).toContain('alert(1)');
      }
    });

    it('blocks data: protocol in links', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 13,
        content: '[img](data:text/html,<script>alert(1)</script>)',
      });
      if (response.kind === 'parse-markdown') {
        // No <a> tag should be emitted for dangerous protocols.
        expect(response.html).not.toContain('<a ');
        expect(response.html).not.toContain('href=');
        // HTML in the URL text must be escaped (no live <script> in output).
        expect(response.html).not.toContain('<script>');
      }
    });

    it('renders blockquotes', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 14,
        content: '> A quoted line\n> Another quoted line',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<blockquote>');
        expect(response.html).toContain('A quoted line');
        expect(response.html).toContain('Another quoted line');
        expect(response.html).toContain('</blockquote>');
      }
    });

    it('renders horizontal rules', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 15,
        content: 'above\n\n---\n\nbelow',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<hr>');
      }
    });

    it('does not treat underscore-only lines as horizontal rules by default', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 151,
        content: 'above\n\n___\n\nbelow',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).not.toContain('<hr>');
        expect(response.html).toContain('___');
      }
    });

    it('can enable underscore horizontal rules through policy', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 152,
        content: 'above\n\n___\n\nbelow',
        policy: {
          literalExclusions: [],
          enableUnderscoreHorizontalRules: true,
          showCodeBlockLanguageLabels: true,
          showCodeBlockCopyButtons: true,
        },
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<hr>');
      }
    });

    it('renders semantic GFM tables with declared column alignment', () => {
      const table = [
        '| Concern | Stable semantic authority | Variable product composition |',
        '|---|---:|---:|',
        '| Capability state and mutation | Rust | Never TS |',
        '| Rule semantics and appliers | Rust | TS selects/configures |',
        '| Intent validation | Rust | TS constructs intents |',
        '| Formula/predicate meaning | Rust | TS composes typed ASTs |',
        '| Runtime scheduling/timing | Rust | TS chooses declared modes |',
        '| Content and project assembly | Rust validates | TS authors |',
        '| Policy | Rust bounds | TS proposes |',
        '| Workflow and UI | Rust exposes facts | TS orchestrates/presents |',
        '| Proof and certification | Owners expose invariants | External consumers compose evidence |',
      ].join('\n');
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 16,
        content: table,
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<div class="rv-md-table-scroll">');
        expect(response.html).toContain('<table class="rv-md-table">');
        expect(response.html).toContain('<thead>');
        expect(response.html).toContain('<th>Concern</th>');
        expect(response.html).toContain(
          '<th class="rv-md-align-right">Stable semantic authority</th>',
        );
        expect(response.html).toContain(
          '<th class="rv-md-align-right">Variable product composition</th>',
        );
        expect(response.html).toContain('<tbody>');
        expect(response.html).toContain(
          '<td class="rv-md-align-right">Owners expose invariants</td>',
        );
        expect(response.html).toContain(
          '<td class="rv-md-align-right">External consumers compose evidence</td>',
        );
        expect(response.html.match(/<tr>/g)).toHaveLength(10);
        expect(response.html).toContain('</tbody></table></div>');
      }
    });

    it('supports outer-pipe-free tables and left/center alignment', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 161,
        content: 'Left | Center\n:--- | :---:\none | two',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<table class="rv-md-table">');
        expect(response.html).toContain(
          '<th class="rv-md-align-left">Left</th>',
        );
        expect(response.html).toContain(
          '<th class="rv-md-align-center">Center</th>',
        );
        expect(response.html).toContain(
          '<td class="rv-md-align-center">two</td>',
        );
      }
    });

    it('does not interpret table syntax inside fenced or inline code as a table', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 162,
        content:
          '```markdown\n| Header | Value |\n|---|---:|\n| Safe | Code |\n```\n\n`| Header | Value |`\n|---|---|',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<pre class="rv-md-code');
        expect(response.html).toContain('<code>| Header | Value |</code>');
        expect(response.html).not.toContain('<table');
      }
    });

    it('renders strikethrough', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 17,
        content: '~~deleted~~ text',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<del>deleted</del>');
      }
    });

    it('handles malformed markdown without crashing', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 18,
        content:
          '##\n\n**bold without close\n| broken table\n```\nunclosed code',
      });
      expect(response.kind).toBe('parse-markdown');
      if (response.kind === 'parse-markdown') {
        // Should produce some output, not crash.
        expect(response.html.length).toBeGreaterThan(0);
        // Unclosed code block should still render.
        expect(response.html).toContain('<pre');
      }
    });

    it('escapes HTML inside headings and lists', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 19,
        content: '# <b>not a real bold</b>\n- <script>alert(1)</script>',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).not.toContain('<b>');
        expect(response.html).not.toContain('<script>');
        expect(response.html).toContain('&lt;b&gt;');
        expect(response.html).toContain('&lt;script&gt;');
      }
    });

    it('combines inline formatting in list items', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 20,
        content: '- **bold item**\n- *italic item*\n- `code item`',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<li><strong>bold item</strong></li>');
        expect(response.html).toContain('<li><em>italic item</em></li>');
        expect(response.html).toContain('<li><code>code item</code></li>');
      }
    });
  });

  describe('highlight-json', () => {
    it('pretty-prints valid JSON with syntax spans', () => {
      const response = processRequestInline({
        kind: 'highlight-json',
        id: 10,
        content: '{"name":"test","count":42,"active":true,"data":null}',
      });
      if (response.kind === 'highlight-json') {
        expect(response.html).toContain('rv-json-key');
        expect(response.html).toContain('rv-json-string');
        expect(response.html).toContain('rv-json-bool');
        expect(response.html).toContain('rv-json-null');
        expect(response.html).toContain('rv-json-number');
      }
    });

    it('shows raw content for invalid JSON', () => {
      const response = processRequestInline({
        kind: 'highlight-json',
        id: 11,
        content: 'not valid json {{{',
      });
      if (response.kind === 'highlight-json') {
        expect(response.html).toContain('rv-json-error');
      }
    });
  });

  describe('highlight-code', () => {
    it('wraps code in pre/code with language class', () => {
      const response = processRequestInline({
        kind: 'highlight-code',
        id: 20,
        content: 'const x = 1;',
        language: 'typescript',
      });
      if (response.kind === 'highlight-code') {
        expect(response.html).toContain(
          '<pre class="rv-code lang-typescript">',
        );
        expect(response.html).toContain(
          '<span class="hljs-keyword">const</span>',
        );
        expect(response.html).toContain('<span class="hljs-number">1</span>');
      }
    });

    it('escapes HTML in code content', () => {
      const response = processRequestInline({
        kind: 'highlight-code',
        id: 21,
        content: '<div>html</div>',
        language: 'html',
      });
      if (response.kind === 'highlight-code') {
        expect(response.html).not.toContain('<div>');
        expect(response.html).toContain('&lt;');
        expect(response.html).toContain('&gt;');
        expect(response.html).toContain('hljs-tag');
      }
    });

    it('uses a safe plain fallback for unknown languages', () => {
      const response = processRequestInline({
        kind: 'highlight-code',
        id: 22,
        content: 'const value = "<unsafe>";',
        language: 'future-lang',
      });
      if (response.kind === 'highlight-code') {
        expect(response.html).toContain('&lt;unsafe&gt;');
        expect(response.html).not.toContain('hljs-keyword');
      }
    });
  });

  describe('sanitize-html', () => {
    function sanitize(content: string): string {
      const response = processRequestInline({
        kind: 'sanitize-html',
        id: 0,
        content,
      });
      if (response.kind === 'sanitize-html') return response.html;
      throw new Error(`Unexpected response: ${response.kind}`);
    }

    it('allows basic formatting tags', () => {
      const html = sanitize(
        '<p>Hello <b>bold</b> <i>italic</i> <em>em</em></p>',
      );
      expect(html).toContain('<p>');
      expect(html).toContain('<b>bold</b>');
      expect(html).toContain('<i>italic</i>');
      expect(html).toContain('<em>em</em>');
    });

    it('allows headings', () => {
      const html = sanitize('<h1>Title</h1><h2>Subtitle</h2>');
      expect(html).toContain('<h1>Title</h1>');
      expect(html).toContain('<h2>Subtitle</h2>');
    });

    it('allows links with safe URLs', () => {
      const html = sanitize('<a href="https://example.com">link</a>');
      expect(html).toContain('<a');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('>link</a>');
    });

    it('overrides author-supplied link browsing context and relationship', () => {
      const html = sanitize(
        '<a href="https://example.com" target="_self" rel="opener">link</a>',
      );
      expect(html).toBe(
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>',
      );
    });

    it('allows relative links', () => {
      const html = sanitize('<a href="/page">page</a>');
      expect(html).toContain('href="/page"');
    });

    it('strips script tags entirely', () => {
      const html = sanitize('<p>safe</p><script>alert("xss")</script>');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('alert');
      expect(html).toContain('<p>safe</p>');
    });

    it('strips iframe tags entirely', () => {
      const html = sanitize(
        '<iframe src="https://evil.com"></iframe><p>ok</p>',
      );
      expect(html).not.toContain('<iframe');
      expect(html).toContain('<p>ok</p>');
    });

    it('strips style tags entirely', () => {
      const html = sanitize('<style>body{display:none}</style><p>visible</p>');
      expect(html).not.toContain('<style>');
      expect(html).not.toContain('display:none');
      expect(html).toContain('<p>visible</p>');
    });

    it('strips event handler attributes', () => {
      const html = sanitize('<div onclick="alert(1)">click me</div>');
      expect(html).not.toContain('onclick');
      expect(html).toContain('<div>click me</div>');
    });

    it('strips onerror from img tags', () => {
      const html = sanitize('<img src="x" onerror="alert(1)">');
      expect(html).not.toContain('onerror');
    });

    it('strips style attributes', () => {
      const html = sanitize('<p style="color:red">text</p>');
      expect(html).not.toContain('style=');
      expect(html).toContain('<p>text</p>');
    });

    it('strips dangerous URL protocols in href', () => {
      const html = sanitize('<a href="javascript:alert(1)">click</a>');
      expect(html).not.toContain('javascript:');
      expect(html).toContain('<a>click</a>');
    });

    it('strips data: protocol in src', () => {
      const html = sanitize(
        '<img src="data:text/html,<script>alert(1)</script>">',
      );
      expect(html).not.toContain('data:text/html');
    });

    it('strips form elements entirely', () => {
      const html = sanitize('<form action="/steal"><input type="text"></form>');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<input');
    });

    it('strips HTML comments', () => {
      const html = sanitize('<!-- comment --><p>text</p>');
      expect(html).not.toContain('comment');
      expect(html).toContain('<p>text</p>');
    });

    it('allows tables', () => {
      const html = sanitize(
        '<table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>val</td></tr></tbody></table>',
      );
      expect(html).toContain('<table>');
      expect(html).toContain('<th>Col</th>');
      expect(html).toContain('<td>val</td>');
    });

    it('allows lists', () => {
      const html = sanitize('<ul><li>one</li><li>two</li></ul>');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>one</li>');
    });

    it('handles malformed HTML without crashing', () => {
      const html = sanitize('<p>unclosed <b>bold<p>next<div>broken');
      expect(html.length).toBeGreaterThan(0);
      // Should not throw.
    });

    it('strips unknown tags but keeps their content', () => {
      const html = sanitize('<custom-tag>content</custom-tag>');
      expect(html).not.toContain('<custom-tag>');
      expect(html).toContain('content');
    });
  });
});

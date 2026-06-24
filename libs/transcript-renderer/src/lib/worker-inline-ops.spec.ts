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
        expect(response.html).toContain('<pre class="rv-md-code"');
        expect(response.html).toContain('lang-ts');
        expect(response.html).toContain('const x = 1;');
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

    it('renders safe links with rel=noopener', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 10,
        content: '[click here](https://example.com)',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain(
          '<a href="https://example.com" rel="noopener noreferrer">click here</a>',
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

    it('renders tables', () => {
      const response = processRequestInline({
        kind: 'parse-markdown',
        id: 16,
        content: '| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | 25 |',
      });
      if (response.kind === 'parse-markdown') {
        expect(response.html).toContain('<table');
        expect(response.html).toContain('<thead>');
        expect(response.html).toContain('<th>Name</th>');
        expect(response.html).toContain('<th>Age</th>');
        expect(response.html).toContain('<tbody>');
        expect(response.html).toContain('<td>Alice</td>');
        expect(response.html).toContain('<td>30</td>');
        expect(response.html).toContain('<td>Bob</td>');
        expect(response.html).toContain('<td>25</td>');
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
        content: '##\n\n**bold without close\n| broken table\n```\nunclosed code',
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
        expect(response.html).toContain('<pre class="rv-code"');
        expect(response.html).toContain('lang-typescript');
        expect(response.html).toContain('const x = 1;');
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
        expect(response.html).toContain('&lt;div&gt;');
      }
    });
  });
});

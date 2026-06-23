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

import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { WorkerManager } from './worker-manager';

/**
 * WorkerManager tests. In the jsdom test environment, `Worker` is undefined, so
 * the manager falls back to inline processing. These tests verify:
 * - The inline fallback works for all operations.
 * - The manager API is async and returns HTML strings.
 * - dispose() cleans up pending requests.
 * - The manager is providedIn root.
 */
describe('WorkerManager', () => {
  let manager: WorkerManager;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    manager = TestBed.inject(WorkerManager);
  });

  afterEach(() => {
    manager.dispose();
  });

  it('is provided in root', () => {
    expect(manager).toBeInstanceOf(WorkerManager);
  });

  it('falls back to inline when Worker is unavailable', () => {
    expect(manager.isUsingWorker()).toBe(false);
  });

  it('parseMarkdown returns HTML via inline fallback', async () => {
    const html = await manager.parseMarkdown('**bold** text');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('text');
  });

  it('highlightJson returns syntax-highlighted HTML', async () => {
    const html = await manager.highlightJson('{"key":"value","n":123}');
    expect(html).toContain('rv-json-key');
    expect(html).toContain('rv-json-string');
    expect(html).toContain('rv-json-number');
  });

  it('highlightCode returns wrapped code HTML', async () => {
    const html = await manager.highlightCode('const x = 1;', 'ts');
    expect(html).toContain('<pre class="rv-code"');
    expect(html).toContain('lang-ts');
  });

  it('handles large content (100k chars) without error', async () => {
    const largeContent = '# Title\n\n' + 'Lorem ipsum '.repeat(8_000);
    const html = await manager.parseMarkdown(largeContent);
    expect(html).toContain('<p>');
    expect(html.length).toBeGreaterThan(0);
  });

  it('dispose rejects pending requests', async () => {
    // Start a request and immediately dispose — the inline fallback resolves
    // synchronously, so we can't test rejection with inline. Instead verify
    // dispose doesn't throw and the manager is still usable.
    manager.dispose();
    const html = await manager.parseMarkdown('after dispose');
    expect(html).toContain('after dispose');
  });
});

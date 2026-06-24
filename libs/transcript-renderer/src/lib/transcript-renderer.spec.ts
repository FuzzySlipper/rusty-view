import type { ChatMessage, MessageBlock } from '@rusty-view/chat-domain';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { MessageBlockComponent } from './message-block';
import { MessageItemComponent } from './message-item';
import { TRANSCRIPT_RENDERER_VERSION } from '../index';
import { TRANSCRIPT_TEXT_RENDER_MODE, type TextRenderMode } from './render-mode-token';

function makeBlock(overrides: Partial<MessageBlock>): MessageBlock {
  return {
    id: 'b1',
    messageId: 'm1',
    kind: 'text',
    content: 'hello',
    estimatedHeight: undefined,
    renderPolicy: 'full',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    author: { role: 'user', displayName: undefined },
    createdAt: '2026-06-22T10:00:00Z',
    status: 'completed',
    blocks: [makeBlock({})],
    ...overrides,
  } as ChatMessage;
}

describe('@rusty-view/transcript-renderer package version', () => {
  it('exports a version marker', () => {
    expect(TRANSCRIPT_RENDERER_VERSION).toBe('0.0.0');
  });
});

describe('MessageBlockComponent', () => {
  async function createBlock(block: MessageBlock) {
    await TestBed.configureTestingModule({
      imports: [MessageBlockComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MessageBlockComponent);
    fixture.componentRef.setInput('block', block);
    fixture.detectChanges();
    return fixture;
  }

  it('renders text blocks as full content', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'Hello world' }),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Hello world');
    expect(host.querySelector('.rv-block--text')).not.toBeNull();
  });

  it('renders tool_call blocks as collapsible', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'tool_call',
        content: 'search_lore("amber")',
        renderPolicy: 'collapsed',
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block--collapsible')).not.toBeNull();
    expect(host.textContent).toContain('tool_call');
  });

  it('truncates long collapsible content and expands on click', async () => {
    const longContent = 'x'.repeat(600);
    const fixture = await createBlock(
      makeBlock({
        kind: 'debug',
        content: longContent,
        renderPolicy: 'collapsed',
      }),
    );
    const host: HTMLElement = fixture.nativeElement;

    // Should be truncated initially.
    expect(host.textContent?.length ?? 0).toBeLessThan(longContent.length);

    // Click the expand header.
    const header = host.querySelector('.rv-block__header') as HTMLButtonElement;
    header.click();
    fixture.detectChanges();

    // Should now show full content.
    expect(host.textContent).toContain(longContent);
  });
  it('renders markdown text blocks into a token-bound markdown container', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'Hello **bold** world' }),
    );
    // Markdown parsing is async (worker/inline fallback). Let it resolve.
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const md = host.querySelector('.rv-block__markdown');
    expect(md).not.toBeNull();
    // Inline formatting is applied.
    expect(md?.innerHTML).toContain('<strong>bold</strong>');

    // The markdown container must bind to the appearance tokens (the fix for
    // appearance controls not reaching chat text). Assert via the component's
    // scoped stylesheet that the rule references the tokens.
    const sheet = Array.from(host.ownerDocument.styleSheets)
      .map((s) => {
        try {
          return Array.from(s.cssRules)
            .map((r) => r.cssText)
            .join('\n');
        } catch {
          return '';
        }
      })
      .join('\n');
    expect(sheet).toContain('rv-block__markdown');
    expect(sheet).toContain('var(--rv-color-text-primary)');
    expect(sheet).toContain('var(--rv-font-size-md)');
  });
});

describe('MessageItemComponent', () => {
  async function createMessage(message: ChatMessage) {
    await TestBed.configureTestingModule({
      imports: [MessageItemComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the author label and message content', async () => {
    const fixture = await createMessage(
      makeMessage({
        author: { role: 'assistant', displayName: 'Narrator' },
        blocks: [makeBlock({ content: 'The door creaks.' })],
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Narrator');
    expect(host.textContent).toContain('The door creaks.');
  });

  it('uses role as author label when no display name', async () => {
    const fixture = await createMessage(
      makeMessage({ author: { role: 'user', displayName: undefined } }),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('user');
  });

  it('shows streaming indicator for active messages', async () => {
    const fixture = await createMessage(makeMessage({ status: 'streaming' }));
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('typing');
  });

  it('renders multiple blocks', async () => {
    const fixture = await createMessage(
      makeMessage({
        blocks: [
          makeBlock({ id: 'b1', kind: 'text', content: 'text part' }),
          makeBlock({ id: 'b2', kind: 'tool_call', content: 'tool data' }),
        ],
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('text part');
    expect(host.textContent).toContain('tool data');
  });
});

describe('MessageBlockComponent markdown toggle', () => {
  async function createBlock(
    block: MessageBlock,
    textRenderMode: TextRenderMode = 'markdown',
  ) {
    TestBed.configureTestingModule({
      imports: [MessageBlockComponent],
      providers: [
        {
          provide: TRANSCRIPT_TEXT_RENDER_MODE,
          useValue: signal(textRenderMode),
        },
      ],
    });
    TestBed.flushEffects?.();
    const fixture = TestBed.createComponent(MessageBlockComponent);
    fixture.componentRef.setInput('block', block);
    fixture.detectChanges();
    return fixture;
  }

  it('renders markdown when mode is markdown', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '**bold**' }),
      'markdown',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block__markdown')).not.toBeNull();
    expect(host.innerHTML).toContain('<strong>bold</strong>');
  });

  it('renders raw text when mode is raw', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '**bold**' }),
      'raw',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    // No markdown container — raw text shown.
    expect(host.querySelector('.rv-block__markdown')).toBeNull();
    expect(host.textContent).toContain('**bold**');
    // Raw toggle button should NOT appear when global mode is raw.
    expect(host.querySelector('.rv-block__raw-button')).toBeNull();
  });

  it('toggles individual block to raw via per-block button', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '**bold**' }),
      'markdown',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    // Initially renders markdown.
    expect(host.querySelector('.rv-block__markdown')).not.toBeNull();

    // Click the raw toggle.
    const rawButton = host.querySelector('.rv-block__raw-button') as HTMLButtonElement;
    expect(rawButton).not.toBeNull();
    rawButton.click();
    fixture.detectChanges();

    // Now shows raw text.
    expect(host.querySelector('.rv-block__markdown')).toBeNull();
    expect(host.textContent).toContain('**bold**');
    expect(rawButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles back from raw to formatted', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '**bold**' }),
      'markdown',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const rawButton = host.querySelector('.rv-block__raw-button') as HTMLButtonElement;

    // Toggle to raw.
    rawButton.click();
    fixture.detectChanges();
    expect(host.querySelector('.rv-block__markdown')).toBeNull();

    // Toggle back to markdown.
    rawButton.click();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(host.querySelector('.rv-block__markdown')).not.toBeNull();
  });

  it('sanitized-html mode renders HTML after pre-sanitization', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '<p>Hello <b>world</b></p>' }),
      'sanitized-html',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block__markdown')).not.toBeNull();
    expect(host.innerHTML).toContain('<b>world</b>');
  });

  it('sanitized-html mode strips dangerous content', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '<p>safe</p><script>alert(1)</script>' }),
      'sanitized-html',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.innerHTML).not.toContain('<script>');
    expect(host.textContent).toContain('safe');
  });

  it('raw text is always available and copyable', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'Some text content' }),
      'raw',
    );
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const contentEl = host.querySelector('.rv-block__content');
    expect(contentEl).not.toBeNull();
    expect(contentEl?.textContent).toContain('Some text content');
  });
});

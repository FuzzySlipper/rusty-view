import type { ChatMessage, MessageBlock } from '@rusty-view/chat-domain';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { MessageBlockComponent } from './message-block';
import { MessageItemComponent } from './message-item';
import { TRANSCRIPT_RENDERER_VERSION } from '../index';

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

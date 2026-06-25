import type {
  ChatAttachment,
  ChatMessage,
  MessageBlock,
} from '@rusty-view/chat-domain';
import { TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { MessageBlockComponent } from './message-block';
import { MessageItemComponent } from './message-item';
import { TRANSCRIPT_RENDERER_VERSION } from '../index';
import {
  TRANSCRIPT_MARKDOWN_POLICY,
  TRANSCRIPT_TEXT_RENDER_MODE,
  type TextRenderMode,
} from './render-mode-token';
import {
  CHAT_CONTENT_RENDERERS,
  type ChatContentRenderContext,
} from './content-renderers';

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

function makeAttachment(
  overrides: Partial<ChatAttachment> = {},
): ChatAttachment {
  return {
    id: 'a1',
    kind: 'file',
    name: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 2048,
    url: '/files/notes.txt',
    thumbnailUrl: undefined,
    textPreview: undefined,
    scopeId: undefined,
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

@Component({
  selector: 'rv-test-image-renderer',
  template: `
    <figure class="test-image-renderer">
      <span>{{ block().kind }}</span>
      <figcaption>{{ context().sessionId }}:{{ block().content }}</figcaption>
    </figure>
  `,
})
class TestImageRendererComponent {
  readonly block = input.required<MessageBlock>();
  readonly message = input<ChatMessage | undefined>(undefined);
  readonly context = input.required<ChatContentRenderContext>();
}

describe('@rusty-view/transcript-renderer package version', () => {
  it('exports a version marker', () => {
    expect(TRANSCRIPT_RENDERER_VERSION).toBe('0.0.0');
  });
});

describe('MessageBlockComponent', () => {
  async function createBlock(
    block: MessageBlock,
    providers: Parameters<
      typeof TestBed.configureTestingModule
    >[0]['providers'] = [],
  ) {
    await TestBed.configureTestingModule({
      imports: [MessageBlockComponent],
      providers,
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

  it('marks raw text search matches without using innerHTML', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'Find the brass key.' }),
    );
    fixture.componentRef.setInput('searchQuery', 'brass');
    fixture.componentRef.setInput('searchMatched', true);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const mark = host.querySelector('.rv-block__search-mark');
    expect(host.querySelector('.rv-block--search-match')).not.toBeNull();
    expect(mark?.textContent).toBe('brass');
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

  it('bypasses markdown for configured literal exclusions', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '== literal separator ==' }),
      [
        {
          provide: TRANSCRIPT_MARKDOWN_POLICY,
          useValue: {
            literalExclusions: [
              { value: '== literal separator ==', match: 'line' },
            ],
            enableUnderscoreHorizontalRules: false,
            showCodeBlockLanguageLabels: true,
            showCodeBlockCopyButtons: true,
          },
        },
      ],
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block__markdown')).toBeNull();
    expect(host.textContent).toContain('== literal separator ==');
  });

  it('copies generated markdown code blocks through delegated controls', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '```ts\nconst x = 1;\n```' }),
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const button = host.querySelector('.rv-md-code-copy') as HTMLElement | null;
    expect(button).not.toBeNull();
    button?.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('const x = 1;');
  });

  it('renders custom block types with a registered content renderer', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'image', content: '/files/image.png' }),
      [
        {
          provide: CHAT_CONTENT_RENDERERS,
          useValue: [{ type: 'image', component: TestImageRendererComponent }],
        },
      ],
    );
    fixture.componentRef.setInput(
      'message',
      makeMessage({ id: 'm1', sessionId: 's-custom' }),
    );
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.test-image-renderer')).not.toBeNull();
    expect(host.textContent).toContain('image');
    expect(host.textContent).toContain('s-custom:/files/image.png');
    expect(host.querySelector('.rv-block--collapsible')).toBeNull();
  });

  it('falls back to the generic collapsible renderer for unknown block types', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'future_block', content: 'opaque payload' }),
    );

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block--collapsible')).not.toBeNull();
    expect(host.textContent).toContain('future_block');
    expect(host.textContent).toContain('opaque payload');
  });

  it('renders image attachments with thumbnail fallback', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'attachment',
        content: '',
        attachment: makeAttachment({
          kind: 'image',
          name: 'frame.png',
          mimeType: 'image/png',
          url: '/files/frame.png',
          thumbnailUrl: '/thumbs/frame.png',
        }),
      }),
    );

    const host: HTMLElement = fixture.nativeElement;
    const image = host.querySelector(
      '.rv-attachment__image',
    ) as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(image.getAttribute('src')).toBe('/thumbs/frame.png');
    expect(image.getAttribute('alt')).toBe('frame.png');
  });

  it('renders audio attachments with native controls', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'attachment',
        content: '',
        attachment: makeAttachment({
          kind: 'audio',
          name: 'voice.mp3',
          mimeType: 'audio/mpeg',
          url: '/files/voice.mp3',
        }),
      }),
    );

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('audio')?.getAttribute('src')).toBe(
      '/files/voice.mp3',
    );
  });

  it('renders video attachments with native controls and poster', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'attachment',
        content: '',
        attachment: makeAttachment({
          kind: 'video',
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          url: '/files/clip.mp4',
          thumbnailUrl: '/thumbs/clip.jpg',
        }),
      }),
    );

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('video')?.getAttribute('src')).toBe(
      '/files/clip.mp4',
    );
    expect(host.querySelector('video')?.getAttribute('poster')).toBe(
      '/thumbs/clip.jpg',
    );
  });

  it('renders file attachments and extracted text previews', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'attachment',
        content: '',
        attachment: makeAttachment({
          kind: 'file',
          name: 'notes.md',
          mimeType: 'text/markdown',
          url: '/files/notes.md',
          textPreview: {
            text: '# Notes\n\nA reusable source file.',
            truncated: true,
          },
        }),
      }),
    );

    const host: HTMLElement = fixture.nativeElement;
    const link = host.querySelector(
      '.rv-attachment__file-link',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/files/notes.md');
    expect(host.textContent).toContain('notes.md');
    expect(host.textContent).toContain('2.0 KB');
    expect(host.textContent).toContain('# Notes');
    expect(host.textContent).toContain('preview truncated');
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

  it('adds search match and active classes to messages', async () => {
    const fixture = await createMessage(
      makeMessage({
        blocks: [makeBlock({ id: 'b1', content: 'Search target' })],
      }),
    );
    fixture.componentRef.setInput('searchQuery', 'target');
    fixture.componentRef.setInput('matchedBlockIds', new Set(['b1']));
    fixture.componentRef.setInput('searchMatched', true);
    fixture.componentRef.setInput('searchActive', true);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-message--search-match')).not.toBeNull();
    expect(host.querySelector('.rv-message--search-active')).not.toBeNull();
    expect(host.querySelector('.rv-block__search-mark')?.textContent).toBe(
      'target',
    );
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
    const rawButton = host.querySelector(
      '.rv-block__raw-button',
    ) as HTMLButtonElement;
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
    const rawButton = host.querySelector(
      '.rv-block__raw-button',
    ) as HTMLButtonElement;

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
      makeBlock({
        kind: 'text',
        content: '<p>safe</p><script>alert(1)</script>',
      }),
      'sanitized-html',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.innerHTML).not.toContain('<script>');
    expect(host.textContent).toContain('safe');
  });

  it('auto mode renders balanced sanitized HTML', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '<p>Hello <b>world</b></p>' }),
      'auto',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block__markdown')).not.toBeNull();
    expect(host.innerHTML).toContain('<b>world</b>');
  });

  it('auto mode renders meaningful markdown', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '## Heading\n\n**bold**' }),
      'auto',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block__markdown')).not.toBeNull();
    expect(host.innerHTML).toContain('<h2>Heading</h2>');
    expect(host.innerHTML).toContain('<strong>bold</strong>');
  });

  it('auto mode leaves plain text raw', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'Just a normal chat message.' }),
      'auto',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block__markdown')).toBeNull();
    expect(host.querySelector('.rv-block__raw-button')).toBeNull();
    expect(host.textContent).toContain('Just a normal chat message.');
  });

  it('auto mode leaves partial HTML raw until it is balanced', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: '<div>partial' }),
      'auto',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block__markdown')).toBeNull();
    expect(host.textContent).toContain('<div>partial');
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

import type {
  ChatAttachment,
  ChatMessage,
  MessageBlock,
  ToolCallDebugDetail,
} from '@rusty-view/chat-domain';
import { messageAlternateSlot } from '@rusty-view/chat-domain';
import { TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { MessageBlockComponent } from './message-block';
import { MessageItemComponent } from './message-item';
import { MessageRevisionControlsComponent } from './message-revision-controls';
import { TRANSCRIPT_RENDERER_VERSION } from '../index';
import { visibleTranscriptBlocks } from './activity-visibility';
import {
  TRANSCRIPT_MARKDOWN_POLICY,
  TRANSCRIPT_TEXT_RENDER_MODE,
  type TextRenderMode,
} from './render-mode-token';
import {
  CHAT_CONTENT_RENDERERS,
  MESSAGE_BLOCK_DETAIL_LOADER,
  TOOL_CALL_DEBUG_DETAIL_LOADER,
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

  it('keeps the reusable message-block host block-level outside flex layouts', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'Standalone block' }),
    );
    const host: HTMLElement = fixture.nativeElement;
    const container = host.ownerDocument.createElement('div');
    container.append(host);
    host.ownerDocument.body.append(container);

    try {
      expect(getComputedStyle(host).display).toBe('block');
    } finally {
      container.remove();
    }
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

  it('does not mark raw text when the block is not a filtered search match', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'Find the brass key.' }),
    );
    fixture.componentRef.setInput('searchQuery', 'brass');
    fixture.componentRef.setInput('searchMatched', false);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-block--search-match')).toBeNull();
    expect(host.querySelector('.rv-block__search-mark')).toBeNull();
    expect(host.textContent).toContain('Find the brass key.');
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

  it('auto-expands reasoning without overriding a manual streaming collapse', async () => {
    const block = makeBlock({
      id: 'reasoning-1',
      kind: 'reasoning',
      content: 'Initial reasoning',
      renderPolicy: 'collapsed',
    });
    const fixture = await createBlock(block);
    fixture.componentRef.setInput('autoExpandReasoning', true);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="reasoning-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Initial reasoning');

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fixture.componentRef.setInput('block', {
      ...block,
      content: 'Initial reasoning plus a streamed delta',
    });
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.textContent).not.toContain('streamed delta');
  });

  it('renders service notices as distinct non-collapsible blocks', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'service_notice',
        content: 'wake wake-1 exceeded service turn cap 45000 ms',
        metadata: { reasonCode: 'wake_timeout' },
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    const notice = host.querySelector('[data-testid="service-notice-block"]');

    expect(notice).not.toBeNull();
    expect(notice?.getAttribute('data-reason-code')).toBe('wake_timeout');
    expect(host.textContent).toContain('Service turn cap reached');
    expect(host.querySelector('.rv-block--collapsible')).toBeNull();
  });

  it('lazily loads raw tool-call debug details when opened', async () => {
    const detail: ToolCallDebugDetail = {
      debug_detail_id: 'dbg_1',
      tool_call_id: 'tc_1',
      session_id: 's1',
      wake_id: 'wake_1',
      tool_name: 'search_lore',
      status: 'completed',
      arguments: {
        value: { query: 'amber' },
        truncated: false,
        redacted: true,
        sha256: 'hash_args',
      },
      partial_updates: [
        {
          recorded_at: '2026-07-03T22:00:01Z',
          partial_result: {
            value: ['one'],
            truncated: true,
            redacted: false,
            originalJsonChars: 2048,
          },
        },
      ],
      final_result: {
        value: { count: 1 },
        truncated: false,
        redacted: false,
      },
      source_metadata: { adapter: 'mcp' },
      started_at: '2026-07-03T22:00:00Z',
      updated_at: '2026-07-03T22:00:02Z',
      expires_at: '2026-07-03T23:00:00Z',
      limits: { max_chars: 1024 },
    };
    const load = vi.fn(async () => detail);
    const fixture = await createBlock(
      makeBlock({
        kind: 'tool_call',
        content: '',
        renderPolicy: 'collapsed',
        tool: {
          name: 'search_lore',
          status: 'completed',
          summary: 'Found lore',
          reasonCode: undefined,
          debugDetailId: 'dbg_1',
        },
      }),
      [{ provide: TOOL_CALL_DEBUG_DETAIL_LOADER, useValue: load }],
    );
    fixture.componentRef.setInput('message', makeMessage({ sessionId: 's1' }));
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(
      host.querySelector('[data-testid="tool-call-debug-panel"]'),
    ).toBeNull();

    (
      host.querySelector(
        '[data-testid="tool-call-debug-toggle"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(load).toHaveBeenCalledWith('s1', 'dbg_1');
    expect(host.textContent).toContain('redacted');
    expect(host.textContent).toContain('truncated');
    expect(host.textContent).toContain('hash_args');
    expect(host.textContent).toContain('2048 original JSON chars');
    expect(host.textContent).toContain('"query": "amber"');
  });

  it('loads bounded detail directly from an attributed block', async () => {
    const load = vi.fn(async () => ({
      content: 'diff --git a/src/app.ts b/src/app.ts',
      truncated: true,
      redactedKeys: ['token'],
    }));
    const fixture = await createBlock(
      makeBlock({
        kind: 'file_change',
        content: 'Bounded aggregate diff detail is available on demand.',
        renderPolicy: 'collapsed',
        metadata: {
          boundedDetailRef: 'detail-diff',
          externalRuntimeId: 'runtime-1',
        },
        tool: {
          name: 'Aggregate diff',
          status: 'completed',
          summary: 'Aggregate diff updated',
          reasonCode: undefined,
          debugDetailId: undefined,
        },
      }),
      [{ provide: MESSAGE_BLOCK_DETAIL_LOADER, useValue: load }],
    );

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="message-block-detail-toggle"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(load).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(host.textContent).toContain('truncated');
    expect(host.textContent).toContain('redacted');
  });

  it('shows a calm message when raw tool-call debug details are missing', async () => {
    const load = vi.fn(async () => {
      throw { statusCode: 404, message: 'not found' };
    });
    const fixture = await createBlock(
      makeBlock({
        kind: 'tool_call',
        content: '',
        renderPolicy: 'collapsed',
        tool: {
          name: 'search_lore',
          status: 'failed',
          summary: 'Debug detail expired',
          reasonCode: 'not_found',
          debugDetailId: 'dbg_missing',
        },
      }),
      [{ provide: TOOL_CALL_DEBUG_DETAIL_LOADER, useValue: load }],
    );
    fixture.componentRef.setInput('message', makeMessage({ sessionId: 's1' }));
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="tool-call-debug-toggle"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.textContent).toContain(
      'Raw tool-call details expired or are no longer available.',
    );
    expect(host.textContent).not.toContain('not found');
  });

  it('renders reasoning blocks folded by default, revealing content on expand', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'reasoning',
        content: 'Weighing the options before answering.',
        renderPolicy: 'collapsed',
      }),
    );
    const host: HTMLElement = fixture.nativeElement;

    // A dedicated reasoning block with a header, collapsed by default.
    const container = host.querySelector('.rv-block--reasoning');
    expect(container).not.toBeNull();
    expect(host.textContent).toContain('Reasoning');
    // Reasoning text is hidden until the user expands it.
    expect(host.textContent).not.toContain('Weighing the options');

    const header = host.querySelector('.rv-block__header') as HTMLButtonElement;
    header.click();
    fixture.detectChanges();

    expect(host.textContent).toContain(
      'Weighing the options before answering.',
    );

    const styles = Array.from(host.ownerDocument.styleSheets)
      .flatMap((styleSheet) => {
        try {
          return Array.from(styleSheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    expect(styles).toContain('rv-block--reasoning');
    expect(styles).toContain('var(--rv-font-technical)');
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

  it('renders fenced code with semantic syntax spans bound to palette tokens', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'text',
        content: '```ts\nconst greeting = "hello";\n```',
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.rv-md-code .hljs-keyword')?.textContent).toBe(
      'const',
    );
    expect(host.querySelector('.rv-md-code .hljs-string')?.textContent).toBe(
      '"hello"',
    );

    const sheet = Array.from(host.ownerDocument.styleSheets)
      .flatMap((styleSheet) => {
        try {
          return Array.from(styleSheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    expect(sheet).toContain('var(--rv-syntax-keyword)');
    expect(sheet).toContain('var(--rv-syntax-string)');
    expect(sheet).toContain('var(--rv-text-scope-code)');
  });

  it('renders aligned semantic tables in a themed overflow container', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'text',
        content: [
          '| Concern | Stable semantic authority | Variable product composition |',
          '|---|---:|---:|',
          '| Capability state and mutation | Rust | Never TS |',
        ].join('\n'),
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const scrollContainer = host.querySelector('.rv-md-table-scroll');
    const table = scrollContainer?.querySelector('table.rv-md-table');
    expect(scrollContainer).not.toBeNull();
    expect(table?.querySelectorAll('thead th')).toHaveLength(3);
    expect(table?.querySelectorAll('tbody td')).toHaveLength(3);
    expect(table?.querySelectorAll('.rv-md-align-right')).toHaveLength(4);

    const sheet = Array.from(host.ownerDocument.styleSheets)
      .flatMap((styleSheet) => {
        try {
          return Array.from(styleSheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    expect(sheet).toContain('rv-md-table-scroll');
    expect(sheet).toContain('overflow-x: auto');
    expect(sheet).toContain('var(--rv-color-surface-raised)');
    expect(sheet).toContain('rv-md-align-right');
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

  it('removes action-row spacing when actions are disabled', async () => {
    const fixture = await createMessage(
      makeMessage({ author: { role: 'assistant', displayName: 'Agent' } }),
    );
    fixture.componentRef.setInput('showRevisionActions', false);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="message-revision-controls"]',
      ),
    ).toBeNull();
  });

  it('labels commentary and final-answer presentation without changing turn status', async () => {
    const commentary = await createMessage(
      makeMessage({
        author: { role: 'assistant', displayName: 'Agent' },
        status: 'completed',
        metadata: { messagePhase: 'commentary' },
      }),
    );
    const commentaryRow = commentary.nativeElement.querySelector(
      '[data-testid="message-row"]',
    ) as HTMLElement;
    expect(commentaryRow.dataset['messagePhase']).toBe('commentary');
    expect(commentaryRow.classList).toContain('rv-message--commentary');
    expect(commentary.nativeElement.textContent).toContain('Commentary');

    commentary.destroy();
    TestBed.resetTestingModule();
    const finalAnswer = await createMessage(
      makeMessage({
        author: { role: 'assistant', displayName: 'Agent' },
        status: 'streaming',
        metadata: { messagePhase: 'final_answer' },
      }),
    );
    const finalRow = finalAnswer.nativeElement.querySelector(
      '[data-testid="message-row"]',
    ) as HTMLElement;
    expect(finalRow.dataset['messagePhase']).toBe('final_answer');
    expect(finalRow.classList).toContain('rv-message--final-answer');
    expect(finalAnswer.nativeElement.textContent).toContain('Final answer');
    expect(finalAnswer.nativeElement.textContent).toContain('typing');
  });

  it('renders speaker avatar images with accessible labels', async () => {
    const fixture = await createMessage(
      makeMessage({
        author: {
          role: 'assistant',
          displayName: 'Narrator',
          speaker: {
            label: 'Archivist',
            avatarUrl: '/avatars/archivist.png',
            avatarAlt: 'Archivist portrait',
          },
        },
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    const image = host.querySelector(
      '[data-testid="message-avatar-image"]',
    ) as HTMLImageElement;

    expect(
      host.querySelector('[data-testid="message-author"]')?.textContent,
    ).toContain('Archivist');
    expect(image).not.toBeNull();
    expect(image.getAttribute('src')).toBe('/avatars/archivist.png');
    expect(image.getAttribute('alt')).toBe('Archivist portrait');
  });

  it('falls back to speaker initials when no avatar image is supplied', async () => {
    const fixture = await createMessage(
      makeMessage({
        author: {
          role: 'user',
          displayName: undefined,
          speaker: { label: 'Rusty Crew', avatarAlt: 'Rusty Crew speaker' },
        },
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    const fallback = host.querySelector(
      '[data-testid="message-avatar-fallback"]',
    );

    expect(
      host.querySelector('[data-testid="message-avatar-image"]'),
    ).toBeNull();
    expect(fallback?.textContent).toContain('RC');
    expect(fallback?.getAttribute('aria-label')).toBe('Rusty Crew speaker');
  });

  it('uses explicit fallback initials when provided', async () => {
    const fixture = await createMessage(
      makeMessage({
        author: {
          role: 'tool',
          displayName: 'Search Index',
          speaker: { initials: 'SI' },
        },
      }),
    );
    const host: HTMLElement = fixture.nativeElement;

    expect(
      host.querySelector('[data-testid="message-avatar-fallback"]')
        ?.textContent,
    ).toContain('SI');
    expect(
      host
        .querySelector('[data-testid="message-avatar-fallback"]')
        ?.getAttribute('aria-label'),
    ).toBe('Avatar for Search Index');
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

  it('shows sending for an optimistic user message', async () => {
    const fixture = await createMessage(
      makeMessage({
        status: 'streaming',
        metadata: { deliveryStatus: 'sending' },
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('sending');
  });

  it('renders structured prompt delivery failures in a message inspector', async () => {
    const fixture = await createMessage(
      makeMessage({
        status: 'error',
        metadata: {
          deliveryStatus: 'failed',
          deliveryFailure: {
            operation: 'steer_turn',
            endpoint: '/v1/external-bindings/binding-1/controls',
            message: 'The expected turn is no longer active.',
            reasonCode: 'external_turn_not_active',
            statusCode: 409,
            retryable: true,
          },
        },
      }),
    );
    const host: HTMLElement = fixture.nativeElement;
    const inspector = host.querySelector(
      '[data-testid="message-delivery-failure"]',
    ) as HTMLDetailsElement;

    expect(inspector).not.toBeNull();
    expect(inspector.open).toBe(false);
    expect(inspector.querySelector('summary')?.textContent).toContain(
      'Delivery failure details',
    );
    expect(inspector.textContent).toContain(
      'The expected turn is no longer active.',
    );
    expect(inspector.textContent).toContain('steer_turn');
    expect(inspector.textContent).toContain('external_turn_not_active');
    expect(inspector.textContent).toContain('409');
    expect(inspector.textContent).toContain(
      '/v1/external-bindings/binding-1/controls',
    );
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

  it('hides reasoning and tool activity without mutating the source message', async () => {
    const message = makeMessage({
      author: { role: 'assistant', displayName: 'Narrator' },
      blocks: [
        makeBlock({ id: 'text', kind: 'text', content: 'Visible prose' }),
        makeBlock({
          id: 'reasoning',
          kind: 'reasoning',
          content: 'Private deliberation',
        }),
        makeBlock({
          id: 'tool',
          kind: 'tool_call',
          content: 'search_lore()',
        }),
      ],
    });
    const fixture = await createMessage(message);
    fixture.componentRef.setInput('activityVisibility', {
      reasoning: false,
      tools: false,
    });
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Visible prose');
    expect(host.textContent).not.toContain('Private deliberation');
    expect(host.textContent).not.toContain('search_lore');
    expect(host.querySelector('[data-testid="reasoning-block"]')).toBeNull();
    expect(host.querySelector('[data-testid="tool-call-block"]')).toBeNull();
    expect(message.blocks).toHaveLength(3);

    fixture.componentRef.setInput('activityVisibility', {
      reasoning: true,
      tools: true,
    });
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="reasoning-block"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('tool_call');
  });

  it('removes message chrome when every block is hidden activity', async () => {
    const fixture = await createMessage(
      makeMessage({
        author: { role: 'assistant', displayName: 'Narrator' },
        blocks: [
          makeBlock({
            id: 'reasoning-only',
            kind: 'reasoning',
            content: 'Hidden reasoning',
          }),
        ],
      }),
    );
    fixture.componentRef.setInput('activityVisibility', {
      reasoning: false,
      tools: true,
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="message-row"]'),
    ).toBeNull();
  });

  it('classifies all built-in tool activity kinds under the tools policy', () => {
    const message = makeMessage({
      blocks: [
        'tool_call',
        'tool_result',
        'debug',
        'command',
        'service_notice',
      ].map((kind, index) =>
        makeBlock({ id: `block-${index}`, kind, content: kind }),
      ),
    });

    expect(
      visibleTranscriptBlocks(message, { reasoning: true, tools: false }).map(
        (block) => block.kind,
      ),
    ).toEqual(['service_notice']);
  });
});

describe('MessageRevisionControlsComponent', () => {
  async function createRevisionControls(
    options: {
      readonly activeVariantId?: string | null;
      readonly alternateCount?: number;
      readonly capabilities?: Record<string, boolean>;
      readonly showActions?: boolean;
    } = {},
  ) {
    await TestBed.configureTestingModule({
      imports: [MessageRevisionControlsComponent],
    }).compileComponents();

    const primary = makeMessage({
      id: 'msg_primary',
      author: { role: 'assistant', displayName: 'Assistant' },
      blocks: [makeBlock({ id: 'primary_b1', content: 'Primary answer' })],
    });
    const alternates = Array.from(
      { length: options.alternateCount ?? 1 },
      (_, index) => {
        const ordinal = index + 1;
        const message = makeMessage({
          id: `msg_alt_${ordinal}`,
          author: { role: 'assistant', displayName: 'Assistant' },
          blocks: [
            makeBlock({
              id: `alt_${ordinal}_b1`,
              content: `Alternate answer ${ordinal}`,
            }),
          ],
        });
        return {
          id: message.id,
          slotId: 'slot_1',
          source: 'alternate' as const,
          ordinal,
          message,
        };
      },
    );
    const activeVariantId =
      options.activeVariantId === null
        ? undefined
        : (options.activeVariantId ?? alternates.at(-1)?.id);
    const slot = messageAlternateSlot(primary, {
      slotId: 'slot_1',
      ...(activeVariantId === undefined ? {} : { activeVariantId }),
      alternates,
    });

    const fixture = TestBed.createComponent(MessageRevisionControlsComponent);
    fixture.componentRef.setInput('message', slot.primary.message);
    fixture.componentRef.setInput('slot', slot);
    if (options.capabilities !== undefined) {
      fixture.componentRef.setInput('capabilities', options.capabilities);
    }
    if (options.showActions !== undefined) {
      fixture.componentRef.setInput('showActions', options.showActions);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('shows alternate variant count and emits selection actions', async () => {
    const fixture = await createRevisionControls();
    const host: HTMLElement = fixture.nativeElement;
    const actions: unknown[] = [];
    fixture.componentInstance.action.subscribe((action) =>
      actions.push(action),
    );

    expect(
      host.querySelector('[data-testid="variant-count"]')?.textContent,
    ).toContain('2/2');

    (
      host.querySelector(
        '[data-testid="variant-previous"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(actions).toMatchObject([
      {
        kind: 'previous_variant',
        slot: { id: 'slot_1' },
        variant: { id: 'msg_primary' },
      },
    ]);
  });

  it('keeps unsupported revision actions disabled', async () => {
    const fixture = await createRevisionControls();
    const host: HTMLElement = fixture.nativeElement;

    expect(
      (
        host.querySelector(
          '[data-testid="message-regenerate"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (host.querySelector('[data-testid="message-edit"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        host.querySelector(
          '[data-testid="variant-delete"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fixture.componentRef.setInput('capabilities', { deleteVariant: true });
    fixture.detectChanges();
    expect(
      (
        host.querySelector(
          '[data-testid="variant-delete"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('emits request_next_alternative from the final variant when supported', async () => {
    const fixture = await createRevisionControls({
      activeVariantId: 'msg_alt_2',
      alternateCount: 2,
      capabilities: { requestNextAlternative: true },
    });
    const host: HTMLElement = fixture.nativeElement;
    const actions: unknown[] = [];
    fixture.componentInstance.action.subscribe((action) =>
      actions.push(action),
    );

    expect(
      host.querySelector('[data-testid="variant-count"]')?.textContent,
    ).toContain('3/3');
    (
      host.querySelector('[data-testid="variant-next"]') as HTMLButtonElement
    ).click();

    expect(actions).toMatchObject([
      { kind: 'request_next_alternative', variant: { id: 'msg_alt_2' } },
    ]);
  });

  it('does not render alternate carousel controls for a single variant', async () => {
    const fixture = await createRevisionControls({ alternateCount: 0 });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('[data-testid="variant-count"]')).toBeNull();
    expect(host.querySelector('[data-testid="variant-previous"]')).toBeNull();
    expect(host.querySelector('[data-testid="variant-next"]')).toBeNull();
  });

  it('keeps variant controls while removing disabled message actions', async () => {
    const fixture = await createRevisionControls({ showActions: false });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('.rv-revision__actions')).toBeNull();
    expect(host.querySelector('[data-testid="variant-count"]')).not.toBeNull();
  });

  it('supports arrow-key navigation on the variant carousel', async () => {
    const fixture = await createRevisionControls({
      activeVariantId: null,
      alternateCount: 2,
    });
    const host: HTMLElement = fixture.nativeElement;
    const actions: unknown[] = [];
    fixture.componentInstance.action.subscribe((action) =>
      actions.push(action),
    );
    const carousel = host.querySelector(
      '.rv-revision__variants',
    ) as HTMLElement;

    carousel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();

    expect(actions).toMatchObject([
      { kind: 'next_variant', variant: { id: 'msg_alt_1' } },
    ]);
    expect(
      (
        host.querySelector(
          '[data-testid="variant-previous"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
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

  it('opens rendered markdown links outside the application shell', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'text',
        content: '[report](https://example.com/report)',
      }),
      'markdown',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
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

  it('opens sanitized HTML links outside the application shell', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'text',
        content:
          '<a href="https://example.com/report" target="_self" rel="opener">report</a>',
      }),
      'sanitized-html',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
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

  it('renders mixed semantic text spans without using innerHTML', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'text',
        content: 'Plain quoted strong',
        textSpans: [
          { start: 6, end: 12, scope: 'quote' },
          { start: 13, end: 19, scope: 'strong' },
        ],
      }),
      'auto',
    );
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const scoped = host.querySelectorAll('[data-rv-text-scope]');

    expect(host.querySelector('.rv-block__markdown')).toBeNull();
    expect(
      host.querySelector('[data-testid="text-block-content"]')?.textContent,
    ).toContain('Plain quoted strong');
    expect(scoped.item(0).getAttribute('data-rv-text-scope')).toBe('quote');
    expect(scoped.item(0).textContent).toBe('quoted');
    expect(scoped.item(1).getAttribute('data-rv-text-scope')).toBe('strong');
    expect(scoped.item(1).textContent).toBe('strong');
  });

  it('renders unstyled text with no semantic scope attributes', async () => {
    const fixture = await createBlock(
      makeBlock({ kind: 'text', content: 'unstyled text' }),
      'raw',
    );
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-rv-text-scope]')).toBeNull();
    expect(host.textContent).toContain('unstyled text');
  });

  it('drops overlapping semantic spans without breaking text order', async () => {
    const fixture = await createBlock(
      makeBlock({
        kind: 'text',
        content: 'abcdef',
        textSpans: [
          { start: 0, end: 3, scope: 'accent' },
          { start: 2, end: 5, scope: 'danger' },
          { start: 5, end: 6, scope: 'code' },
        ],
      }),
      'raw',
    );
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const content = host.querySelector('[data-testid="text-block-content"]');
    const scoped = host.querySelectorAll('[data-rv-text-scope]');

    expect(content?.textContent?.replace(/\s+/g, '')).toBe('abcdef');
    expect(scoped.item(0).getAttribute('data-rv-text-scope')).toBe('accent');
    expect(scoped.item(0).textContent).toBe('abc');
    expect(scoped.item(1).getAttribute('data-rv-text-scope')).toBe('code');
    expect(scoped.item(1).textContent).toBe('f');
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

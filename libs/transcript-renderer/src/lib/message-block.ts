import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import type { ChatMessage, MessageBlock } from '@rusty-view/chat-domain';

import { AttachmentBlockComponent } from './attachment-block';
import { WorkerManager } from './worker-manager';
import {
  TRANSCRIPT_TEXT_RENDER_MODE,
  type TextRenderMode,
} from './render-mode-token';
import {
  CHAT_CONTENT_RENDERERS,
  type ChatContentRenderContext,
} from './content-renderers';

type FormattedTextRenderMode = 'markdown' | 'sanitized-html';
type ResolvedTextRenderMode = 'raw' | FormattedTextRenderMode;

const HTML_VOID_TAGS = new Set(['br', 'hr', 'img']);
const AUTO_HTML_TAGS = new Set([
  'p',
  'br',
  'b',
  'i',
  'em',
  'strong',
  'code',
  'pre',
  'kbd',
  's',
  'del',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'hr',
  'a',
  'span',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'caption',
  'img',
]);

/**
 * Renders a single {@link MessageBlock} by kind.
 *
 * - text → rendered according to the global {@link TextRenderMode}:
 *   `auto` (detect Markdown/HTML per block), `markdown` (worker-parsed),
 *   `sanitized-html` (pre-sanitized then Angular `[innerHTML]`), or `raw`
 *   (plain text). A per-block raw toggle overrides to raw so users can always
 *   recover.
 * - tool_call / tool_result / debug / command → collapsible panel
 *
 * Large blocks render the first N lines with an expand toggle. Text blocks use
 * the {@link WorkerManager} to parse/sanitize off the main thread when the
 * content exceeds the inline threshold, preventing frame drops during scroll
 * with very long messages.
 *
 * **Render modes** (task #3260):
 * - `auto` — detect meaningful Markdown or sanitized HTML; otherwise raw.
 * - `raw` — plain text, no formatting. Always available as fallback.
 * - `markdown` — content parsed as Markdown → safe HTML.
 * - `sanitized-html` — content treated as inline HTML, pre-sanitized (strips
 *   scripts, event handlers, iframes, dangerous URLs) then bound via
 *   `[innerHTML]` for Angular's final sanitization layer.
 *
 * Per-block raw toggle: the `showRaw` signal overrides the global mode to
 * `raw`. The toggle button appears on text blocks when the global mode is not
 * already `raw`.
 */
@Component({
  selector: 'rv-message-block',
  imports: [NgComponentOutlet, AttachmentBlockComponent],
  templateUrl: './message-block.html',
  styleUrl: './message-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBlockComponent {
  private readonly workerManager = inject(WorkerManager);
  private readonly contentRenderers =
    inject(CHAT_CONTENT_RENDERERS, { optional: true }) ?? [];
  protected readonly renderMode = inject(TRANSCRIPT_TEXT_RENDER_MODE);

  readonly block = input.required<MessageBlock>();
  readonly message = input<ChatMessage | undefined>(undefined);
  readonly collapsedThreshold = input<number>(500);
  /** Content length above which markdown/HTML processing goes to the worker. */
  readonly workerThreshold = input<number>(2_000);

  protected readonly expanded = signal(false);
  /** Per-block override: when true, show raw text regardless of global mode. */
  protected readonly showRaw = signal(false);

  /** Rendered HTML for text blocks (markdown-parsed or sanitized). */
  protected readonly renderedHtml = signal<string>('');

  /** Effective render mode: global mode unless per-block raw is toggled. */
  protected readonly effectiveRenderMode = computed<TextRenderMode>(() =>
    this.showRaw() ? 'raw' : this.renderMode(),
  );

  /** Whether this text block should render formatted content. */
  protected readonly shouldRenderFormatted = computed(
    () => this.effectiveRenderMode() !== 'raw',
  );

  protected readonly showRawToggle = computed(
    () =>
      this.renderMode() !== 'raw' &&
      (this.renderMode() !== 'auto' ||
        this.showRaw() ||
        this.renderedHtml() !== ''),
  );

  protected readonly renderContext = computed<ChatContentRenderContext>(() => ({
    message: this.message(),
    block: this.block(),
    sessionId: this.message()?.sessionId,
  }));

  protected readonly customRenderer = computed(() => {
    const context = this.renderContext();
    return this.contentRenderers
      .filter((renderer) => renderer.type === context.block.kind)
      .sort(
        (a, b) =>
          (a.order ?? 100) - (b.order ?? 100) || a.type.localeCompare(b.type),
      )
      .find((renderer) => renderer.canRender?.(context) ?? true);
  });

  protected readonly customRendererInputs = computed(() => {
    const context = this.renderContext();
    return {
      block: context.block,
      message: context.message,
      context,
    };
  });

  /** Tool/command metadata, when this block represents inline tool activity. */
  protected readonly tool = computed(() => this.block().tool);

  /** Attachment metadata, when this block represents an inline uploaded file. */
  protected readonly attachment = computed(() => this.block().attachment);

  /** Whether the tool block has expandable detail (result / reason). */
  protected readonly hasDetail = computed(
    () => this.block().content.length > 0,
  );

  protected readonly isCollapsible = computed(
    () =>
      this.customRenderer() === undefined &&
      this.attachment() === undefined &&
      this.block().kind !== 'text',
  );

  protected readonly displayContent = computed(() => {
    const content = this.block().content;
    if (!this.isCollapsible() || this.expanded()) {
      return content;
    }
    const threshold = this.collapsedThreshold();
    if (content.length <= threshold) {
      return content;
    }
    return content.slice(0, threshold) + '…';
  });

  protected readonly isTruncated = computed(
    () =>
      this.isCollapsible() &&
      !this.expanded() &&
      this.block().content.length > this.collapsedThreshold(),
  );

  constructor() {
    // When the text block content changes OR the render mode changes,
    // render (or clear) formatted content accordingly.
    effect(() => {
      const block = this.block();
      if (
        this.customRenderer() !== undefined ||
        block.attachment !== undefined ||
        block.kind !== 'text'
      ) {
        this.renderedHtml.set('');
        return;
      }
      const mode = this.effectiveRenderMode();
      if (mode === 'raw') {
        this.renderedHtml.set('');
        return;
      }
      const content = block.content;
      const resolvedMode = this.resolveTextRenderMode(content, mode);
      if (resolvedMode === 'raw') {
        this.renderedHtml.set('');
        return;
      }
      void this.renderFormatted(content, resolvedMode, mode);
    });
  }

  protected toggleExpand(): void {
    this.expanded.update((v) => !v);
  }

  protected toggleRaw(): void {
    this.showRaw.update((v) => !v);
  }

  private async renderFormatted(
    content: string,
    mode: FormattedTextRenderMode,
    expectedMode: TextRenderMode,
  ): Promise<void> {
    const html =
      mode === 'sanitized-html'
        ? await this.workerManager.sanitizeHtml(content)
        : await this.workerManager.parseMarkdown(content);
    // Only update if the block hasn't changed during async processing
    // AND the render mode is still active.
    if (
      this.block().content === content &&
      this.effectiveRenderMode() === expectedMode &&
      this.resolveTextRenderMode(content, expectedMode) === mode
    ) {
      this.renderedHtml.set(html);
    }
  }

  private resolveTextRenderMode(
    content: string,
    mode: TextRenderMode,
  ): ResolvedTextRenderMode {
    if (mode !== 'auto') return mode;
    if (hasBalancedAllowedHtml(content)) return 'sanitized-html';
    if (hasMeaningfulMarkdown(content)) return 'markdown';
    return 'raw';
  }
}

function hasBalancedAllowedHtml(content: string): boolean {
  const stack: string[] = [];
  let sawAllowedTag = false;
  let match: RegExpExecArray | null;
  const tagRegex = /<\/?([a-zA-Z][\w:-]*)(?:\s[^<>]*)?>/g;

  while ((match = tagRegex.exec(content)) !== null) {
    const rawTag = match[1];
    if (rawTag === undefined) continue;
    const tag = rawTag.toLowerCase();
    if (!AUTO_HTML_TAGS.has(tag)) continue;
    sawAllowedTag = true;
    if (HTML_VOID_TAGS.has(tag)) continue;

    const matched = match[0];
    if (matched.startsWith('</')) {
      if (stack.pop() !== tag) return false;
      continue;
    }
    if (matched.endsWith('/>')) continue;
    stack.push(tag);
  }

  return sawAllowedTag && stack.length === 0;
}

function hasMeaningfulMarkdown(content: string): boolean {
  return (
    hasClosedCodeFence(content) ||
    /^ {0,3}#{1,6}\s+\S/m.test(content) ||
    /^ {0,3}>\s+\S/m.test(content) ||
    /^ {0,3}[-*+]\s+\S/m.test(content) ||
    /^ {0,3}\d+\.\s+\S/m.test(content) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/m.test(content) ||
    /^\|.+\|\s*\n\|[\s:-]+\|/m.test(content) ||
    /\*\*[^*\n][\s\S]*?\*\*/.test(content) ||
    /~~[^~\n][\s\S]*?~~/.test(content) ||
    /`[^`\n]+`/.test(content) ||
    /\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"\n]+")?\)/.test(content)
  );
}

function hasClosedCodeFence(content: string): boolean {
  const matches = content.match(/^ {0,3}(```|~~~)/gm);
  return matches !== null && matches.length >= 2;
}

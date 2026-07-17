import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import type {
  ChatMessage,
  MessageBlock,
  ToolCallDebugDetail,
  ToolCallDebugValue,
  TranscriptTextScope,
  TranscriptTextSpan,
} from '@rusty-view/chat-domain';

import { AttachmentBlockComponent } from './attachment-block';
import { WorkerManager } from './worker-manager';
import {
  TRANSCRIPT_MARKDOWN_POLICY,
  TRANSCRIPT_TEXT_RENDER_MODE,
  type MarkdownLiteralExclusion,
  type MarkdownRenderPolicy,
  type TextRenderMode,
} from './render-mode-token';
import {
  CHAT_CONTENT_RENDERERS,
  MESSAGE_BLOCK_DETAIL_LOADER,
  TOOL_CALL_DEBUG_DETAIL_LOADER,
  type ChatContentRenderContext,
  type MessageBlockDetail,
} from './content-renderers';

type FormattedTextRenderMode = 'markdown' | 'sanitized-html';
type ResolvedTextRenderMode = 'raw' | FormattedTextRenderMode;
interface TextRenderSegment {
  readonly text: string;
  readonly matched: boolean;
  readonly scope: TranscriptTextScope | undefined;
}
type ToolDebugState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly detail: ToolCallDebugDetail }
  | { readonly status: 'missing'; readonly message: string }
  | { readonly status: 'error'; readonly message: string };
type BlockDetailState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly detail: MessageBlockDetail }
  | { readonly status: 'error'; readonly message: string };

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
  // Markdown and sanitized HTML are inserted with [innerHTML], so those child
  // nodes do not receive Angular's emulated encapsulation attribute. Every
  // selector in this stylesheet is rv-prefixed; emitting it globally lets the
  // shared renderer theme its generated markup without leaking generic rules.
  encapsulation: ViewEncapsulation.None,
})
export class MessageBlockComponent {
  private readonly workerManager = inject(WorkerManager);
  private readonly contentRenderers =
    inject(CHAT_CONTENT_RENDERERS, { optional: true }) ?? [];
  private readonly toolDebugLoader = inject(TOOL_CALL_DEBUG_DETAIL_LOADER, {
    optional: true,
  });
  private readonly blockDetailLoader = inject(MESSAGE_BLOCK_DETAIL_LOADER, {
    optional: true,
  });
  protected readonly renderMode = inject(TRANSCRIPT_TEXT_RENDER_MODE);
  protected readonly markdownPolicy = inject(TRANSCRIPT_MARKDOWN_POLICY);
  private lastToolDebugKey: string | undefined;
  private lastBlockDetailKey: string | undefined;
  private lastExpansionBlockId: string | undefined;
  private lastAutoExpandReasoning = false;

  readonly block = input.required<MessageBlock>();
  readonly message = input<ChatMessage | undefined>(undefined);
  readonly collapsedThreshold = input<number>(500);
  /** Content length above which markdown/HTML processing goes to the worker. */
  readonly workerThreshold = input<number>(2_000);
  readonly searchQuery = input<string>('');
  readonly searchMatched = input<boolean>(false);
  readonly autoExpandReasoning = input<boolean>(false);

  protected readonly expanded = signal(false);
  /** Per-block override: when true, show raw text regardless of global mode. */
  protected readonly showRaw = signal(false);
  protected readonly toolDebugOpen = signal(false);
  protected readonly toolDebugState = signal<ToolDebugState>({
    status: 'idle',
  });
  protected readonly blockDetailOpen = signal(false);
  protected readonly blockDetailState = signal<BlockDetailState>({
    status: 'idle',
  });

  /** Rendered HTML for text blocks (markdown-parsed or sanitized). */
  protected readonly renderedHtml = signal<string>('');

  /** Effective render mode: global mode unless per-block raw is toggled. */
  protected readonly effectiveRenderMode = computed<TextRenderMode>(() =>
    this.showRaw() ? 'raw' : this.renderMode(),
  );

  /** Whether this text block should render formatted content. */
  protected readonly shouldRenderFormatted = computed(
    () =>
      this.effectiveRenderMode() !== 'raw' &&
      this.semanticSegments().length === 0,
  );

  protected readonly showRawToggle = computed(
    () =>
      this.renderMode() !== 'raw' &&
      (this.renderMode() !== 'auto' ||
        this.showRaw() ||
        this.renderedHtml() !== ''),
  );

  protected readonly semanticSegments = computed(() =>
    semanticTextSegments(this.block().content, this.block().textSpans ?? []),
  );

  protected readonly highlightedSegments = computed<
    readonly TextRenderSegment[]
  >(() => {
    const query = this.searchQuery().trim();
    const content = this.block().content;
    const baseSegments =
      this.semanticSegments().length > 0
        ? this.semanticSegments()
        : [{ text: content, matched: false, scope: undefined }];

    if (!this.searchMatched() || query.length === 0 || content.length === 0) {
      return baseSegments;
    }

    return splitSegmentsForSearch(baseSegments, query);
  });

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

  protected readonly toolDebugDetailId = computed(
    () => this.tool()?.debugDetailId,
  );

  protected readonly canInspectToolDebug = computed(
    () =>
      this.toolDebugLoader !== null &&
      this.message()?.sessionId !== undefined &&
      this.toolDebugDetailId() !== undefined,
  );

  protected readonly blockDetailRef = computed(() => {
    const value = this.block().metadata?.['boundedDetailRef'];
    return typeof value === 'string' ? value : undefined;
  });

  protected readonly canLoadBlockDetail = computed(
    () =>
      this.blockDetailLoader !== null && this.blockDetailRef() !== undefined,
  );

  /** Attachment metadata, when this block represents an inline uploaded file. */
  protected readonly attachment = computed(() => this.block().attachment);

  /** Whether the tool block has expandable detail (result / reason). */
  protected readonly hasDetail = computed(
    () => this.block().content.length > 0,
  );

  /**
   * Reasoning / think blocks (task #3867): folded behind an expandable header,
   * collapsed by default, kept visually distinct from the assistant's answer.
   */
  protected readonly isReasoning = computed(
    () =>
      this.customRenderer() === undefined && this.block().kind === 'reasoning',
  );

  protected readonly isServiceNotice = computed(
    () =>
      this.customRenderer() === undefined &&
      this.block().kind === 'service_notice',
  );

  protected readonly serviceNoticeReasonCode = computed(() => {
    const reasonCode = this.block().metadata?.['reasonCode'];
    return typeof reasonCode === 'string' ? reasonCode : undefined;
  });

  protected readonly isCollapsible = computed(
    () =>
      this.customRenderer() === undefined &&
      this.attachment() === undefined &&
      this.block().kind !== 'text' &&
      this.block().kind !== 'reasoning' &&
      this.block().kind !== 'service_notice',
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
    // Apply the reasoning preference only when this view starts rendering a
    // different block, or when the preference itself changes. Streaming
    // content updates keep the same block id, so a manual collapse is not
    // immediately undone by the next reasoning delta.
    effect(() => {
      const block = this.block();
      const autoExpand = this.autoExpandReasoning();
      if (block.id !== this.lastExpansionBlockId) {
        this.lastExpansionBlockId = block.id;
        this.lastAutoExpandReasoning = autoExpand;
        if (block.kind === 'reasoning') this.expanded.set(autoExpand);
        return;
      }
      if (autoExpand === this.lastAutoExpandReasoning) return;
      this.lastAutoExpandReasoning = autoExpand;
      if (block.kind === 'reasoning') this.expanded.set(autoExpand);
    });

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
      if (mode === 'raw' || this.semanticSegments().length > 0) {
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

    effect(() => {
      const sessionId = this.message()?.sessionId;
      const debugDetailId = this.toolDebugDetailId();
      const nextKey =
        sessionId !== undefined && debugDetailId !== undefined
          ? `${sessionId}\u0000${debugDetailId}`
          : undefined;
      if (nextKey === this.lastToolDebugKey) return;
      this.lastToolDebugKey = nextKey;
      this.toolDebugState.set({ status: 'idle' });
      this.toolDebugOpen.set(false);
    });

    effect(() => {
      const nextKey = this.blockDetailRef();
      if (nextKey === this.lastBlockDetailKey) return;
      this.lastBlockDetailKey = nextKey;
      this.blockDetailState.set({ status: 'idle' });
      this.blockDetailOpen.set(false);
    });
  }

  protected toggleExpand(): void {
    this.expanded.update((v) => !v);
  }

  protected toggleRaw(): void {
    this.showRaw.update((v) => !v);
  }

  protected toggleToolDebug(): void {
    if (!this.canInspectToolDebug()) return;
    const nextOpen = !this.toolDebugOpen();
    this.toolDebugOpen.set(nextOpen);
    if (nextOpen && this.toolDebugState().status === 'idle') {
      void this.loadToolDebugDetail();
    }
  }

  protected retryToolDebug(): void {
    if (!this.canInspectToolDebug()) return;
    this.toolDebugState.set({ status: 'idle' });
    void this.loadToolDebugDetail();
  }

  protected toggleBlockDetail(): void {
    if (!this.canLoadBlockDetail()) return;
    const nextOpen = !this.blockDetailOpen();
    this.blockDetailOpen.set(nextOpen);
    if (nextOpen && this.blockDetailState().status === 'idle') {
      void this.loadBlockDetail();
    }
  }

  protected retryBlockDetail(): void {
    this.blockDetailState.set({ status: 'idle' });
    void this.loadBlockDetail();
  }

  private async loadBlockDetail(): Promise<void> {
    const loader = this.blockDetailLoader;
    if (loader === null) return;
    this.blockDetailState.set({ status: 'loading' });
    try {
      const detail = await loader(this.block(), this.message());
      this.blockDetailState.set({ status: 'loaded', detail });
    } catch (error) {
      this.blockDetailState.set({
        status: 'error',
        message: errorMessage(error),
      });
    }
  }

  private async loadToolDebugDetail(): Promise<void> {
    const sessionId = this.message()?.sessionId;
    const debugDetailId = this.toolDebugDetailId();
    const loader = this.toolDebugLoader;
    if (
      sessionId === undefined ||
      debugDetailId === undefined ||
      loader === null
    ) {
      return;
    }

    this.toolDebugState.set({ status: 'loading' });
    try {
      const detail = await loader(sessionId, debugDetailId);
      this.toolDebugState.set({ status: 'loaded', detail });
    } catch (error) {
      if (isMissingDebugDetailError(error)) {
        this.toolDebugState.set({
          status: 'missing',
          message: 'Raw tool-call details expired or are no longer available.',
        });
        return;
      }
      this.toolDebugState.set({
        status: 'error',
        message: errorMessage(error),
      });
    }
  }

  protected formatDebugValue(value: ToolCallDebugValue): string {
    return stringifyDebugJson(value.value);
  }

  protected debugValueLabels(value: ToolCallDebugValue): readonly string[] {
    const labels: string[] = [];
    if (value.redacted) labels.push('redacted');
    if (value.truncated) labels.push('truncated');
    if (value.originalJsonChars !== undefined) {
      labels.push(`${value.originalJsonChars} original JSON chars`);
    }
    if (value.sha256 !== undefined) {
      labels.push(`sha256 ${value.sha256}`);
    }
    return labels;
  }

  protected formatDebugJson(value: unknown): string {
    return stringifyDebugJson(value);
  }

  protected onMarkdownInteraction(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const control = target.closest<HTMLElement>('.rv-md-code-copy');
    if (control === null) return;
    event.preventDefault();

    const block = control.closest('.rv-md-code-block');
    const code = block?.querySelector('code')?.textContent;
    if (code === undefined || code === null) return;

    void copyText(code).then((copied) => {
      if (!copied) return;
      const previous = control.textContent ?? 'Copy';
      control.textContent = 'Copied';
      setTimeout(() => {
        control.textContent = previous;
      }, 1200);
    });
  }

  private async renderFormatted(
    content: string,
    mode: FormattedTextRenderMode,
    expectedMode: TextRenderMode,
  ): Promise<void> {
    const html =
      mode === 'sanitized-html'
        ? await this.workerManager.sanitizeHtml(content)
        : await this.workerManager.parseMarkdown(content, this.markdownPolicy);
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
    if (
      mode === 'markdown' &&
      shouldBypassMarkdown(content, this.markdownPolicy)
    ) {
      return 'raw';
    }
    if (mode !== 'auto') return mode;
    if (shouldBypassMarkdown(content, this.markdownPolicy)) return 'raw';
    if (hasBalancedAllowedHtml(content)) return 'sanitized-html';
    if (hasMeaningfulMarkdown(content, this.markdownPolicy)) return 'markdown';
    return 'raw';
  }
}

function shouldBypassMarkdown(
  content: string,
  policy: MarkdownRenderPolicy,
): boolean {
  return policy.literalExclusions.some((rule) =>
    matchesLiteralRule(content, rule),
  );
}

function matchesLiteralRule(
  content: string,
  rule: MarkdownLiteralExclusion,
): boolean {
  const mode = rule.match ?? 'contains';
  const source = rule.caseSensitive === true ? content : content.toLowerCase();
  const value =
    rule.caseSensitive === true ? rule.value : rule.value.toLowerCase();

  if (value.length === 0) return false;
  if (mode === 'exact') return source.trim() === value.trim();
  if (mode === 'line') {
    return source.split(/\r?\n/).some((line) => line.trim() === value.trim());
  }
  return source.includes(value);
}

async function copyText(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function stringifyDebugJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
}

function isMissingDebugDetailError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { readonly statusCode?: unknown }).statusCode === 404
  );
}

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { readonly message?: unknown }).message === 'string'
  ) {
    return (error as { readonly message: string }).message;
  }
  return 'Could not load raw tool-call details.';
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

function hasMeaningfulMarkdown(
  content: string,
  policy: MarkdownRenderPolicy,
): boolean {
  const hrPattern = policy.enableUnderscoreHorizontalRules
    ? /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/m
    : /^ {0,3}([-*])(?:\s*\1){2,}\s*$/m;
  return (
    hasClosedCodeFence(content) ||
    /^ {0,3}#{1,6}\s+\S/m.test(content) ||
    /^ {0,3}>\s+\S/m.test(content) ||
    /^ {0,3}[-*+]\s+\S/m.test(content) ||
    /^ {0,3}\d+\.\s+\S/m.test(content) ||
    hrPattern.test(content) ||
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

function semanticTextSegments(
  content: string,
  spans: readonly TranscriptTextSpan[],
): readonly TextRenderSegment[] {
  if (content.length === 0 || spans.length === 0) return [];

  const normalized = spans
    .map((span) => ({
      start: clampTextOffset(span.start, content.length),
      end: clampTextOffset(span.end, content.length),
      scope: span.scope,
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const segments: TextRenderSegment[] = [];
  let cursor = 0;
  for (const span of normalized) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      segments.push({
        text: content.slice(cursor, span.start),
        matched: false,
        scope: undefined,
      });
    }
    segments.push({
      text: content.slice(span.start, span.end),
      matched: false,
      scope: span.scope,
    });
    cursor = span.end;
  }

  if (cursor < content.length) {
    segments.push({
      text: content.slice(cursor),
      matched: false,
      scope: undefined,
    });
  }

  return segments;
}

function splitSegmentsForSearch(
  segments: readonly TextRenderSegment[],
  query: string,
): readonly TextRenderSegment[] {
  const needle = query.toLowerCase();
  const result: TextRenderSegment[] = [];
  for (const segment of segments) {
    const source = segment.text;
    let cursor = 0;
    let index = source.toLowerCase().indexOf(needle);
    while (index >= 0) {
      if (index > cursor) {
        result.push({
          text: source.slice(cursor, index),
          matched: false,
          scope: segment.scope,
        });
      }
      result.push({
        text: source.slice(index, index + query.length),
        matched: true,
        scope: segment.scope,
      });
      cursor = index + query.length;
      index = source.toLowerCase().indexOf(needle, cursor);
    }
    if (cursor < source.length) {
      result.push({
        text: source.slice(cursor),
        matched: false,
        scope: segment.scope,
      });
    }
  }
  return result.filter((segment) => segment.text.length > 0);
}

function clampTextOffset(offset: number, max: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(max, Math.floor(offset)));
}

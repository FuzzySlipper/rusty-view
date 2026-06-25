import type { ChatMessage, MessageBlock, MessageRole } from './domain-types';

export interface ConversationSearchFilters {
  readonly roles?: readonly MessageRole[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

export interface ConversationSearchResult {
  readonly id: string;
  readonly ordinal: number;
  readonly messageId: string;
  readonly blockId: string;
  readonly role: MessageRole;
  readonly createdAt: string;
  readonly snippet: string;
  readonly highlightStart: number;
  readonly highlightEnd: number;
}

const SNIPPET_RADIUS = 48;

export function searchConversationMessages(
  messages: readonly ChatMessage[],
  query: string,
  filters: ConversationSearchFilters = {},
): readonly ConversationSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return [];

  const results: ConversationSearchResult[] = [];
  for (const message of messages) {
    if (!messageMatchesFilters(message, filters)) continue;

    for (const block of message.blocks) {
      const searchableText = searchableBlockText(block);
      const matchStart = searchableText.toLowerCase().indexOf(normalizedQuery);
      if (matchStart < 0) continue;

      const snippet = snippetForMatch(
        searchableText,
        matchStart,
        normalizedQuery.length,
      );
      results.push({
        id: `${message.id}:${block.id}:${matchStart}`,
        ordinal: results.length + 1,
        messageId: message.id,
        blockId: block.id,
        role: message.author.role,
        createdAt: message.createdAt,
        snippet: snippet.text,
        highlightStart: snippet.highlightStart,
        highlightEnd: snippet.highlightEnd,
      });
    }
  }
  return results;
}

function searchableBlockText(block: MessageBlock): string {
  const parts = [block.content];
  const attachment = block.attachment;
  if (attachment !== undefined) {
    parts.push(attachment.name);
    if (attachment.mimeType !== undefined) parts.push(attachment.mimeType);
    if (attachment.textPreview !== undefined) {
      parts.push(attachment.textPreview.text);
    }
  }
  return parts.join('\n');
}

function messageMatchesFilters(
  message: ChatMessage,
  filters: ConversationSearchFilters,
): boolean {
  if (
    filters.roles !== undefined &&
    filters.roles.length > 0 &&
    !filters.roles.includes(message.author.role)
  ) {
    return false;
  }

  const timestamp = Date.parse(message.createdAt);
  if (Number.isNaN(timestamp)) return true;

  const start = dateStart(filters.dateFrom);
  if (start !== undefined && timestamp < start) return false;

  const end = dateEnd(filters.dateTo);
  if (end !== undefined && timestamp > end) return false;

  return true;
}

function dateStart(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const timestamp = Date.parse(`${value}T00:00:00.000`);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function dateEnd(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const timestamp = Date.parse(`${value}T23:59:59.999`);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function snippetForMatch(
  text: string,
  matchStart: number,
  matchLength: number,
): {
  readonly text: string;
  readonly highlightStart: number;
  readonly highlightEnd: number;
} {
  const start = Math.max(0, matchStart - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchStart + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
  const highlightStart = prefix.length + matchStart - start;
  return {
    text: snippet,
    highlightStart,
    highlightEnd: highlightStart + matchLength,
  };
}

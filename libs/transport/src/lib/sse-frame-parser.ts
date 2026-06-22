/**
 * Incremental SSE (Server-Sent Events) frame parser.
 *
 * Pure stateful parser: feed it text chunks (possibly split mid-line), and it
 * yields complete {@link SseFrame} objects as blank-line-delimited events are
 * assembled. Implements the WHATWG SSE parsing rules:
 *
 * - Lines terminated by LF or CR LF.
 * - Blank line dispatches the accumulated event.
 * - Lines starting with `:` are comments (heartbeats).
 * - `field: value` — a single leading space after the colon is stripped.
 * - `id:` sets the last event id.
 * - `event:` sets the event type.
 * - `data:` appends a line (multiple `data:` lines joined with `\n`).
 * - `retry:` is recognized but not acted on (transport manages its own backoff).
 * - Unknown fields are ignored.
 *
 * This is a low-level parser that knows nothing about ChatEvent or JSON. The
 * caller is responsible for JSON.parsing `frame.data`.
 */

/** A complete SSE frame as parsed from the stream. */
export interface SseFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
}

export class SseFrameParser {
  private buffer = '';
  private id: string | undefined;
  private eventType: string | undefined;
  private dataLines: string[] = [];

  /**
   * Feed a decoded text chunk. Returns zero or more complete frames.
   * Partial lines are retained in the internal buffer until the next feed.
   */
  feed(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];

    let newlineIndex: number = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');

      const frame = this.processLine(rawLine);
      if (frame !== null) {
        frames.push(frame);
      }
    }

    return frames;
  }

  /** Reset accumulated state (called between reconnections). */
  reset(): void {
    this.buffer = '';
    this.id = undefined;
    this.eventType = undefined;
    this.dataLines = [];
  }

  private processLine(rawLine: string): SseFrame | null {
    // Normalize CR LF to LF by stripping a trailing CR.
    const line =
      rawLine.length > 0 && rawLine.charCodeAt(rawLine.length - 1) === 13
        ? rawLine.slice(0, -1)
        : rawLine;

    if (line === '') {
      return this.dispatchFrame();
    }

    if (line.startsWith(':')) {
      return null; // comment / heartbeat
    }

    const colonIndex = line.indexOf(':');
    let field: string;
    let value: string;
    if (colonIndex === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colonIndex);
      value = line.slice(colonIndex + 1);
      // Strip a single leading space per the SSE spec.
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
    }

    switch (field) {
      case 'id':
        this.id = value;
        break;
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'retry':
        // Recognized but not used; transport manages its own backoff.
        break;
      default:
        // Unknown field — ignore per spec.
        break;
    }

    return null;
  }

  private dispatchFrame(): SseFrame | null {
    if (this.dataLines.length === 0) {
      // Event with no data — reset accumulators without dispatching.
      this.id = undefined;
      this.eventType = undefined;
      return null;
    }

    const data = this.dataLines.join('\n');
    const frame = buildSseFrame(data, this.id, this.eventType);

    // Reset per-frame accumulators. The `id` field persists across dispatches
    // per the SSE spec (it becomes the Last-Event-ID for reconnection), but we
    // clear the event type and data lines.
    this.eventType = undefined;
    this.dataLines = [];

    return frame;
  }
}

/**
 * Build a frame, conditionally including optional fields to satisfy
 * exactOptionalPropertyTypes.
 */
function buildSseFrame(
  data: string,
  id: string | undefined,
  event: string | undefined,
): SseFrame {
  if (id !== undefined && event !== undefined) {
    return { id, event, data };
  }
  if (id !== undefined) {
    return { id, data };
  }
  if (event !== undefined) {
    return { event, data };
  }
  return { data };
}

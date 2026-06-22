import { describe, expect, it } from 'vitest';

import { SseFrameParser } from './sse-frame-parser';

describe('SseFrameParser', () => {
  it('parses a single complete frame', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('data: {"hello":"world"}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('{"hello":"world"}');
  });

  it('parses id, event, and data fields', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('id: evt_42\nevent: message\ndata: payload\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.id).toBe('evt_42');
    expect(frames[0]?.event).toBe('message');
    expect(frames[0]?.data).toBe('payload');
  });

  it('joins multiple data lines with newline', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('data: line1\ndata: line2\ndata: line3\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('line1\nline2\nline3');
  });

  it('handles frames split across multiple feed() calls', () => {
    const parser = new SseFrameParser();
    const part1 = parser.feed('data: {"part":');
    expect(part1).toHaveLength(0); // incomplete

    const part2 = parser.feed('"one"}\n\n');
    expect(part2).toHaveLength(1);
    expect(part2[0]?.data).toBe('{"part":"one"}');
  });

  it('parses multiple frames in a single chunk', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('id: a\ndata: first\n\nid: b\ndata: second\n\n');
    expect(frames).toHaveLength(2);
    expect(frames[0]?.id).toBe('a');
    expect(frames[0]?.data).toBe('first');
    expect(frames[1]?.id).toBe('b');
    expect(frames[1]?.data).toBe('second');
  });

  it('ignores comment lines (starting with colon)', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed(': heartbeat\ndata: real\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('real');
  });

  it('handles CR LF line endings', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('id: evt\r\ndata: payload\r\n\r\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.id).toBe('evt');
    expect(frames[0]?.data).toBe('payload');
  });

  it('does not dispatch frames with no data lines', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('id: orphan\n\n');
    expect(frames).toHaveLength(0);
  });

  it('strips a single leading space after the colon', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('data: spaced\n\n');
    expect(frames[0]?.data).toBe('spaced');

    const parser2 = new SseFrameParser();
    const frames2 = parser2.feed('data:nospace\n\n');
    expect(frames2[0]?.data).toBe('nospace');
  });

  it('recognizes the retry field without error', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('retry: 3000\ndata: hello\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('hello');
  });

  it('ignores unknown fields', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('unknownfield: value\ndata: real\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('real');
  });

  it('handles a field with no colon', () => {
    const parser = new SseFrameParser();
    const frames = parser.feed('data\n\n');
    // 'data' with no colon → field='data', value=''
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('');
  });

  it('reset() clears accumulated state', () => {
    const parser = new SseFrameParser();
    parser.feed('id: partial\ndata: incomplete');
    parser.reset();
    const frames = parser.feed('data: fresh\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.id).toBeUndefined();
    expect(frames[0]?.data).toBe('fresh');
  });
});

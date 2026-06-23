/**
 * LIVE integration tests for ChatTransport against a running rusty-crew service.
 *
 * Unlike the mocked unit tests, these hit the real backend at
 * http://127.0.0.1:9347. They are skipped automatically if the service is not
 * reachable, so they can sit in the suite without breaking CI on hosts without
 * the backend co-located.
 *
 * Run explicitly: `pnpm exec vitest run --testNamePattern=LIVE libs/transport`
 * (or just `pnpm exec nx test transport` when the backend is up).
 */
import { describe, expect, it } from 'vitest';

import { ChatTransport } from './chat-transport';
import type { ChatEvent } from '@rusty-view/protocol';

const BACKEND_URL = 'http://127.0.0.1:9347';
const BACKEND_REACHABLE = await checkBackend();

async function checkBackend(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/v1/chat/sessions`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const describeLive = BACKEND_REACHABLE ? describe : describe.skip;

describeLive('ChatTransport LIVE against rusty-crew', () => {
  const transport = new ChatTransport({ baseUrl: BACKEND_URL });

  it('listSessions returns real sessions', async () => {
    const page = await transport.listSessions();
    expect(page.items.length).toBeGreaterThan(0);
    const first = page.items[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(typeof first.session_id).toBe('string');
      expect(first.kind).toMatch(/^(full|worker|delegated)$/);
    }
  });

  it('listCommands returns the command registry', async () => {
    const registry = await transport.listCommands();
    expect(registry.commands.length).toBeGreaterThan(0);
    const names = registry.commands.map((c) => c.name);
    expect(names).toContain('new');
    expect(names).toContain('status');
  });

  it('openSession returns a session snapshot with events + cursor', async () => {
    const page = await transport.listSessions();
    const target = page.items[0];
    if (target === undefined) return; // no sessions to test
    const result = await transport.openSession(target.session_id);
    expect(result.session.session_id).toBe(target.session_id);
    expect(typeof result.latest_cursor).toBe('string');
    expect(Array.isArray(result.events)).toBe(true);
  });

  it('replayEvents returns an event array', async () => {
    const page = await transport.listSessions();
    const target = page.items[0];
    if (target === undefined) return;
    const events = await transport.replayEvents(target.session_id);
    expect(Array.isArray(events)).toBe(true);
    for (const event of events) {
      expect(event.event_id).toBeDefined();
      expect(event.session_id).toBe(target.session_id);
    }
  });

  it('streamEvents yields real SSE events (or cleanly closes)', async () => {
    const page = await transport.listSessions();
    // Find an active session to stream, or fall back to the first.
    const target =
      page.items.find((s) => s.status === 'active') ?? page.items[0];
    if (target === undefined) return;

    const stream = transport.streamEvents(target.session_id, {
      // Override sleep for instant reconnect in tests.
      sleep: () => Promise.resolve(),
    });

    const events: ChatEvent[] = [];
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3_000));

    await Promise.race([
      (async () => {
        for await (const event of stream.events()) {
          events.push(event);
          if (events.length >= 1) break;
        }
      })(),
      timeout,
    ]);
    stream.close();

    // Either we got events, or the stream connected and idled (both valid).
    expect(stream.getState().status === 'connected' || events.length > 0).toBe(
      true,
    );
  });
});

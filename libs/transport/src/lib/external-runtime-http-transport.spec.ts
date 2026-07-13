import { describe, expect, it, vi } from 'vitest';
import { ExternalRuntimeEventStream } from './external-runtime-event-stream';
import { ExternalRuntimeHttpTransport } from './external-runtime-http-transport';

describe('ExternalRuntimeHttpTransport', () => {
  it('creates an external agent session through the browser-safe endpoint', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/external-agent-sessions',
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          idempotencyKey: 'view-create-1',
          runtimeId: 'runtime-1',
          profileId: 'tester',
          cwd: '/home/dev/rusty-view',
          taskRef: { project_id: 'rusty-crew', task_id: '5675' },
        });
        return json({
          ok: true,
          data: { creation: { phase: 'ready' }, runtime: {}, thread: {} },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(
      transport.createAgentSession({
        idempotencyKey: 'view-create-1',
        runtimeId: 'runtime-1',
        profileId: 'tester',
        cwd: '/home/dev/rusty-view',
        taskRef: { project_id: 'rusty-crew', task_id: '5675' },
      }),
    ).resolves.toMatchObject({ creation: { phase: 'ready' } });
  });

  it('uses generated endpoint shapes for fleets, pagination, and controls', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('/threads')) {
          return json({
            ok: true,
            data: { items: [], nextCursor: null, backwardsCursor: null },
            meta: meta(),
          });
        }
        if (url.includes('/controls')) {
          const request = JSON.parse(String(init?.body)) as { kind: string };
          expect(request.kind).toBe('interrupt_turn');
          return json({
            ok: true,
            data: {
              request: {
                bindingId: 'b',
                controlId: 'c',
                expectedBindingRevision: 1,
                idempotencyKey: 'i',
                kind: 'interrupt_turn',
                payload: {},
                requestedAt: '',
              },
              requestFingerprint: 'f',
              revision: 1,
              status: 'applied',
              updatedAt: '',
            },
            meta: meta(),
          });
        }
        return json({
          ok: true,
          data: { runtimes: [], controllers: [] },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(transport.listRuntimes()).resolves.toEqual({
      runtimes: [],
      controllers: [],
    });
    await expect(
      transport.listThreads('runtime/a', {
        limit: 100,
        cursor: 'next',
        archived: true,
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      transport.submitControl('b', { kind: 'interrupt_turn', payload: {} }),
    ).resolves.toMatchObject({ status: 'applied' });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('runtime%2Fa');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('archived=true');
  });

  it('uses the generated native thread lifecycle routes', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const action = new URL(String(input)).pathname.split('/').at(-1);
        return json({
          ok: true,
          data: {
            runtimeId: 'runtime/a',
            threadId: 'thread/b',
            action,
            outcome: 'applied',
            ...(action === 'delete'
              ? { nativeDeleted: true }
              : { nativeArchived: action === 'archive' }),
            bindings: [],
          },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await transport.archiveThread('runtime/a', 'thread/b');
    await transport.unarchiveThread('runtime/a', 'thread/b');
    await transport.deleteThread('runtime/a', 'thread/b');

    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      'http://crew.test/v1/external-runtimes/runtime%2Fa/threads/thread%2Fb/archive',
      'http://crew.test/v1/external-runtimes/runtime%2Fa/threads/thread%2Fb/unarchive',
      'http://crew.test/v1/external-runtimes/runtime%2Fa/threads/thread%2Fb/delete',
    ]);
  });

  it('lists and executes commands through the encoded external binding route', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/external-bindings/binding%2Fone/commands',
        );
        if (init?.method === 'GET') {
          return json({
            ok: true,
            data: { commands: [], settings: {}, models: [] },
            meta: meta(),
          });
        }
        expect(JSON.parse(String(init?.body))).toEqual({
          input: '/status',
          idempotencyKey: 'view-command-1',
          expectedBindingRevision: 7,
        });
        return json({
          ok: true,
          data: {
            commandId: 'command-1',
            input: '/status',
            command: 'status',
            argument: null,
            status: 'applied',
            reasonCode: null,
            message: 'Runtime ready',
            result: {},
            receipt: {},
          },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await transport.listCommands('binding/one');
    await expect(
      transport.executeCommand('binding/one', {
        input: '/status',
        idempotencyKey: 'view-command-1',
        expectedBindingRevision: 7,
      }),
    ).resolves.toMatchObject({ status: 'applied', command: 'status' });
  });

  it('reconnects an external event stream from its last sequence cursor', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sse([externalEvent(7)]))
      .mockResolvedValueOnce(sse([externalEvent(8)]));
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));
    const stream = new ExternalRuntimeEventStream(transport, 'runtime/a');
    const received = [];

    for await (const event of stream.events()) {
      received.push(event.sequenceId);
      if (received.length === 2) stream.close();
    }

    expect(received).toEqual([7, 8]);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('cursor=7');
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get('Last-Event-ID'),
    ).toBe('7');
  });
});

function config(fetchImpl: typeof fetch) {
  return {
    baseUrl: 'http://crew.test',
    timeoutMs: 1_000,
    writeTimeoutMs: 1_000,
    reconnectInitialMs: 0,
    reconnectMaxMs: 0,
    reconnectMaxAttempts: 1,
    fetchImpl,
  };
}
function meta() {
  return { request_id: 'req', schema_version: 1 };
}
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sse(events: readonly object[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function externalEvent(sequenceId: number) {
  return {
    eventId: `event-${sequenceId}`,
    runtimeId: 'runtime/a',
    sequenceId,
    createdAt: '2026-07-11T00:00:00Z',
    kind: 'turn_lifecycle',
    nativeThreadId: 'thread-1',
    nativeTurnId: 'turn-1',
    payload: { nativeMethod: 'turn/started', status: 'inProgress' },
  };
}

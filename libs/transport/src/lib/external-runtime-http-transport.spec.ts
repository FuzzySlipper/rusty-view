import { describe, expect, it, vi } from 'vitest';
import { ChatTransportError } from './chat-transport-error';
import { ExternalRuntimeEventStream } from './external-runtime-event-stream';
import { ExternalRuntimeHttpTransport } from './external-runtime-http-transport';

describe('ExternalRuntimeHttpTransport', () => {
  it('preserves typed Crew failure details and the external endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          ok: false,
          error: {
            code: 'conflict',
            reason_code: 'external_turn_not_active',
            message: 'The expected turn is no longer active.',
            retryable: false,
          },
          meta: meta(),
        },
        409,
      ),
    );
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    const failure = await transport
      .submitControl('binding/1', { kind: 'steer_turn', payload: {} })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatTransportError);
    expect(failure).toMatchObject({
      code: 'http_error',
      statusCode: 409,
      endpoint: '/v1/external-bindings/binding%2F1/controls',
      apiError: {
        reason_code: 'external_turn_not_active',
        retryable: false,
      },
    });
  });

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

  it('writes explicit nullable binding metadata through the encoded route', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/external-bindings/binding%2Fone/metadata',
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          expectedRevision: 4,
          label: null,
          taskRef: { project_id: 'rusty-crew', task_id: '5764' },
        });
        return json({
          ok: true,
          data: {
            bindingId: 'binding/one',
            runtimeId: 'runtime-1',
            purpose: 'crew_agent',
            status: 'active',
            effectiveConfigFingerprint: 'config',
            revision: 5,
            createdAt: '',
            updatedAt: '',
            label: null,
            taskRef: { project_id: 'rusty-crew', task_id: '5764' },
          },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(
      transport.updateBindingMetadata('binding/one', {
        expectedRevision: 4,
        label: null,
        taskRef: { project_id: 'rusty-crew', task_id: '5764' },
      }),
    ).resolves.toMatchObject({ revision: 5, label: null });
  });

  it('restores one exact archived binding through the revision-guarded route', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/external-bindings/binding%2Farchived/restore',
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          expectedBindingRevision: 4,
          expectedSessionId: 'session-1',
          expectedAgentId: 'agent-1',
          expectedProfileId: 'profile-1',
          expectedNativeThreadId: 'thread-1',
        });
        return json({
          ok: true,
          data: {
            outcome: 'restored',
            profileRevisionUpdated: true,
            binding: {
              bindingId: 'binding/archived',
              runtimeId: 'runtime-1',
              nativeThreadId: 'thread-1',
              sessionId: 'session-1',
              agentId: 'agent-1',
              profileId: 'profile-1',
              purpose: 'crew_agent',
              status: 'active',
              effectiveConfigFingerprint: 'config',
              revision: 5,
              createdAt: '',
              updatedAt: '',
            },
            session: { session_id: 'session-1', status: 'idle' },
          },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(
      transport.restoreBinding('binding/archived', {
        expectedBindingRevision: 4,
        expectedSessionId: 'session-1',
        expectedAgentId: 'agent-1',
        expectedProfileId: 'profile-1',
        expectedNativeThreadId: 'thread-1',
      }),
    ).resolves.toMatchObject({
      outcome: 'restored',
      binding: { revision: 5, status: 'active' },
    });
  });

  it('refreshes an external binding profile through the generated concurrency contract', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/external-bindings/binding%2Fstale/profile-refresh',
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          expectedBindingRevision: 4,
          expectedNativeThreadId: 'thread-old',
          expectedProfileRevision: 19,
          expectedProfilePromptHash: 'a'.repeat(64),
        });
        return json({
          ok: true,
          data: {
            outcome: 'thread_replaced',
            binding: {
              bindingId: 'binding-fresh',
              runtimeId: 'runtime-1',
              nativeThreadId: 'thread-fresh',
              sessionId: 'session-fresh',
              agentId: 'agent-fresh',
              profileId: 'reviewer',
              purpose: 'crew_agent',
              status: 'active',
              effectiveConfigFingerprint: 'config',
              revision: 1,
              createdAt: '',
              updatedAt: '',
            },
            previousNativeThreadId: 'thread-old',
            nativeThreadId: 'thread-fresh',
            previousNativeThreadArchived: true,
            profileState: {
              bindingId: 'binding-fresh',
              profileId: 'reviewer',
              state: 'current',
              refreshRequired: false,
              appliedProfileRevision: 19,
              appliedPromptHash: 'a'.repeat(64),
              currentProfileRevision: 19,
              currentPromptHash: 'a'.repeat(64),
            },
          },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(
      transport.refreshBindingProfile('binding/stale', {
        expectedBindingRevision: 4,
        expectedNativeThreadId: 'thread-old',
        expectedProfileRevision: 19,
        expectedProfilePromptHash: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({
      outcome: 'thread_replaced',
      binding: { bindingId: 'binding-fresh' },
    });
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

  it('reads the external runtime event head without replaying history', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/external-runtimes/runtime%2Fa/events/head',
        );
        return json({
          ok: true,
          data: { event: externalEvent(1_000_000) },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(transport.readEventHead('runtime/a')).resolves.toMatchObject({
      event: { sequenceId: 1_000_000 },
    });
  });

  it('bounds a never-settling bootstrap request and reports a timeout', async () => {
    const { fetch, lastSignal } = signalHonoringFetch(
      50,
      json({ event: externalEvent(1_000_000) }),
    );
    const transport = new ExternalRuntimeHttpTransport(
      config(fetch, { timeoutMs: 5 }),
    );

    await expect(transport.readEventHead('runtime/a')).rejects.toMatchObject({
      code: 'network_error',
      message: 'Request timed out',
    });
    expect(lastSignal()?.aborted).toBe(true);
  });

  it('bounds a response body that never completes', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => {
        signal = init?.signal;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise<unknown>(() => undefined),
        } as Response);
      });
    const transport = new ExternalRuntimeHttpTransport(
      config(fetchImpl, { timeoutMs: 5 }),
    );

    await expect(transport.readEventHead('runtime/a')).rejects.toMatchObject({
      code: 'network_error',
      message: 'Request timed out',
    });
    expect(signal?.aborted).toBe(true);
  });

  it('translates malformed JSON into an actionable bounded response error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      }),
    } as unknown as Response);
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(
      transport.readThread('runtime/a', {
        threadId: 'thread/b',
        includeTurns: true,
        limit: 50,
      }),
    ).rejects.toMatchObject({
      code: 'response_parse_error',
      statusCode: 200,
      endpoint: '/v1/external-runtimes/runtime%2Fa/threads/read',
      message: expect.stringContaining('incomplete or malformed JSON'),
      retryable: true,
    });
  });

  it('sends the generated backward turn cursor in bounded thread reads', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/external-runtimes/runtime%2Fa/threads/read',
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          threadId: 'thread/b',
          includeTurns: true,
          limit: 50,
          beforeCursor: 'turn-cursor-50',
        });
        return json({
          ok: true,
          data: {
            thread: { threadId: 'thread/b', turns: [] },
            turnPage: {
              limit: 50,
              hasMoreBefore: false,
              beforeCursor: 'turn-cursor-50',
              pageStartCursor: 'turn-cursor-1',
              pageEndCursor: 'turn-cursor-49',
            },
          },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await expect(
      transport.readThread('runtime/a', {
        threadId: 'thread/b',
        includeTurns: true,
        limit: 50,
        beforeCursor: 'turn-cursor-50',
      }),
    ).resolves.toMatchObject({
      turnPage: { pageStartCursor: 'turn-cursor-1' },
    });
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
  it('uses role-bound review operator reads and revision-guarded writes', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        calls.push({
          url: String(input),
          method: String(init?.method),
          ...(init?.body === undefined
            ? {}
            : { body: JSON.parse(String(init.body)) }),
        });
        if (String(input).includes('/pipeline')) {
          return json({
            ok: true,
            data: {
              projectId: 'rusty-view',
              deploymentRole: 'debug',
              limit: 25,
              offset: 0,
              items: [],
            },
            meta: meta(),
          });
        }
        if (init?.method === 'PATCH') {
          return json({
            ok: true,
            data: {
              status: 'updated',
              config: reviewConfig(),
              applyResult: {},
            },
            meta: meta(),
          });
        }
        return json({ ok: true, data: reviewConfig(), meta: meta() });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));

    await transport.readReviewOperatorConfig('debug');
    await transport.readReviewOperatorPipeline({
      projectId: 'rusty-view',
      limit: 25,
      expectedDeploymentRole: 'debug',
    });
    await transport.writeReviewOperatorConfig({
      expectedConfigRevision: 'revision-1',
      authorityId: 'den',
      endpointRef: 'config://mcp/den',
      expectedDeploymentRole: 'debug',
    });

    expect(calls[0]?.url).toContain('expectedDeploymentRole=debug');
    expect(calls[1]?.url).toContain('projectId=rusty-view');
    expect(calls[2]).toMatchObject({
      method: 'PATCH',
      body: { expectedConfigRevision: 'revision-1' },
    });
  });

  it('sends the manual prompt only through the explicit receipt endpoint', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          'http://crew.test/v1/admin/review-operator/tasks/6854/prompt-reviewer',
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          ttlMs: 300000,
          correlationId: 'correlation',
          idempotencyKey: 'idem',
          expectedDeploymentRole: 'production',
        });
        return json({
          ok: true,
          data: {
            deploymentRole: 'production',
            command: 'review 6854',
            target: '@reviewer',
            receipt: { status: 'accepted' },
          },
          meta: meta(),
        });
      });
    const transport = new ExternalRuntimeHttpTransport(config(fetchImpl));
    await expect(
      transport.promptReviewerForTask(6854, {
        ttlMs: 300000,
        correlationId: 'correlation',
        idempotencyKey: 'idem',
        expectedDeploymentRole: 'production',
      }),
    ).resolves.toMatchObject({ command: 'review 6854', target: '@reviewer' });
  });
});

function reviewConfig() {
  return {
    configRevision: 'revision-1',
    deploymentRole: 'debug',
    serverName: 'den',
    toolProfileKey: 'direct',
    credential: { present: false, source: 'none' },
    diagnostics: {
      serverName: 'den',
      status: 'ready',
      requiredTools: [],
      missingTools: [],
      checkedAt: '2026-08-12T00:00:00Z',
      message: 'ready',
    },
    reviewerRoute: {
      address: '@reviewer',
      routable: true,
      resolvedTarget: {
        agentId: 'reviewer',
        displayLabel: 'Reviewer',
        profileId: 'reviewer',
        runtimeKind: 'codex_app_server',
        sessionId: 'reviewer-session',
      },
    },
  } as const;
}

function config(
  fetchImpl: typeof fetch,
  overrides: {
    readonly timeoutMs?: number;
    readonly writeTimeoutMs?: number;
  } = {},
) {
  return {
    baseUrl: 'http://crew.test',
    timeoutMs: overrides.timeoutMs ?? 1_000,
    writeTimeoutMs: overrides.writeTimeoutMs ?? 1_000,
    reconnectInitialMs: 0,
    reconnectMaxMs: 0,
    reconnectMaxAttempts: 1,
    fetchImpl,
  };
}

function signalHonoringFetch(
  delayMs: number,
  response: Response,
): { fetch: typeof fetch; lastSignal: () => AbortSignal | undefined } {
  let signal: AbortSignal | undefined;
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(response), delayMs);
      if (signal === undefined) return;
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal?.reason);
      });
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, lastSignal: () => signal };
}
function meta() {
  return { request_id: 'req', schema_version: 1 };
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
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

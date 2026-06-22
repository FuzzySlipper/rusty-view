import { describe, expect, it } from 'vitest';

import { TRANSPORT_VERSION } from '../index';
import { resolveChatTransportConfig } from './chat-transport-config';

describe('@rusty-view/transport package version', () => {
  it('exports a version marker', () => {
    expect(TRANSPORT_VERSION).toBe('0.0.0');
  });
});

describe('resolveChatTransportConfig', () => {
  it('fills defaults for optional fields', () => {
    const config = resolveChatTransportConfig({
      baseUrl: 'http://localhost:9347',
    });
    expect(config.baseUrl).toBe('http://localhost:9347');
    expect(config.timeoutMs).toBeGreaterThan(0);
    expect(config.reconnectInitialMs).toBeGreaterThanOrEqual(0);
    expect(config.reconnectMaxMs).toBeGreaterThanOrEqual(
      config.reconnectInitialMs,
    );
    expect(config.reconnectMaxAttempts).toBeGreaterThanOrEqual(1);
    expect(config.bearerToken).toBeUndefined();
    expect(config.fetchImpl).toBeUndefined();
  });

  it('accepts a bearer token', () => {
    const config = resolveChatTransportConfig({
      baseUrl: 'http://localhost:9347',
      bearerToken: 'my-token',
    });
    expect(config.bearerToken).toBe('my-token');
  });

  it('rejects an empty bearer token', () => {
    expect(() =>
      resolveChatTransportConfig({
        baseUrl: 'http://localhost:9347',
        bearerToken: '   ',
      }),
    ).toThrow();
  });

  it('rejects an invalid baseUrl', () => {
    expect(() =>
      resolveChatTransportConfig({ baseUrl: 'not-a-url' }),
    ).toThrow();
    expect(() =>
      resolveChatTransportConfig({ baseUrl: 'ftp://bad' }),
    ).toThrow();
  });

  it('strips trailing slash from baseUrl', () => {
    const config = resolveChatTransportConfig({
      baseUrl: 'http://localhost:9347/',
    });
    expect(config.baseUrl).toBe('http://localhost:9347');
  });

  it('rejects reconnectMaxMs < reconnectInitialMs', () => {
    expect(() =>
      resolveChatTransportConfig({
        baseUrl: 'http://localhost:9347',
        reconnectInitialMs: 1000,
        reconnectMaxMs: 500,
      }),
    ).toThrow();
  });
});

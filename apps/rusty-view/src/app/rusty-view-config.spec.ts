import {
  deriveBaseUrlFromLocationParts,
  resolveRustyViewConfig,
  type RustyViewRuntimeWindow,
} from './rusty-view-config';

describe('deriveBaseUrlFromLocationParts', () => {
  it('uses the live service origin when the app is served from 9347', () => {
    expect(
      deriveBaseUrlFromLocationParts({
        origin: 'http://den-k8:9347',
        port: '9347',
        protocol: 'http:',
        hostname: 'den-k8',
      }),
    ).toBe('http://den-k8:9347');
  });

  it('uses the debug service origin when the app is served from 9348', () => {
    expect(
      deriveBaseUrlFromLocationParts({
        origin: 'http://den-k8:9348',
        port: '9348',
        protocol: 'http:',
        hostname: 'den-k8',
      }),
    ).toBe('http://den-k8:9348');
  });

  it.each([
    ['implicit TLS', 'https://proxy.example', '', 'https:'],
    ['explicit TLS', 'https://proxy.example:443', '443', 'https:'],
    ['implicit HTTP', 'http://proxy.example', '', 'http:'],
    ['explicit HTTP', 'http://proxy.example:80', '80', 'http:'],
  ])('uses the serving origin for %s', (_label, origin, port, protocol) => {
    expect(
      deriveBaseUrlFromLocationParts({
        origin,
        port,
        protocol,
        hostname: 'proxy.example',
      }),
    ).toBe(origin);
  });

  it.each(['4200', '4210'])(
    'maps the recognized HTTP dev-server port %s to the live backend',
    (port) => {
      expect(
        deriveBaseUrlFromLocationParts({
          origin: `http://den-k8:${port}`,
          port,
          protocol: 'http:',
          hostname: 'den-k8',
        }),
      ).toBe('http://den-k8:9347');
    },
  );

  it('keeps an unknown custom port same-origin', () => {
    expect(
      deriveBaseUrlFromLocationParts({
        origin: 'http://den-k8:4321',
        port: '4321',
        protocol: 'http:',
        hostname: 'den-k8',
      }),
    ).toBe('http://den-k8:4321');
  });

  it('does not treat an HTTPS service on a dev port as the split HTTP topology', () => {
    expect(
      deriveBaseUrlFromLocationParts({
        origin: 'https://proxy.example:4200',
        port: '4200',
        protocol: 'https:',
        hostname: 'proxy.example',
      }),
    ).toBe('https://proxy.example:4200');
  });
});

describe('resolveRustyViewConfig', () => {
  it('prefers a non-empty query override over injected and derived bases', () => {
    expect(
      resolveRustyViewConfig(
        runtimeWindow('?api=https%3A%2F%2Fquery.example', {
          baseUrl: 'https://injected.example',
          bearerToken: 'secret',
        }),
      ),
    ).toEqual({
      baseUrl: 'https://query.example',
      bearerToken: 'secret',
    });
  });

  it('uses an injected base before location derivation', () => {
    expect(
      resolveRustyViewConfig(
        runtimeWindow('', { baseUrl: 'https://injected.example' }),
      ),
    ).toEqual({ baseUrl: 'https://injected.example' });
  });

  it('falls back from an empty query override to injected configuration', () => {
    expect(
      resolveRustyViewConfig(
        runtimeWindow('?api=%20', { baseUrl: 'https://injected.example' }),
      ),
    ).toEqual({ baseUrl: 'https://injected.example' });
  });

  it('derives the base from location when no explicit configuration exists', () => {
    expect(resolveRustyViewConfig(runtimeWindow(''))).toEqual({
      baseUrl: 'https://proxy.example',
    });
  });
});

function runtimeWindow(
  search: string,
  config?: RustyViewRuntimeWindow['__RUSTY_VIEW_CONFIG__'],
): RustyViewRuntimeWindow {
  return {
    location: {
      origin: 'https://proxy.example',
      port: '',
      protocol: 'https:',
      hostname: 'proxy.example',
      search,
    },
    ...(config === undefined ? {} : { __RUSTY_VIEW_CONFIG__: config }),
  };
}

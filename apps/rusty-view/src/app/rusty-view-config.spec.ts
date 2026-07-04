import { deriveBaseUrlFromLocationParts } from './rusty-view-config';

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

  it('maps non-service frontend ports to the default live backend port', () => {
    expect(
      deriveBaseUrlFromLocationParts({
        origin: 'http://den-k8:4321',
        port: '4321',
        protocol: 'http:',
        hostname: 'den-k8',
      }),
    ).toBe('http://den-k8:9347');
  });
});

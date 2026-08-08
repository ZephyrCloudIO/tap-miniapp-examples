import { afterEach, describe, expect, it } from '@rstest/core';
import { isLocalWranglerOrigin, tapRest } from './http';

const SDK_SYMBOL = Symbol.for('tap.internal.v1');

function installFakeHttp() {
  const calls: Array<{ input: unknown; options: unknown }> = [];
  (globalThis as Record<PropertyKey, unknown>)[SDK_SYMBOL] = {
    http: {
      request(input: unknown, options: unknown) {
        calls.push({ input, options });
        return Promise.resolve({
          status: 200,
          bodyText: '{}',
        });
      },
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[SDK_SYMBOL];
});

describe('TAP HTTP session credentials', () => {
  it('omits the platform credential only for an exact explicit loopback origin', async () => {
    const calls = installFakeHttp();
    await tapRest('http://127.0.0.1:8787')('/rooms', { method: 'GET' });
    expect(calls[0]?.options).toBeUndefined();
  });

  it.each([
    'http://127.0.0.1',
    'http://127.0.0.1:8787/api',
    'https://127.0.0.1:8787',
    'http://localhost:8787',
    'https://tap-kart-royale-server-production.example.com',
  ])('keeps platform credentials for %s', async (serverUrl) => {
    const calls = installFakeHttp();
    await tapRest(serverUrl)('/rooms', { method: 'GET' });
    expect(calls[0]?.options).toEqual({ credentialRef: 'platform-session' });
  });

  it('recognizes a single trailing slash on the local origin', () => {
    expect(isLocalWranglerOrigin('http://127.0.0.1:8787/')).toBe(true);
  });
});

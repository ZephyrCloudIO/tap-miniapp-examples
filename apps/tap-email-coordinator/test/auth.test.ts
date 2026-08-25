import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyPlatformSession } from '../src/auth';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('platform session verification', () => {
  it('turns introspection transport failures into a bounded service error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('Timed out', 'TimeoutError');
    });
    const testEnv = Object.create(env) as Env;
    Object.defineProperty(testEnv, 'TAP_INTROSPECTION_URL', {
      value: 'https://identity.example/introspect',
    });
    await expect(verifyPlatformSession(
      new Request('https://coordinator.example/v1/mailbox', {
        headers: { Authorization: 'Bearer session-token' },
      }),
      testEnv,
    )).rejects.toMatchObject({
      status: 503,
      code: 'introspection_unavailable',
    });
  });
});

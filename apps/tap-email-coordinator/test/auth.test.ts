import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  tapEmailSessionAudience,
  verifyPlatformSession,
} from '../src/auth';

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
      'tap-email.view',
    )).rejects.toMatchObject({
      status: 503,
      code: 'introspection_unavailable',
    });
  });

  it('binds introspection to the package audience and requested action', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.body).toBe(JSON.stringify({
        audience: tapEmailSessionAudience,
        requiredAction: 'tap-email.manage',
      }));
      return Response.json({
        active: true,
        profileId: 'profile_1',
        audience: tapEmailSessionAudience,
        grantedActions: ['tap-email.view', 'tap-email.manage'],
      });
    });
    const testEnv = Object.create(env) as Env;
    Object.defineProperty(testEnv, 'TAP_INTROSPECTION_URL', {
      value: 'https://identity.example/introspect',
    });

    await expect(verifyPlatformSession(
      new Request('https://coordinator.example/v1/commands', {
        method: 'POST',
        headers: { Authorization: 'Bearer session-token' },
      }),
      testEnv,
      'tap-email.manage',
    )).resolves.toEqual({ profileId: 'profile_1' });
  });

  it.each([
    {
      name: 'the requested action is absent',
      response: {
        active: true,
        profileId: 'profile_1',
        audience: tapEmailSessionAudience,
        grantedActions: ['tap-email.view'],
      },
    },
    {
      name: 'the audience does not match',
      response: {
        active: true,
        profileId: 'profile_1',
        audience: 'another-package',
        grantedActions: ['tap-email.manage'],
      },
    },
    {
      name: 'the grants are omitted',
      response: {
        active: true,
        profileId: 'profile_1',
        audience: tapEmailSessionAudience,
      },
    },
  ])('fails closed when $name', async ({ response }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(response));
    const testEnv = Object.create(env) as Env;
    Object.defineProperty(testEnv, 'TAP_INTROSPECTION_URL', {
      value: 'https://identity.example/introspect',
    });

    await expect(verifyPlatformSession(
      new Request('https://coordinator.example/v1/commands', {
        method: 'POST',
        headers: { Authorization: 'Bearer session-token' },
      }),
      testEnv,
      'tap-email.manage',
    )).rejects.toMatchObject({ status: 403, code: 'session_denied' });
  });

  it('preserves an explicit local-development grant', async () => {
    const testEnv = Object.create(env) as Env;
    Object.defineProperties(testEnv, {
      ALLOW_DEV_IDENTITY: { value: 'true' },
      TAP_INTROSPECTION_URL: { value: '' },
    });

    await expect(verifyPlatformSession(
      new Request('http://localhost:8787/v1/commands', {
        method: 'POST',
        headers: { 'X-TAP-Dev-Profile': 'profile_1' },
      }),
      testEnv,
      'tap-email.manage',
    )).resolves.toEqual({ profileId: 'profile_1' });
  });
});

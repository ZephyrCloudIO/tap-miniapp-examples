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
  it.each([429, 500, 503])('distinguishes authority unavailability from denial for HTTP %i', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
    await expect(verifyPlatformSession(
      new Request('https://coordinator.example/v1/commands', {
        method: 'POST', headers: { Authorization: 'Bearer session-token' },
      }),
      { ...env, TAP_INTROSPECTION_URL: 'https://identity.example/introspect' },
      'tap-email.manage',
    )).rejects.toMatchObject({ status: 503, code: 'introspection_unavailable' });
  });

  it('turns introspection transport failures into a bounded service error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.redirect).toBe('manual');
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      // Exercise workerd's Request constructor: a fetch spy alone accepts
      // browser-only options such as redirect: 'error' that Workers reject.
      const outbound = new Request(input, init);
      expect(outbound.redirect).toBe('manual');
      expect(outbound.headers.get('Authorization')).toBe('Bearer session-token');
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

  it.each([301, 302, 303, 307, 308])('rejects HTTP %i without forwarding the session', async status => {
    const outboundRequests: Request[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      outboundRequests.push(new Request(input, init));
      return new Response(null, { status, headers: { Location: 'https://untrusted.example/session' } });
    });
    await expect(verifyPlatformSession(
      new Request('https://coordinator.example/v1/mailbox', {
        headers: { Authorization: 'Bearer session-token' },
      }),
      { ...env, TAP_INTROSPECTION_URL: 'https://identity.example/introspect' },
      'tap-email.view',
    )).rejects.toMatchObject({ status: 503, code: 'introspection_unavailable' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(outboundRequests).toHaveLength(1);
    expect(outboundRequests[0]?.redirect).toBe('manual');
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

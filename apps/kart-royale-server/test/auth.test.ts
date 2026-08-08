import { describe, expect, it } from 'vitest';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { resolveIdentity, verifyPlatformSessionToken } from '../src/auth';
import worker from '../src/index';

const ISSUER = 'https://dev-auth.zephyr-cloud.io/';
const AUDIENCE = 'https://api-dev.zephyr-cloud.io';

async function signedToken(claims: { sub: string; audience?: string }) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = 'RS256';
  publicJwk.kid = 'kart-royale-test-key';
  publicJwk.use = 'sig';
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .setIssuer(ISSUER)
    .setAudience(claims.audience ?? AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { token, keySet: createLocalJWKSet({ keys: [publicJwk] }) };
}

describe('platform-session JWT verification', () => {
  it('accepts a signed token for the configured issuer and audience', async () => {
    const { token, keySet } = await signedToken({ sub: 'auth0|kart-player' });

    await expect(
      verifyPlatformSessionToken(token, ISSUER, AUDIENCE, keySet),
    ).resolves.toBe('auth0|kart-player');
  });

  it('rejects a token issued for another audience', async () => {
    const { token, keySet } = await signedToken({
      sub: 'auth0|kart-player',
      audience: 'https://untrusted.example',
    });

    await expect(
      verifyPlatformSessionToken(token, ISSUER, AUDIENCE, keySet),
    ).resolves.toBeNull();
  });

  it('never downgrades a rejected bearer to body-authored dev identity', async () => {
    const env = {
      ALLOW_DEV_IDENTITY: 'true',
      TAP_JWT_ISSUER: '',
      TAP_JWT_AUDIENCE: '',
    } as Env;
    const request = new Request('https://worker.test/rooms', {
      headers: { authorization: 'Bearer invalid-platform-session' },
    });

    await expect(resolveIdentity(env, request, {
      userId: 'body-authored-user',
      channelId: 'channel-1',
      displayName: 'Kart Player',
    })).resolves.toBeNull();
  });

  it('keeps body-authored identity limited to explicit local development', async () => {
    const body = {
      userId: 'local-player',
      channelId: 'channel-1',
      displayName: 'Kart Player',
    };

    await expect(resolveIdentity(
      { ALLOW_DEV_IDENTITY: 'true' } as Env,
      new Request('https://worker.test/rooms'),
      body,
    )).resolves.toMatchObject({ via: 'dev', identity: body });
    await expect(resolveIdentity(
      { ALLOW_DEV_IDENTITY: 'false' } as Env,
      new Request('https://worker.test/rooms'),
      body,
    )).resolves.toBeNull();
  });

  it('requires an explicit ticket-signing secret even with the dev identity bypass', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'local-player',
          channelId: 'channel-1',
          displayName: 'Kart Player',
        }),
      }),
      { ALLOW_DEV_IDENTITY: 'true' } as Env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'ticket signing is not configured',
    });
  });
});

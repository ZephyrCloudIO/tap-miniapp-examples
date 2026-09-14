import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { coordinatorReadiness } from '../src/readiness';

function configuredEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ...overrides };
}

describe('coordinator readiness', () => {
  it('checks configuration and D1 without exposing secret values', async () => {
    await expect(coordinatorReadiness(configuredEnv())).resolves.toEqual({
      ready: true,
      configuration: true,
      database: true,
      issueCodes: [],
    });
  });

  it('rejects production identity and encryption misconfiguration', async () => {
    const readiness = await coordinatorReadiness(configuredEnv({
      ALLOW_DEV_IDENTITY: 'false',
      TAP_INTROSPECTION_URL: 'http://platform.invalid/introspect',
      GOOGLE_TOKEN_ENCRYPTION_KEY: 'not-a-key',
      ATTACHMENT_STAGING_ENCRYPTION_KEY: 'not-a-key',
    }));

    expect(readiness.ready).toBe(false);
    expect(readiness.configuration).toBe(false);
    expect(readiness.database).toBe(true);
    expect(readiness.issueCodes).toEqual([
      'invalid_introspection_url',
      'invalid_allowed_origins',
      'invalid_google_redirect_uri',
      'invalid_encryption_key',
      'invalid_attachment_staging_encryption_key',
    ]);
  });
});

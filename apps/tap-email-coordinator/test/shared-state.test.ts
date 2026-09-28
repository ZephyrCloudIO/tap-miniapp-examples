import { env } from 'cloudflare:workers';
import { beforeEach, expect, it } from 'vitest';
import { createTapEmailCoordinator } from '../src/index';
import { AccessError } from '../src/auth';
import { defaultPreferences } from '../../tap-email/src/domain';
import { SharedState, parseSnapshot, type Replica, type Snapshot } from '@tap-examples/tap-shared-state';

const worker = createTapEmailCoordinator({ verifyAccess: async request => {
  const profileId = request.headers.get('X-Test-User');
  if (!profileId) throw new AccessError(403, 'denied', 'Sign in.');
  return { profileId };
} });
const request = (owner: string, snapshot?: Snapshot) => new Request('https://email.test/v1/settings', {
  method: snapshot ? 'POST' : 'GET',
  headers: { 'X-Test-User': owner, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
  ...(snapshot ? { body: JSON.stringify(snapshot) } : {}),
});
beforeEach(async () => { await env.DB.prepare('DELETE FROM miniapp_shared_state').run(); });
it('two independent device journals restore and merge settings through the authenticated D1 route', async () => {
  const start = () => {
    let saved: Replica | null = null;
    const call = async (snapshot?: Snapshot) => {
      const response = await worker.fetch(request('same-user', snapshot), env);
      if (!response.ok) throw Object.assign(new Error('settings failed'), { status: response.status });
      return parseSnapshot(await response.json());
    };
    return new SharedState({ read: () => call(), write: call }, {
      async read() { return structuredClone(saved); }, async write(value) { saved = structuredClone(value); },
    });
  };
  const mac = start(); const phone = start();
  await mac.open({ preferences: JSON.parse(JSON.stringify({ ...defaultPreferences, imagesEnabled: false })), corrections: {
    '["account","thread"]': { critical: true, correctedAt: '2026-09-27T12:00:00Z' },
  } });
  expect(await phone.open()).toEqual(await mac.refresh());
  await mac.change(value => ({ ...value, preferences: JSON.parse(JSON.stringify({ ...defaultPreferences, imagesEnabled: false, trackingPixelsEnabled: true })) }));
  await phone.change(value => ({ ...value, corrections: { '["account","thread"]': { critical: false, correctedAt: '2026-09-27T12:01:00Z' } } }));
  const final = await mac.refresh();
  expect(final.preferences).toMatchObject({ imagesEnabled: false, trackingPixelsEnabled: true });
  expect(final.corrections).toMatchObject({ '["account","thread"]': { critical: false } });
  expect(await (await worker.fetch(request('another-user'), env)).json()).toEqual({ revision: null, value: {} });
});
it('rejects stale writes, malformed documents, and unauthenticated access', async () => {
  expect((await worker.fetch(request('one', { revision: null, value: { preferences: JSON.parse(JSON.stringify(defaultPreferences)) } }), env)).status).toBe(200);
  expect((await worker.fetch(request('one', { revision: null, value: {} }), env)).status).toBe(409);
  expect((await worker.fetch(request('two', { revision: null, value: { preferences: 'invalid' } }), env)).status).toBe(400);
  expect((await worker.fetch(request('two', { revision: null, value: { credentials: 'forbidden' } }), env)).status).toBe(400);
  expect((await worker.fetch(request(''), env)).status).toBe(403);
});

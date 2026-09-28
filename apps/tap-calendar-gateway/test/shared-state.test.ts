import { env } from 'cloudflare:workers';
import { beforeEach, expect, it } from 'vitest';
import { createCalendarGatewayWorker } from '../src/index';

const worker = createCalendarGatewayWorker();
function request(workspace: string, principal: string, body?: unknown) {
  return new Request('https://calendar.test/v1/settings', {
    method: body ? 'POST' : 'GET', headers: { Origin: 'http://localhost:3000',
      'X-TAP-Workspace-Id': workspace, 'X-TAP-Principal-Id': principal, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(async () => { await env.CALENDAR_DB.prepare('DELETE FROM miniapp_shared_state').run(); });
it('restores settings in the same workspace and keeps other users and workspaces isolated', async () => {
  const value = { activeAvailabilityId: '', accounts: [], availability: [], bookingProfiles: [] };
  const saved = await worker.fetch(request('workspace-one', 'alice', { revision: null, value }), env);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ revision: 1, value });
  expect(await (await worker.fetch(request('workspace-one', 'alice'), env)).json()).toEqual({ revision: 1, value });
  for (const [workspace, principal] of [['workspace-one', 'bob'], ['workspace-two', 'alice']]) {
    expect(await (await worker.fetch(request(workspace!, principal!), env)).json()).toEqual({ revision: null, value: {} });
  }
});
it('uses atomic revisions and validates Calendar state before saving it', async () => {
  const first = { revision: null, value: { accounts: [] } };
  const results = await Promise.all([worker.fetch(request('workspace', 'alice', first), env), worker.fetch(request('workspace', 'alice', first), env)]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect((await worker.fetch(request('workspace', 'alice', { revision: 1, value: { accounts: 'bad' } }), env)).status).toBe(400);
  expect((await worker.fetch(request('workspace', 'alice', { revision: 1, value: { token: 'forbidden' } }), env)).status).toBe(400);
  expect((await worker.fetch(request('workspace', 'alice', { revision: 1, value: { accounts: [] } }), env)).status).toBe(200);
  const denied = await worker.fetch(request('workspace', ''), env);
  expect(denied.status).toBeGreaterThanOrEqual(400);
});

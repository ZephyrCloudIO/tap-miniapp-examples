import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSenderProfile, verifySenderContext } from '../src/sender-attribution';

const sender = { userId: 'user_canonical', workspaceId: 'workspace_a' };
const identity = { profileId: 'oidc_subject_different_from_user' };
const request = new Request('https://coordinator.example/v1/commands', {
  headers: { Authorization: 'Bearer verified-session' },
});
const production = { ...env, ALLOW_DEV_IDENTITY: 'false' };

afterEach(() => vi.restoreAllMocks());

describe('trusted sender resolution', () => {
  it('resolves canonical identity using the same bearer and binds a distinct mailbox profile', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      expect(url.startsWith('https://directory.theaiplatform.app/rpc/')).toBe(true);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer verified-session');
      expect(init?.redirect).toBe('error');
      calls.push(url);
      if (url.endsWith('/GetCurrentUser')) return Response.json({ user: { userId: sender.userId } });
      expect(JSON.parse(String(init?.body))).toEqual({ workspaceId: sender.workspaceId });
      return Response.json({ context: { ...sender, membershipId: 'membership_1' } });
    });
    const verified = await verifySenderContext(request, production, identity, sender);
    expect(verified).toEqual(sender);
    expect(calls).toHaveLength(2);
    await bindSenderProfile(env, identity, verified, '2026-09-24T00:00:00Z');
    await expect(bindSenderProfile(env, identity, verified, '2026-09-25T00:00:00Z')).resolves.toBeUndefined();
    await expect(bindSenderProfile(env, identity, { ...sender, userId: 'other_user' }, '2026-09-25T00:00:00Z'))
      .rejects.toMatchObject({ code: 'profile_user_conflict' });
  });

  it.each([
    { userId: 'forged_user', workspaceId: sender.workspaceId, membershipId: 'member' },
    { userId: sender.userId, workspaceId: 'wrong_workspace', membershipId: 'member' },
    { ...sender, membershipId: '' },
  ])('rejects mismatched or missing membership: $workspaceId/$userId', async context => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => Response.json(
      String(input).endsWith('/GetCurrentUser') ? { user: { userId: sender.userId } } : { context },
    ));
    await expect(verifySenderContext(request, production, identity, sender))
      .rejects.toMatchObject({ code: 'sender_context_mismatch' });
  });

  it.each([
    [401, 'session_required'], [403, 'workspace_denied'],
    [409, 'directory_sync_required'], [503, 'directory_unavailable'],
  ])('preserves denial/unavailability for status %i', async (status, code) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: Number(status) }));
    await expect(verifySenderContext(request, production, identity, sender)).rejects.toMatchObject({ code });
  });
});

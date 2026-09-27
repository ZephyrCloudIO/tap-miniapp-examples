import {
  isMailSenderContext,
  type MailSenderContext,
} from '@tap-examples/tap-email-protocol';
import { AccessError, type ProfileIdentity } from './auth';
import { readBoundedJson } from './google';
import { isTapEmailReferralUrl } from './referral-url';

// Public Directory Connect API. The same bearer has already passed the
// coordinator's audience/action introspection; never accept a guest mapping.
const directoryOrigin = 'https://directory.theaiplatform.app';
const directoryService = '/rpc/tap.directory.v1.DirectoryService/';

export type SenderVerifier = (
  request: Request,
  env: Env,
  identity: ProfileIdentity,
  expected: MailSenderContext,
) => Promise<MailSenderContext>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AccessError(502, 'directory_invalid', 'Directory returned invalid identity data.');
  }
  return value as Record<string, unknown>;
}

async function directoryCall(request: Request, method: string, body: object): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${directoryOrigin}${directoryService}${method}`, {
      method: 'POST',
      headers: {
        Authorization: request.headers.get('Authorization') ?? '',
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify(body),
      // Workers support manual redirects; the non-OK check below rejects them
      // without forwarding the bearer to the Location destination.
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AccessError(503, 'directory_unavailable', 'Sender verification is temporarily unavailable.');
  }
  if (response.status === 401) throw new AccessError(401, 'session_required', 'A current TAP session is required.');
  if (response.status === 403) throw new AccessError(403, 'workspace_denied', 'Workspace membership is required.');
  if (response.status === 409) throw new AccessError(409, 'directory_sync_required', 'Workspace identity is synchronizing.');
  if (!response.ok) throw new AccessError(503, 'directory_unavailable', 'Sender verification is temporarily unavailable.');
  try {
    return object(await readBoundedJson(response, 65_536));
  } catch {
    throw new AccessError(502, 'directory_invalid', 'Directory returned invalid identity data.');
  }
}

export const verifySenderContext: SenderVerifier = async (request, env, identity, expected) => {
  if (env.ALLOW_DEV_IDENTITY === 'true' && !env.TAP_INTROSPECTION_URL) {
    if (identity.profileId !== 'tap-email-local-dev') {
      throw new AccessError(403, 'development_identity_required', 'A local development identity is required.');
    }
    return expected;
  }
  const [current, principal] = await Promise.all([
    directoryCall(request, 'GetCurrentUser', {}),
    directoryCall(request, 'GetPrincipalContext', { workspaceId: expected.workspaceId }),
  ]);
  const user = object(current.user);
  const context = object(principal.context);
  const verified = { userId: user.userId, workspaceId: context.workspaceId };
  if (!isMailSenderContext(verified) || context.userId !== verified.userId ||
      typeof context.membershipId !== 'string' || !context.membershipId ||
      verified.userId !== expected.userId || verified.workspaceId !== expected.workspaceId) {
    throw new AccessError(403, 'sender_context_mismatch', 'The sending user or workspace has changed.');
  }
  return verified;
};

export async function bindSenderProfile(
  env: Env,
  identity: ProfileIdentity,
  sender: MailSenderContext,
  now: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO mail_profile_users (profile_id, user_id, verified_at, authority)
     VALUES (?, ?, ?, 'session-and-directory')`,
  ).bind(identity.profileId, sender.userId, now).run();
  const owner = await env.DB.prepare('SELECT user_id FROM mail_profile_users WHERE profile_id = ?')
    .bind(identity.profileId).first<{ user_id: string }>();
  if (owner?.user_id !== sender.userId) {
    throw new AccessError(409, 'profile_user_conflict', 'This mailbox profile is bound to a different TAP user.');
  }
}

/** Batch with command insertion: only the newly inserted ciphertext can acquire attribution. */
export function senderAttributionStatement(
  env: Env,
  identity: ProfileIdentity,
  commandId: string,
  sender: MailSenderContext,
  now: string,
  payloadCiphertext: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO mail_command_attributions
      (profile_id, command_id, accepted_command_id, user_id, workspace_id, accepted_at)
     SELECT profile_id, command_id, ?, ?, ?, ? FROM mail_commands
      WHERE profile_id = ? AND command_id = ? AND payload_ciphertext = ?`,
  ).bind(crypto.randomUUID(), sender.userId, sender.workspaceId, now,
    identity.profileId, commandId, payloadCiphertext);
}

export async function assertSenderAttribution(
  env: Env,
  identity: ProfileIdentity,
  commandId: string,
  sender: MailSenderContext,
): Promise<void> {
  const stored = await attributionRow(env, identity.profileId, commandId);
  if (!stored) throw new AccessError(503, 'attribution_not_ready', 'Verified command attribution is not ready.');
  if (stored.user_id !== sender.userId || stored.workspace_id !== sender.workspaceId) {
    throw new AccessError(409, 'attribution_conflict', 'This command already belongs to different sender context.');
  }
}

interface AttributionRow {
  readonly accepted_command_id: string;
  readonly user_id: string;
  readonly workspace_id: string;
  readonly referral_id: string | null;
  readonly referral_url: string | null;
}

function attributionRow(env: Env, profileId: string, commandId: string): Promise<AttributionRow | null> {
  return env.DB.prepare(
    `SELECT accepted_command_id, user_id, workspace_id, referral_id, referral_url
       FROM mail_command_attributions WHERE profile_id = ? AND command_id = ?`,
  ).bind(profileId, commandId).first<AttributionRow>();
}

export function copyScheduledAttribution(env: Env, profileId: string, scheduleId: string, dispatchId: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO mail_command_attributions
      (profile_id, command_id, accepted_command_id, user_id, workspace_id, accepted_at, referral_id, referral_url)
     SELECT profile_id, ?, accepted_command_id, user_id, workspace_id, accepted_at, referral_id, referral_url
       FROM mail_command_attributions WHERE profile_id = ? AND command_id = ?`,
  ).bind(dispatchId, profileId, scheduleId);
}

/** Narrow external RPC port from @zephyrcloudio/website-referrals-rpc-contracts
 * at cd5f220cbb6650d8a72bbd676f5ef87b3ed1fbe6. Keep deployment independent of
 * the monorepo's private package registry; validate its public URL at runtime.
 */
export interface WebsiteReferralPublisher {
  publishTapEmailLink(input: {
    acceptedCommandId: string;
    referrerUserId: string;
    referrerWorkspaceId: string;
  }): Promise<{ referralId: string; url: string }>;
}

export async function referralForSend(
  env: Env,
  publisher: WebsiteReferralPublisher,
  profileId: string,
  commandId: string,
  expected: MailSenderContext,
): Promise<string> {
  const row = await attributionRow(env, profileId, commandId);
  if (!row || row.user_id !== expected.userId || row.workspace_id !== expected.workspaceId) {
    throw new AccessError(503, 'attribution_not_ready', 'Verified command attribution is not ready.');
  }
  if (row.referral_url) {
    if (!isTapEmailReferralUrl(row.referral_url)) throw new AccessError(502, 'referral_invalid', 'The stored referral link is invalid.');
    return row.referral_url;
  }
  let published: Awaited<ReturnType<WebsiteReferralPublisher['publishTapEmailLink']>>;
  try {
    published = await publisher.publishTapEmailLink({
      acceptedCommandId: row.accepted_command_id,
      referrerUserId: row.user_id,
      referrerWorkspaceId: row.workspace_id,
    });
  } catch {
    throw new AccessError(503, 'referral_unavailable', 'The website referral service is unavailable.');
  }
  if (!published || !isTapEmailReferralUrl(published.url) ||
      typeof published.referralId !== 'string' || !published.referralId || published.referralId.length > 256) {
    throw new AccessError(502, 'referral_invalid', 'The website returned an invalid referral link.');
  }
  await env.DB.prepare(
    `UPDATE mail_command_attributions SET referral_id = ?, referral_url = ?
     WHERE profile_id = ? AND command_id = ? AND referral_url IS NULL`,
  ).bind(published.referralId, published.url, profileId, commandId).run();
  const stored = await attributionRow(env, profileId, commandId);
  if (!stored?.referral_url) throw new AccessError(503, 'attribution_not_ready', 'Referral persistence did not complete.');
  if (!isTapEmailReferralUrl(stored.referral_url)) throw new AccessError(502, 'referral_invalid', 'The stored referral link is invalid.');
  return stored.referral_url;
}

export function referralPublisher(value: unknown): WebsiteReferralPublisher | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as Partial<WebsiteReferralPublisher>).publishTapEmailLink === 'function'
    ? value as WebsiteReferralPublisher
    : undefined;
}

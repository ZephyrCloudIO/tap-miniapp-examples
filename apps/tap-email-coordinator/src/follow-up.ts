import type { MailFollowUp } from '@tap-examples/tap-email-protocol';
import { sha256BytesBase64Url } from './crypto';
import type { ProviderScope } from './provider';

export interface SentMessageIdentity {
  readonly messageId: string;
  readonly threadId: string;
  readonly sentAt: string;
}

/** Included in the same transaction as the provider's sent checkpoint. */
export async function sentFollowUpStatements(
  env: Env,
  scope: ProviderScope,
  draftKey: string,
  policy: MailFollowUp,
  sent: SentMessageIdentity,
  now: string,
): Promise<D1PreparedStatement[]> {
  const digest = await sha256BytesBase64Url(new TextEncoder().encode(
    JSON.stringify([scope.profileId, scope.accountId, draftKey]),
  ));
  const reminderId = `followup_${digest}`;
  const dueAt = new Date(Date.parse(sent.sentAt) + policy.delayMinutes * 60_000).toISOString();
  return [
    env.DB.prepare(
      `UPDATE tap_reminders SET state = 'cancelled', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND state IN ('pending', 'due') AND created_at <= ?
          AND NOT EXISTS (SELECT 1 FROM tap_reminders WHERE profile_id = ? AND reminder_id = ?)`,
    ).bind(now, scope.profileId, scope.accountId, sent.threadId, sent.sentAt, scope.profileId, reminderId),
    env.DB.prepare(
      `INSERT INTO tap_reminders
         (profile_id, account_id, reminder_id, thread_id, due_at, condition, state, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6,
         CASE
           WHEN EXISTS (SELECT 1 FROM tap_reminders
             WHERE profile_id = ?1 AND account_id = ?2 AND thread_id = ?4
               AND state IN ('pending', 'due')) THEN 'cancelled'
           WHEN ?6 = 'if_no_reply' AND EXISTS (
             SELECT 1 FROM mail_messages message JOIN google_accounts account
               ON account.profile_id = message.profile_id AND account.account_id = message.account_id
              WHERE message.profile_id = ?1 AND message.account_id = ?2 AND message.thread_id = ?4
                AND message.sent_at > ?7 AND message.message_id != ?9
                AND LOWER(json_extract(message.sender_json, '$.address')) != LOWER(account.email_address)
           ) THEN 'satisfied'
           WHEN ?5 <= ?8 THEN 'due'
           ELSE 'pending'
         END, ?7, ?8
       WHERE NOT EXISTS (SELECT 1 FROM tap_reminders WHERE profile_id = ?1 AND reminder_id = ?3)`,
    ).bind(scope.profileId, scope.accountId, reminderId, sent.threadId,
      dueAt, policy.condition, sent.sentAt, now, sent.messageId),
  ];
}

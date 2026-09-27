export interface SentRecipient {
  readonly name: string;
  readonly address: string;
  readonly lastSentAt: string;
}

/** Search all indexed history, not just the loaded page of mail. */
export async function searchSentRecipients(
  env: Env,
  profileId: string,
  query: string,
): Promise<readonly SentRecipient[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const result = await env.DB.prepare(
    `WITH matches AS (
       SELECT h.address, h.display_name, h.last_sent_at,
              row_number() OVER (
                PARTITION BY h.address ORDER BY h.last_sent_at DESC, h.account_id
              ) AS occurrence
         FROM mail_recipient_history h
         JOIN google_accounts a
           ON a.profile_id = h.profile_id AND a.account_id = h.account_id
        WHERE h.profile_id = ?1 AND a.connection_state != 'revoked'
          AND (instr(h.address, ?2) > 0 OR instr(lower(h.display_name), ?2) > 0)
     )
     SELECT address, display_name AS name, last_sent_at AS lastSentAt
       FROM matches WHERE occurrence = 1
      ORDER BY CASE WHEN instr(address, ?2) = 1 THEN 0
                    WHEN instr(lower(display_name), ?2) = 1 THEN 1 ELSE 2 END,
               last_sent_at DESC, address
      LIMIT 20`,
  ).bind(profileId, needle).all<SentRecipient>();
  return result.results.flatMap(recipient =>
    recipient.address.length <= 320 && /^[^\s@,;<>]+@[^\s@,;<>]+$/u.test(recipient.address)
      && Number.isFinite(Date.parse(recipient.lastSentAt))
      ? [{ ...recipient, name: recipient.name.slice(0, 320) }] : []);
}

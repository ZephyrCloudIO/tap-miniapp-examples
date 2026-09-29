import type { EmailMessage, EmailParticipant } from './domain';

/** Reply to the latest message's visible recipients, never the thread's history. */
export function replyAllRecipients(message: EmailMessage | undefined, accountAddress: string) {
  const ownAddress = accountAddress.trim().toLowerCase();
  const seen = new Set([ownAddress]);
  const unique = (participants: readonly EmailParticipant[]) => participants.filter(participant => {
    const address = participant.address.trim().toLowerCase();
    if (!address || seen.has(address)) return false;
    seen.add(address);
    return true;
  });
  const fromSelf = message?.from.address.trim().toLowerCase() === ownAddress;
  const replyTo = message?.replyTo?.length ? message.replyTo : message ? [message.from] : [];
  const to = unique([...(fromSelf ? [] : replyTo), ...(message?.to ?? [])]);
  const cc = unique(message?.cc ?? []);
  // A message sent only to Cc still needs a primary recipient for our composer.
  if (to.length === 0 && cc.length > 0) to.push(cc.shift()!);
  return {
    to: to.map(person => person.address.trim()).join(', '),
    cc: cc.map(person => person.address.trim()).join(', '),
    recipientLabel: [...to, ...cc].map(person => person.name || person.address).join(', ') || 'recipient',
  };
}

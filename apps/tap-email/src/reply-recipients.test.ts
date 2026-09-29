import { describe, expect, it } from '@rstest/core';
import { isEmailMessage, type EmailMessage } from './domain';
import { replyAllRecipients } from './reply-recipients';

const person = (address: string, name = '') => ({ name, address });
const message: EmailMessage = {
  messageId: 'message_1', from: person('paul@example.com', 'Paul'),
  to: [person('zack@example.com')], cc: [person('iman@example.com', 'Iman')],
  sentAt: '2026-09-28T16:09:00.000Z', bodyText: 'Please send the information.',
};

describe('reply all recipients', () => {
  it('keeps the sender in To and copied recipients in Cc', () => {
    expect(replyAllRecipients(message, 'zack@example.com')).toEqual({
      to: 'paul@example.com', cc: 'iman@example.com', recipientLabel: 'Paul, Iman',
    });
  });

  it('includes other To recipients, excluding self and duplicates across fields case-insensitively', () => {
    expect(replyAllRecipients({
      ...message,
      to: [person('ZACK@example.com'), person('other@example.com'), person('PAUL@example.com')],
      cc: [person('OTHER@example.com'), person('zack@example.com'), ...message.cc!, person('IMAN@example.com')],
    }, ' Zack@Example.com ')).toMatchObject({ to: 'paul@example.com, other@example.com', cc: 'iman@example.com' });
  });

  it('uses Reply-To in place of From', () => {
    expect(replyAllRecipients({ ...message, replyTo: [person('replies@example.com')] }, 'zack@example.com'))
      .toMatchObject({ to: 'replies@example.com', cc: 'iman@example.com' });
  });

  it('replies to the original recipients when the last message was sent by the account', () => {
    expect(replyAllRecipients({ ...message, from: person('ZACK@example.com'), to: [message.from] }, 'zack@example.com'))
      .toMatchObject({ to: 'paul@example.com', cc: 'iman@example.com' });
  });

  it('keeps the sender when the account was copied and never copies hidden recipients', () => {
    expect(replyAllRecipients({
      ...message, to: [person('other@example.com')], cc: [person('zack@example.com')],
      ...{ bcc: [person('private@example.com')] },
    }, 'zack@example.com')).toMatchObject({ to: 'paul@example.com, other@example.com', cc: '' });
  });

  it('supports messages without copy headers and missing message metadata', () => {
    expect(replyAllRecipients({ ...message, cc: undefined }, 'zack@example.com'))
      .toMatchObject({ to: 'paul@example.com', cc: '' });
    expect(replyAllRecipients(undefined, 'zack@example.com')).toMatchObject({ to: '', cc: '' });
  });

  it('promotes a copied recipient for a sent message without To recipients', () => {
    expect(replyAllRecipients({ ...message, from: person('zack@example.com'), to: [] }, 'zack@example.com'))
      .toMatchObject({ to: 'iman@example.com', cc: '' });
  });

  it('validates recipient headers while accepting older cached messages', () => {
    expect(isEmailMessage(message)).toBe(true);
    expect(isEmailMessage({ ...message, cc: undefined, replyTo: undefined })).toBe(true);
    expect(isEmailMessage({ ...message, cc: 'iman@example.com' })).toBe(false);
    expect(isEmailMessage({ ...message, replyTo: [{ name: 'Invalid' }] })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { isTapEmailReferralUrl } from '../src/referral-url';

const link = `https://theaiplatform.app/refer/${'a'.repeat(32)}?utm_source=tap_email&utm_medium=email&utm_campaign=sent_with&utm_content=signature`;

describe('website referral URL boundary', () => {
  it('accepts the website campaign without encoding identity in the link', () => {
    expect(isTapEmailReferralUrl(link)).toBe(true);
  });

  it.each([
    null, {}, 'not a url',
    link.replace('https:', 'http:'),
    link.replace('theaiplatform.app', 'theaiplatform.app.evil.example'),
    link.replace('theaiplatform.app', 'user@theaiplatform.app'),
    link.replace('utm_source=tap_email', 'utm_source=other'),
    `${link}&referrer_user_id=forged`, `${link}&utm_source=tap_email`,
    `${link}&redirect=https://evil.example`, `${link}#fragment`, `${link}\r\nX-Injected: yes`,
  ])('rejects noncanonical URLs and metadata overrides: %s', value => {
    expect(isTapEmailReferralUrl(value)).toBe(false);
  });
});

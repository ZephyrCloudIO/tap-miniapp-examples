import { describe, expect, it } from '@rstest/core';
import {
  mailViewDeepLink,
  parseMailViewHash,
  withMailViewHash,
} from './view-location';
import { FIXED_MAILBOX_CATEGORIES } from './mail-navigation';

describe('TAP Email view location', () => {
  it('round-trips account-scoped thread locations', () => {
    const href = withMailViewHash('https://tap.local/email?surface=panel', {
      accountId: 'google_work',
      split: 'critical',
      threadAccountId: 'google_work',
      threadId: 'gmail_thread_42',
    });
    const parsed = parseMailViewHash(new URL(href).hash);
    expect(parsed).toEqual({
      accountId: 'google_work',
      split: 'critical',
      threadAccountId: 'google_work',
      threadId: 'gmail_thread_42',
    });
  });

  it('ignores unrelated hashes and safely defaults invalid mail routes', () => {
    expect(parseMailViewHash('#view=home')).toBeNull();
    expect(parseMailViewHash('#account=../../bad&split=unknown&thread=%00bad')).toEqual({
      accountId: 'all',
      split: 'inbox',
      threadAccountId: null,
      threadId: null,
    });
  });

  it('creates home-screen deep links with explicit account scope', () => {
    expect(mailViewDeepLink('google_personal', 'critical', 'thread_7')).toBe(
      '#account=google_personal&split=critical&threadAccount=google_personal&thread=thread_7',
    );
  });

  it('round-trips every fixed mailbox category without provider-specific routing', () => {
    for (const category of FIXED_MAILBOX_CATEGORIES) {
      expect(parseMailViewHash(`#account=all&split=${category.id}`)?.split).toBe(category.id);
    }
  });
});

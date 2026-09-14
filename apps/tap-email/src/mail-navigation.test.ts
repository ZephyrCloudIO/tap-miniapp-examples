import { describe, expect, it } from '@rstest/core';
import {
  ALL_MAIL_VIEWS,
  FIXED_MAILBOX_CATEGORIES,
  TAP_MAIL_VIEWS,
  mailViewDefinition,
} from './mail-navigation';

describe('mail navigation', () => {
  it('keeps the fixed provider-neutral categories in reference order', () => {
    expect(FIXED_MAILBOX_CATEGORIES.map(category => category.label)).toEqual([
      'Inbox',
      'Starred',
      'Drafts',
      'Sent',
      'Done',
      'Auto Archived',
      'Scheduled',
      'Outbox',
      'Reminders',
      'Snippets',
      'Spam',
      'Trash',
    ]);
  });

  it('keeps TAP views separate and never adds generated auto labels', () => {
    expect(TAP_MAIL_VIEWS.map(view => view.label)).toEqual([
      'Critical',
      'Needs response',
      'Waiting',
    ]);
    expect(ALL_MAIL_VIEWS.map(view => view.label)).not.toContain('Auto Labels');
    expect(ALL_MAIL_VIEWS.map(view => view.id)).toHaveLength(
      new Set(ALL_MAIL_VIEWS.map(view => view.id)).size,
    );
  });

  it('provides category-aware empty copy', () => {
    expect(mailViewDefinition('drafts').emptyTitle).toBe('No drafts');
    expect(mailViewDefinition('trash').emptyTitle).toBe('Trash is empty');
  });

  it('publishes the reference folder shortcuts for supported fixed destinations', () => {
    expect(Object.fromEntries(
      FIXED_MAILBOX_CATEGORIES.map(category => [category.id, category.shortcut]),
    )).toMatchObject({
      inbox: 'G I',
      starred: 'G S',
      drafts: 'G D',
      sent: 'G T',
      done: 'G E',
      reminders: 'G H',
      snippets: 'G ;',
      spam: 'G !',
      trash: 'G #',
    });
  });
});

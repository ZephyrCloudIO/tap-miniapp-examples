import { describe, expect, it } from '@rstest/core';
import {
  emailThreadKey,
  mailSplitThreadCount,
  mergeMailboxSnapshot,
  previewMailState,
  visibleThreads,
  type MailSplit,
  type ProviderMailboxResource,
} from './domain';

const providerSplits = [
  'inbox',
  'starred',
  'drafts',
  'sent',
  'spam',
  'trash',
] as const satisfies readonly (MailSplit & ProviderMailboxResource)[];

describe('provider-neutral mailbox resources', () => {
  it('uses adapter-projected resources without consulting raw Gmail labels', () => {
    const state = previewMailState();
    const original = state.threads[0]!;
    const projected = {
      ...original,
      providerResources: providerSplits,
      labels: [],
      starred: false,
      status: 'done' as const,
    };
    const projectedState = { ...state, threads: [projected] };

    for (const selectedSplit of providerSplits) {
      expect(visibleThreads({ ...projectedState, selectedSplit })).toEqual([projected]);
    }

    const rawOnly = {
      ...projected,
      providerResources: undefined,
      labels: ['INBOX', 'STARRED', 'DRAFT', 'SENT', 'SPAM', 'TRASH'],
    };
    for (const selectedSplit of providerSplits) {
      expect(visibleThreads({ ...state, threads: [rawOnly], selectedSplit })).toEqual([]);
    }
  });

  it('keeps colliding provider thread IDs isolated by stable TAP account ID', () => {
    const state = previewMailState();
    const first = {
      ...state.threads[0]!,
      accountId: 'google_personal',
      threadId: 'shared_provider_thread',
      providerResources: ['inbox'] as const,
    };
    const second = {
      ...state.threads[1]!,
      accountId: 'google_work',
      threadId: 'shared_provider_thread',
      providerResources: ['spam'] as const,
      status: 'done' as const,
    };
    const scoped = {
      ...state,
      threads: [first, second],
      selectedAccountId: 'google_work',
      selectedSplit: 'spam' as const,
      selectedThreadKey: emailThreadKey(second),
    };

    expect(visibleThreads(scoped)).toEqual([second]);
    expect(mailSplitThreadCount(scoped, 'spam')).toBe(1);
    expect(mailSplitThreadCount({ ...scoped, selectedAccountId: 'google_personal' }, 'spam')).toBe(0);
  });

  it('applies resource-only snapshot changes while retaining hydrated messages', () => {
    const state = previewMailState();
    const original = state.threads[0]!;
    const merged = mergeMailboxSnapshot(state, {
      schemaVersion: 1,
      accounts: state.accounts,
      threads: state.threads.map(thread =>
        emailThreadKey(thread) === emailThreadKey(original)
          ? { ...thread, providerResources: ['sent'] }
          : thread,
      ),
    });
    const updated = merged.threads.find(thread =>
      emailThreadKey(thread) === emailThreadKey(original)
    )!;

    expect(updated.providerResources).toEqual(['sent']);
    expect(updated.messages).toBe(original.messages);
  });
});
